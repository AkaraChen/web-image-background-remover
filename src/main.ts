import './style.css';
import { MODELS, DTYPES, modelById, type Dtype, type ModelSpec } from './models';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/* ─────────────────────────── DOM ─────────────────────────── */
const selModel = $<HTMLSelectElement>('sel-model');
const selDtype = $<HTMLSelectElement>('sel-dtype');
const selDevice = $<HTMLSelectElement>('sel-device');
const modelNote = $<HTMLParagraphElement>('model-note');
const btnLoad = $<HTMLButtonElement>('btn-load');
const btnRelease = $<HTMLButtonElement>('btn-release');
const progress = $<HTMLDivElement>('progress');
const progressFill = $<HTMLElement>('progress-fill');
const progressLabel = $<HTMLSpanElement>('progress-label');

const rngThreshold = $<HTMLInputElement>('rng-threshold');
const rngGamma = $<HTMLInputElement>('rng-gamma');
const valThreshold = $<HTMLElement>('val-threshold');
const valGamma = $<HTMLElement>('val-gamma');
const chkInvert = $<HTMLInputElement>('chk-invert');
const bgModes = $<HTMLDivElement>('bg-modes');
const colorField = $<HTMLLabelElement>('color-field');
const inpColor = $<HTMLInputElement>('inp-color');

const btnDownload = $<HTMLButtonElement>('btn-download');
const btnDownloadMask = $<HTMLButtonElement>('btn-download-mask');
const timings = $<HTMLParagraphElement>('timings');

const dropzone = $<HTMLDivElement>('dropzone');
const empty = $<HTMLDivElement>('empty');
const compare = $<HTMLDivElement>('compare');
const frame = $<HTMLDivElement>('frame');
const imgOriginal = $<HTMLImageElement>('img-original');
const canvasResult = $<HTMLCanvasElement>('canvas-result');
const handle = $<HTMLDivElement>('handle');
const checker = $<HTMLDivElement>('checker');
const busy = $<HTMLDivElement>('busy');
const busyText = $<HTMLSpanElement>('busy-text');
const fileInput = $<HTMLInputElement>('file-input');
const badgeDevice = $<HTMLSpanElement>('badge-device');
const badgeModel = $<HTMLSpanElement>('badge-model');

/* ─────────────────────────── 状态 ─────────────────────────── */
type BgMode = 'transparent' | 'color' | 'dim';

interface Source {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  url: string;
}

let source: Source | null = null;
let alpha: Uint8ClampedArray | null = null; // one byte per pixel, sized to the source
let bgMode: BgMode = 'transparent';
let splitAt = 0.5;
let runSeq = 0;
let loadedKey = '';
let lastSpec: ModelSpec = MODELS[0];

/* ─────────────────────────── 后端探测 ─────────────────────────── */
const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

async function detectWebGPU(): Promise<boolean> {
  if (!hasWebGPU) return false;
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

async function initDeviceBadge() {
  if (!hasWebGPU) {
    badgeDevice.textContent = '无 WebGPU · 走 WASM';
    badgeDevice.className = 'badge warn';
    selDevice.value = 'wasm';
    return;
  }
  const ok = await detectWebGPU();
  if (ok) {
    const adapter = await (navigator as any).gpu.requestAdapter();
    let label = 'WebGPU 可用';
    try {
      const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
      if (info?.description || info?.vendor) {
        label = `WebGPU · ${info.description || [info.vendor, info.architecture].filter(Boolean).join(' ')}`;
      }
    } catch {
      /* adapter info is optional */
    }
    badgeDevice.textContent = label;
    badgeDevice.className = 'badge ok';
  } else {
    badgeDevice.textContent = 'WebGPU 不可用 · 走 WASM';
    badgeDevice.className = 'badge warn';
    selDevice.value = 'wasm';
  }
}

/* ─────────────────────────── Worker ─────────────────────────── */
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

interface PendingRun {
  resolve: (r: { alpha: Uint8ClampedArray; width: number; height: number; timings: any }) => void;
  reject: (e: Error) => void;
}
const pendingRuns = new Map<number, PendingRun>();
let pendingLoad: { resolve: () => void; reject: (e: Error) => void } | null = null;

worker.onmessage = (e: MessageEvent<any>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'progress': {
      const { status, file, loaded, total } = msg;
      progress.hidden = false;
      if (status === 'progress' && total) {
        paintProgress(status, `${file} · ${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`, (loaded / total) * 100);
      } else if (status === 'done') {
        paintProgress(status, `${file} 已缓存`, 100);
      } else if (status === 'ready') {
        progressLabel.textContent = '初始化推理会话…';
      }
      break;
    }
    case 'ready':
      paintProgress('ready', '', 100, true);
      loadedKey = msg.key;
      badgeModel.textContent = `${lastSpec.label} · ${dtypeFor(lastSpec)}`;
      badgeModel.className = 'badge ok';
      progress.hidden = true;
      progressFill.style.width = '0%';
      pendingLoad?.resolve();
      pendingLoad = null;
      break;
    case 'result': {
      const p = pendingRuns.get(msg.id);
      pendingRuns.delete(msg.id);
      p?.resolve(msg);
      break;
    }
    case 'error': {
      const err = new Error(msg.message);
      if (msg.where === 'load' && pendingLoad) {
        pendingLoad.reject(err);
        pendingLoad = null;
      } else if (msg.id != null) {
        const p = pendingRuns.get(msg.id);
        pendingRuns.delete(msg.id);
        p?.reject(err);
      } else {
        console.error(err);
      }
      break;
    }
    case 'disposed':
      loadedKey = '';
      badgeModel.textContent = '未载入模型';
      badgeModel.className = 'badge';
      break;
  }
};

// ORT fires progress on every chunk (thousands of times for a 100 MB file);
// painting each one thrashes the main thread, so coalesce to ~20 fps.
let lastPaint = 0;
let pendingPaint: { label: string; pct: number } | null = null;
let paintTimer: number | undefined;

function paintProgress(status: string, label: string, pct: number, force = false) {
  pendingPaint = { label, pct };
  const now = performance.now();
  const flush = () => {
    if (!pendingPaint) return;
    progressFill.style.width = `${pendingPaint.pct.toFixed(2)}%`;
    progressLabel.textContent = pendingPaint.label;
    pendingPaint = null;
    lastPaint = performance.now();
  };
  if (force || now - lastPaint > 50) return flush();
  if (paintTimer === undefined) {
    paintTimer = window.setTimeout(() => {
      paintTimer = undefined;
      flush();
    }, 50);
  }
  void status;
}

function pickDevice(): 'webgpu' | 'wasm' {
  if (selDevice.value === 'auto') return hasWebGPU ? 'webgpu' : 'wasm';
  return selDevice.value as 'webgpu' | 'wasm';
}

function dtypeFor(spec: ModelSpec): Dtype {
  if (selDtype.value && selDtype.value !== '__auto') return selDtype.value as Dtype;
  return spec.dtype[pickDevice()];
}

function loadModel(force = false): Promise<void> {
  const spec = lastSpec;
  const dtype = dtypeFor(spec);
  const device = pickDevice();
  const key = `${spec.id}|${dtype}|${device}`;
  if (!force && loadedKey === key) return Promise.resolve();

  progress.hidden = false;
  progressFill.style.width = '0%';
  progressLabel.textContent = '准备中…';
  badgeModel.textContent = '载入中…';
  badgeModel.className = 'badge warn';

  return new Promise<void>((resolve, reject) => {
    pendingLoad = { resolve, reject };
    worker.postMessage({ type: 'load', model: spec.id, dtype, device });
  });
}

async function runModel(blob: Blob) {
  const id = ++runSeq;
  return new Promise<{ alpha: Uint8ClampedArray; width: number; height: number; timings: any }>(
    (resolve, reject) => {
      pendingRuns.set(id, { resolve, reject });
      worker.postMessage({ type: 'run', id, blob });
    },
  );
}

/* ─────────────────────────── 合成 ─────────────────────────── */
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  if (!source || !alpha) return;
  const { width: w, height: h } = source;
  const src = source.pixels;
  const m = alpha;
  const threshold = parseFloat(rngThreshold.value);
  const gamma = parseFloat(rngGamma.value);
  const invert = chkInvert.checked;

  let r = 0, g = 0, b = 0;
  if (bgMode === 'color') {
    const hex = inpColor.value;
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }

  const out = new ImageData(w, h);
  const dst = out.data;
  // Threshold below ~1 is a soft ramp; gamma bends the falloff.
  const thr = Math.min(threshold, 0.999);
  const span = 1 - thr;

  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    let a = m[i] / 255;
    if (invert) a = 1 - a;
    a = span > 0 ? (a - thr) / span : a >= thr ? 1 : 0;
    if (a < 0) a = 0;
    else if (a > 1) a = 1;
    a = Math.pow(a, gamma);

    const sr = src[p], sg = src[p + 1], sb = src[p + 2];
    if (bgMode === 'transparent') {
      dst[p] = sr; dst[p + 1] = sg; dst[p + 2] = sb; dst[p + 3] = a * 255;
    } else if (bgMode === 'color') {
      dst[p] = r * (1 - a) + sr * a;
      dst[p + 1] = g * (1 - a) + sg * a;
      dst[p + 2] = b * (1 - a) + sb * a;
      dst[p + 3] = 255;
    } else {
      // keep the original behind a dimmed veil, so you can see what got cut
      const v = 0.22;
      dst[p] = sr * v * (1 - a) + sr * a;
      dst[p + 1] = sg * v * (1 - a) + sg * a;
      dst[p + 2] = sb * v * (1 - a) + sb * a;
      dst[p + 3] = 255;
    }
  }

  canvasResult.width = w;
  canvasResult.height = h;
  canvasResult.getContext('2d', { willReadFrequently: false })!.putImageData(out, 0, 0);
}

/* ─────────────────────────── 对比框尺寸 ─────────────────────────── */
function fitFrame() {
  if (!source) return;
  const pad = 40;
  const cw = dropzone.clientWidth - pad;
  const ch = dropzone.clientHeight - pad;
  const scale = Math.min(cw / source.width, ch / source.height, 1);
  frame.style.width = `${Math.round(source.width * scale)}px`;
  frame.style.height = `${Math.round(source.height * scale)}px`;
}

function setSplit(p: number) {
  splitAt = Math.max(0, Math.min(1, p));
  handle.style.left = `${splitAt * 100}%`;
  // Left of the handle: the cut-out result. Right of it: the untouched original.
  // Both halves have to be clipped — leaving the original unclipped would show it
  // through the result's transparent pixels and the cut-out would look like nothing happened.
  canvasResult.style.clipPath = `inset(0 ${((1 - splitAt) * 100).toFixed(3)}% 0 0)`;
  imgOriginal.style.clipPath = `inset(0 0 0 ${(splitAt * 100).toFixed(3)}%)`;
}

/* ─────────────────────────── 文件处理 ─────────────────────────── */
async function acceptFile(file: File | Blob) {
  if (!file.type.startsWith('image/')) return;
  const bitmap = await createImageBitmap(file);
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

  if (source) URL.revokeObjectURL(source.url);
  const url = URL.createObjectURL(file);
  source = {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    pixels: imgData.data,
    url,
  };
  alpha = null;

  imgOriginal.src = url;
  empty.hidden = true;
  compare.hidden = false;
  checker.style.display = 'block';
  imgOriginal.style.clipPath = 'none';
  fitFrame();
  setSplit(0.5);
  btnDownload.disabled = true;
  btnDownloadMask.disabled = true;

  await infer(file);
}

/** WebGPU blows up per-model (shader storage-buffer limits), not per-image. */
function isWebgpuLimitError(err: unknown) {
  const m = String((err as any)?.message ?? err);
  return /webgpu|ShaderHelper|storage buffer|maxStorageBuffers|OrtRun/i.test(m);
}

function shortError(err: unknown) {
  const m = String((err as any)?.message ?? err).replace(/\s+/g, ' ').trim();
  return m.length > 110 ? `${m.slice(0, 110)}…` : m;
}

async function infer(blob: Blob) {
  busy.hidden = false;
  busyText.textContent = loadedKey ? '推理中…' : '第一次用这个模型，正在下载权重…';
  const notes: string[] = [];

  try {
    await loadModel();
    busyText.textContent = '推理中…';

    let device = pickDevice();
    let res: Awaited<ReturnType<typeof runModel>>;
    try {
      res = await runModel(blob);
    } catch (err) {
      if (device !== 'webgpu') throw err;
      notes.push(`WebGPU 跑不动这个模型（${shortError(err)}）→ 已回退 WASM`);
      selDevice.value = 'wasm';
      await loadModel(true);
      device = 'wasm';
      busyText.textContent = '回退 WASM 重跑…';
      res = await runModel(blob);
    }

    // Degenerate mask guard: some fp16 exports collapse to all-zero / all-one.
    // Detect it and retry once in fp32 rather than silently shipping a blank PNG.
    const fg = coverage(res.alpha);
    const autoDtype = selDtype.value === '__auto';
    if ((fg < 0.002 || fg > 0.998) && autoDtype && pickDevice() === 'webgpu' && dtypeFor(lastSpec) !== 'fp32') {
      notes.push('遮罩全空/全满 → 已自动回退 fp32 重跑');
      selDtype.value = 'fp32';
      await loadModel(true);
      busyText.textContent = '回退 fp32 重跑…';
      res = await runModel(blob);
      selDtype.value = '__auto';
    }

    alpha = res.alpha;
    render();
    btnDownload.disabled = false;
    btnDownloadMask.disabled = false;
    const head = `推理 ${res.timings.inferMs} ms · 后处理 ${res.timings.postMs} ms · ${source!.width}×${source!.height}`;
    timings.textContent = notes.length ? `${head}\n${notes.join('\n')}` : head;
  } catch (err: any) {
    timings.textContent = `出错了：${shortError(err)}`;
    console.error(err);
  } finally {
    busy.hidden = true;
  }
}

function coverage(m: Uint8ClampedArray) {
  let n = 0;
  for (let i = 0; i < m.length; i += 4) if (m[i] > 127) n++;
  return n / (m.length / 4);
}

/* ─────────────────────────── 事件绑定 ─────────────────────────── */
for (const m of MODELS) {
  const opt = document.createElement('option');
  opt.value = m.id;
  opt.textContent = `${m.label} · 约 ${m.sizeMB} MB`;
  selModel.appendChild(opt);
}

for (const d of DTYPES) {
  const opt = document.createElement('option');
  opt.value = d;
  opt.textContent = d;
  selDtype.appendChild(opt);
}
const autoOpt = document.createElement('option');
autoOpt.value = '__auto';
autoOpt.textContent = '推荐（自动）';
selDtype.prepend(autoOpt);
selDtype.value = '__auto';

function syncModelNote() {
  lastSpec = modelById(selModel.value);
  modelNote.textContent = `${lastSpec.note} 授权：${lastSpec.license}`;
}
selModel.value = MODELS[0].id;
syncModelNote();
selModel.addEventListener('change', () => {
  syncModelNote();
  loadedKey = '';
  badgeModel.textContent = '未载入模型';
  badgeModel.className = 'badge';
});
selDtype.addEventListener('change', () => (loadedKey = ''));
selDevice.addEventListener('change', () => (loadedKey = ''));
selDevice.value = hasWebGPU ? 'auto' : 'wasm';

btnLoad.addEventListener('click', async () => {
  busy.hidden = false;
  busyText.textContent = '载入模型…';
  try {
    await loadModel(true);
  } catch (err: any) {
    timings.textContent = `载入失败：${err?.message ?? err}`;
  } finally {
    busy.hidden = true;
  }
});
btnRelease.addEventListener('click', () => {
  worker.postMessage({ type: 'dispose' });
  alpha = null;
  btnDownload.disabled = true;
  btnDownloadMask.disabled = true;
  timings.textContent = '模型已释放';
});

for (const el of [rngThreshold, rngGamma, chkInvert]) {
  el.addEventListener('input', () => {
    valThreshold.textContent = parseFloat(rngThreshold.value).toFixed(2);
    valGamma.textContent = parseFloat(rngGamma.value).toFixed(2);
    scheduleRender();
  });
}
inpColor.addEventListener('input', scheduleRender);
bgModes.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  bgMode = btn.dataset.mode as BgMode;
  for (const b of bgModes.querySelectorAll('button')) b.classList.toggle('active', b === btn);
  colorField.hidden = bgMode !== 'color';
  scheduleRender();
});

dropzone.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.handle')) return;
  if (empty.hidden) return;
  fileInput.click();
});
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) acceptFile(f);
  fileInput.value = '';
});
['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  }),
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  }),
);
dropzone.addEventListener('drop', (e) => {
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) acceptFile(f);
});
window.addEventListener('paste', (e) => {
  const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
  const f = item?.getAsFile();
  if (f) acceptFile(f);
});

// compare slider
let dragging = false;
const splitFromEvent = (e: PointerEvent | MouseEvent) => {
  const r = frame.getBoundingClientRect();
  setSplit((e.clientX - r.left) / r.width);
};
handle.addEventListener('pointerdown', (e) => {
  dragging = true;
  handle.setPointerCapture(e.pointerId);
  e.stopPropagation();
});
handle.addEventListener('pointermove', (e) => dragging && splitFromEvent(e));
handle.addEventListener('pointerup', (e) => {
  dragging = false;
  handle.releasePointerCapture(e.pointerId);
});
compare.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('.handle')) return;
  splitFromEvent(e);
});

// downloads
function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

btnDownload.addEventListener('click', () => {
  canvasResult.toBlob((b) => b && download(b, `cutout-${Date.now()}.png`), 'image/png');
});
btnDownloadMask.addEventListener('click', () => {
  if (!source || !alpha) return;
  const c = document.createElement('canvas');
  c.width = source.width;
  c.height = source.height;
  const ctx = c.getContext('2d')!;
  const out = ctx.createImageData(source.width, source.height);
  let v = alpha;
  if (chkInvert.checked) {
    v = new Uint8ClampedArray(alpha.length);
    for (let i = 0; i < alpha.length; i++) v[i] = 255 - alpha[i];
  }
  for (let i = 0, p = 0; i < v.length; i++, p += 4) {
    out.data[p] = out.data[p + 1] = out.data[p + 2] = v[i];
    out.data[p + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  c.toBlob((b) => b && download(b, `mask-${Date.now()}.png`), 'image/png');
});

new ResizeObserver(fitFrame).observe(dropzone);
window.addEventListener('resize', fitFrame);

setSplit(0.5);
initDeviceBadge();
