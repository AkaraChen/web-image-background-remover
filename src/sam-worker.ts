/// <reference lib="webworker" />
import { env, RawImage } from '@huggingface/transformers';
import {
  decodePrompt,
  encodeImage,
  loadSlimSam,
  type SamDevice,
  type SamHandle,
} from './sam';

env.allowLocalModels = false;

type LoadMsg = { type: 'load'; device: SamDevice; dtype: string };
type EncodeMsg = { type: 'encode'; id: number; blob: Blob };
type DecodeMsg = {
  type: 'decode';
  id: number;
  input_points: number[][][][];
  input_labels: number[][][];
};
type DisposeMsg = { type: 'dispose' };
type InMsg = LoadMsg | EncodeMsg | DecodeMsg | DisposeMsg;

let handle: SamHandle | null = null;
let loadedKey = '';
let image: RawImage | null = null;
let embeddings: { image_embeddings: unknown; image_positional_embeddings: unknown } | null = null;

const post = (msg: unknown, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(msg, transfer ?? []);

async function load(msg: LoadMsg) {
  const key = `${msg.device}|${msg.dtype}`;
  if (handle && loadedKey === key) {
    post({ type: 'sam-ready', key, cached: true, sessionNames: handle.sessionNames, device: msg.device, dtype: msg.dtype });
    return;
  }
  handle = null;
  loadedKey = '';
  embeddings = null;
  image = null;
  try {
    const started = performance.now();
    handle = await loadSlimSam({
      device: msg.device,
      dtype: msg.dtype,
      progress_callback: (p) => post({ type: 'sam-progress', ...(p as object) }),
    });
    loadedKey = key;
    post({
      type: 'sam-ready',
      key,
      cached: false,
      sessionNames: handle.sessionNames,
      device: msg.device,
      dtype: msg.dtype,
      ms: Math.round(performance.now() - started),
    });
  } catch (err: unknown) {
    post({ type: 'sam-error', where: 'load', message: String((err as Error)?.message ?? err) });
  }
}

async function encode(msg: EncodeMsg) {
  if (!handle) {
    post({ type: 'sam-error', where: 'encode', id: msg.id, message: 'SAM not loaded' });
    return;
  }
  try {
    image = await RawImage.fromBlob(msg.blob);
    const encoded = await encodeImage(handle, image);
    embeddings = encoded.embeddings;
    post({
      type: 'sam-encoded',
      id: msg.id,
      width: image.width,
      height: image.height,
      encodeMs: encoded.encodeMs,
      pixelValuesDims: encoded.pixelValuesDims,
      imageEmbeddingsDims: encoded.imageEmbeddingsDims,
    });
  } catch (err: unknown) {
    embeddings = null;
    image = null;
    post({ type: 'sam-error', where: 'encode', id: msg.id, message: String((err as Error)?.message ?? err) });
  }
}

async function decode(msg: DecodeMsg) {
  if (!handle || !image || !embeddings) {
    post({ type: 'sam-error', where: 'decode', id: msg.id, message: 'SAM embeddings missing' });
    return;
  }
  try {
    const decoded = await decodePrompt(handle, image, embeddings, msg.input_points, msg.input_labels);
    post(
      {
        type: 'sam-decoded',
        id: msg.id,
        width: decoded.maskWidth,
        height: decoded.maskHeight,
        mask: decoded.mask,
        iouScores: decoded.iouScores,
        bestIndex: decoded.bestIndex,
        bestIou: decoded.bestIou,
        decodeMs: decoded.decodeMs,
        postMs: decoded.postMs,
        predMasksDims: decoded.predMasksDims,
        maskDims: decoded.maskDims,
      },
      [decoded.mask.buffer],
    );
  } catch (err: unknown) {
    post({ type: 'sam-error', where: 'decode', id: msg.id, message: String((err as Error)?.message ?? err) });
  }
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'load':
      await load(msg);
      break;
    case 'encode':
      await encode(msg);
      break;
    case 'decode':
      await decode(msg);
      break;
    case 'dispose':
      handle = null;
      loadedKey = '';
      embeddings = null;
      image = null;
      post({ type: 'sam-disposed' });
      break;
  }
};
