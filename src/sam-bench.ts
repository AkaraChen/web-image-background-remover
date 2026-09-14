import { env, RawImage } from '@huggingface/transformers';
import { decodePrompt, encodeImage, loadSlimSam, strokeToPrompts } from './sam';

env.allowLocalModels = false;

type Probe = {
  userAgent: string;
  webgpuApi: boolean;
  webgpuAdapter: string | null;
  webgpuError: string | null;
};

async function probeWebgpu(): Promise<Probe> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ info?: unknown } | null> } }).gpu;
  const base = { userAgent: navigator.userAgent, webgpuApi: !!gpu, webgpuAdapter: null as string | null, webgpuError: null as string | null };
  if (!gpu) {
    base.webgpuError = 'navigator.gpu missing';
    return base;
  }
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      base.webgpuError = 'requestAdapter() returned null';
      return base;
    }
    base.webgpuAdapter = JSON.stringify(adapter.info ?? { present: true });
    return base;
  } catch (err) {
    base.webgpuError = String((err as Error)?.message ?? err);
    return base;
  }
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function setStatus(s: string) {
  const el = document.getElementById('status');
  if (el) el.textContent = s;
  console.log('[sam-bench]', s);
}

async function b64ToImage(jpegB64: string): Promise<RawImage> {
  const blob = await fetch(`data:image/jpeg;base64,${jpegB64}`).then((r) => r.blob());
  return RawImage.fromBlob(blob);
}

async function runOnce(
  handle: Awaited<ReturnType<typeof loadSlimSam>>,
  image: RawImage,
  label: string,
) {
  setStatus(`encode ${label}…`);
  const encoded = await encodeImage(handle, image);
  const prompts = strokeToPrompts(
    [
      { x: image.width * 0.35, y: image.height * 0.5 },
      { x: image.width * 0.55, y: image.height * 0.5 },
    ],
    image.width,
    image.height,
  );
  setStatus(`decode ${label}…`);
  const decoded = await decodePrompt(handle, image, encoded.embeddings, prompts.input_points, prompts.input_labels);
  return {
    label,
    width: image.width,
    height: image.height,
    encodeMs: encoded.encodeMs,
    decodeMs: decoded.decodeMs,
    postMs: decoded.postMs,
    pixelValuesDims: encoded.pixelValuesDims,
    imageEmbeddingsDims: encoded.imageEmbeddingsDims,
    predMasksDims: decoded.predMasksDims,
    iouScores: decoded.iouScores,
    maskDims: decoded.maskDims,
    nPositive: prompts.nPositive,
    nNegative: prompts.nNegative,
  };
}

export async function runSamBench(jpegB64: string) {
  const webgpu = await probeWebgpu();
  setStatus('loading SlimSAM on WASM q8…');
  let loadMs = 0;
  let handle: Awaited<ReturnType<typeof loadSlimSam>>;
  const tLoad = performance.now();
  try {
    handle = await loadSlimSam({
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (p) => {
        const x = p as { status?: string; file?: string };
        if (x?.file) setStatus(`${x.status ?? ''} ${x.file}`);
      },
    });
    loadMs = performance.now() - tLoad;
  } catch (err) {
    return {
      ok: false as const,
      backend: 'wasm' as const,
      dtype: 'q8',
      webgpu,
      error: String((err as Error)?.message ?? err),
      loadMs: performance.now() - tLoad,
    };
  }

  const native = await b64ToImage(jpegB64);
  const resized = await native.resize(1000, 1000);

  // warmup (not recorded as the gated number)
  setStatus('warmup encode+decode…');
  await runOnce(handle, native, 'warmup-native');

  const nativeRuns = [];
  for (let i = 0; i < 3; i++) nativeRuns.push(await runOnce(handle, native, `native-640x480#${i}`));
  const resizedRuns = [];
  for (let i = 0; i < 3; i++) resizedRuns.push(await runOnce(handle, resized, `resized-1000x1000#${i}`));

  const report = {
    ok: true as const,
    backend: 'wasm' as const,
    dtype: 'q8',
    model: 'Xenova/slimsam-77-uniform',
    webgpu,
    loadMs,
    sessionNames: handle.sessionNames,
    nativeRuns,
    resizedRuns,
    nativeEncodeMedianMs: median(nativeRuns.map((r) => r.encodeMs)),
    nativeDecodeMedianMs: median(nativeRuns.map((r) => r.decodeMs)),
    resizedEncodeMedianMs: median(resizedRuns.map((r) => r.encodeMs)),
    resizedDecodeMedianMs: median(resizedRuns.map((r) => r.decodeMs)),
    webgpuRuntime: 'missing proof' as const,
  };
  setStatus('done');
  return report;
}

(window as unknown as { runSamBench: typeof runSamBench }).runSamBench = runSamBench;
document.getElementById('status')?.replaceChildren(document.createTextNode('ready'));
