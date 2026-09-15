/// <reference lib="webworker" />
import { env, pipeline, RawImage } from '@huggingface/transformers';
import type { BackgroundRemovalPipeline } from '@huggingface/transformers';

env.allowLocalModels = false;

type Device = 'webgpu' | 'wasm';
type Dtype = string;

interface LoadMsg {
  type: 'load';
  model: string;
  dtype: Dtype;
  device: Device;
}
interface RunMsg {
  type: 'run';
  id: number;
  blob: Blob;
}
interface DisposeMsg {
  type: 'dispose';
}
export type RmbgInMsg = LoadMsg | RunMsg | DisposeMsg;

let segmenter: BackgroundRemovalPipeline | null = null;
let loadedKey = '';

type Post = (msg: unknown, transfer?: Transferable[]) => void;

function keyOf(model: string, dtype: Dtype, device: Device) {
  return `${model}|${dtype}|${device}`;
}

async function load({ model, dtype, device }: LoadMsg, post: Post) {
  const key = keyOf(model, dtype, device);
  if (segmenter && loadedKey === key) {
    post({ type: 'ready', key, cached: true });
    return;
  }
  segmenter = null;
  loadedKey = '';

  try {
    const started = performance.now();
    const pipe = (await pipeline('background-removal', model, {
      device,
      dtype: dtype as never,
      progress_callback: (p: Record<string, unknown>) => post({ type: 'progress', ...p }),
    })) as unknown as BackgroundRemovalPipeline;

    segmenter = pipe;
    loadedKey = key;
    post({ type: 'ready', key, cached: false, ms: Math.round(performance.now() - started) });
  } catch (err: unknown) {
    post({ type: 'error', where: 'load', key, message: String((err as Error)?.message ?? err) });
  }
}

/**
 * Run the model and hand back a single-channel alpha map sized to the original
 * image. `BackgroundRemovalPipeline._call` already resizes the mask back to the
 * input resolution and writes it into the image's alpha channel
 * (see utils/image.js `putAlpha`), so all we do here is pull that channel out.
 * Compositing stays on the main thread, so the edge sliders are instant and
 * changing the background never re-runs the network.
 */
async function run({ id, blob }: RunMsg, post: Post) {
  if (!segmenter) {
    post({ type: 'error', where: 'run', id, message: 'model not loaded' });
    return;
  }
  try {
    const t0 = performance.now();
    const image = await RawImage.fromBlob(blob);
    const w = image.width;
    const h = image.height;

    const raw = (await segmenter(image as never)) as unknown as RawImage | RawImage[];
    const out = Array.isArray(raw) ? raw[0] : raw;
    if (!out) throw new Error('pipeline returned no image');

    const t1 = performance.now();
    const channels = out.channels ?? 4;
    if (channels !== 4) {
      throw new Error(`expected RGBA output from the pipeline, got ${channels} channels`);
    }
    if (out.width !== w || out.height !== h) {
      throw new Error(`pipeline returned ${out.width}x${out.height}, expected ${w}x${h}`);
    }

    const rgba = out.data as Uint8Array;
    const alpha = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 3; i < alpha.length; i++, p += 4) alpha[i] = rgba[p];

    const t2 = performance.now();
    post(
      {
        type: 'result',
        id,
        width: w,
        height: h,
        alpha,
        timings: {
          inferMs: Math.round(t1 - t0),
          postMs: Math.round(t2 - t1),
          totalMs: Math.round(t2 - t0),
        },
      },
      [alpha.buffer],
    );
  } catch (err: unknown) {
    post({ type: 'error', where: 'run', id, message: String((err as Error)?.message ?? err) });
  }
}

export async function handleRmbgMessage(msg: RmbgInMsg, post: Post) {
  switch (msg.type) {
    case 'load':
      await load(msg, post);
      break;
    case 'run':
      await run(msg, post);
      break;
    case 'dispose':
      try {
        await (segmenter as { dispose?: () => Promise<void> } | null)?.dispose?.();
      } catch {
        /* ignore */
      }
      segmenter = null;
      loadedKey = '';
      post({ type: 'disposed' });
      break;
  }
}
