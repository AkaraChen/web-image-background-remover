if (import.meta.env.DEV) {
  import("react-grab");
}

import './style.css';
import { MODELS, DTYPES, modelById, type Dtype, type ModelSpec } from './models';
import {
  BrushEngine,
  clampRadius,
  createStroke,
  extractAlpha,
  type Pt,
  type StrokeKind,
} from './brush';
import { strokeToPrompts, type SamDevice } from './sam';
import { SamClient } from './sam-client';

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
const toolModes = $<HTMLDivElement>('tool-modes');
const rngRadius = $<HTMLInputElement>('rng-radius');
const valRadius = $<HTMLElement>('val-radius');
const btnUndo = $<HTMLButtonElement>('btn-undo');
const btnRedo = $<HTMLButtonElement>('btn-redo');
const brushCursor = $<HTMLDivElement>('brush-cursor');
const stageHint = $<HTMLParagraphElement>('stage-hint');

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
const editorTabs = $<HTMLElement>('editor-tabs');
const bgSwatches = $<HTMLDivElement>('bg-swatches');
const dropOverlay = $<HTMLDivElement>('drop-overlay');
const btnUpload = $<HTMLButtonElement>('btn-upload');
const btnNew = $<HTMLButtonElement>('btn-new');
const btnHome = $<HTMLAnchorElement>('btn-home');
const btnZoomIn = $<HTMLButtonElement>('btn-zoom-in');
const btnZoomOut = $<HTMLButtonElement>('btn-zoom-out');
const btnZoomReset = $<HTMLButtonElement>('btn-zoom-reset');

/* ─────────────────────────── 状态 ─────────────────────────── */
type BgMode = 'transparent' | 'color' | 'dim';
type Tool = 'compare' | 'erase' | 'restore';

/** A stroke being dragged; it only becomes a Stroke once SAM decodes it. */
interface PendingStroke {
  points: Pt[];
  radius: number;
  kind: StrokeKind;
}

interface Source {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  url: string;
}

const params = new URLSearchParams(location.search);
/** Test/debug only: force SlimSAM onto WASM even without WebGPU. */
const forceSamWasm = params.get('sam') === 'wasm';

let source: Source | null = null;
let sourceBlob: Blob | null = null;
let alpha: Uint8ClampedArray | null = null; // one byte per pixel, sized to the source
let baseAlpha = new Uint8ClampedArray(0);
let effectiveAlpha: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(0);
let bgMode: BgMode = 'transparent';
let splitAt = 0.5;
let runSeq = 0;
let loadedKey = '';
let lastSpec: ModelSpec = MODELS[0];
let webgpuAdapterOk = false;

let tool: Tool = 'compare';
let brushRadius = 24;
const brush = new BrushEngine();
let liveStroke: PendingStroke | null = null;
let lastStrokeNote = '—';
let view = { zoom: 1, x: 0, y: 0 };
let spaceDown = false;
let panning = false;
let panLast = { x: 0, y: 0 };
let lastPointer: { clientX: number; clientY: number } | null = null;
let samImageToken = 0;

const sam = new SamClient(() => syncSamUi());

function isBrush() {
  return tool === 'erase' || tool === 'restore';
}

function brushKind(): StrokeKind {
  return tool === 'restore' ? 'restore' : 'erase';
}

/* ─────────────────────────── 后端探测 ─────────────────────────── */
const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

async function detectWebGPU(): Promise<boolean> {
  if (!hasWebGPU) return false;
  try {
    const adapter = await (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu?.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

async function initDeviceBadge() {
  if (!hasWebGPU) {
    webgpuAdapterOk = false;
    badgeDevice.textContent = '无 WebGPU · 走 WASM';
    badgeDevice.className = 'badge warn';
    selDevice.value = 'wasm';
    syncSamUi();
    return;
  }
  const ok = await detectWebGPU();
  webgpuAdapterOk = ok;
  if (ok) {
    const adapter = await (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<any> } }).gpu!.requestAdapter();
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
  syncSamUi();
}

function samBlockReason(): string | null {
  if (forceSamWasm) return null;
  if (!webgpuAdapterOk) {
    return '无 WebGPU。交互闸门要 WebGPU（WASM 每笔过不了 150 ms），画笔已禁用。';
  }
  return null;
}

function pickSamBackend(): { device: SamDevice; dtype: string } {
  if (forceSamWasm || !webgpuAdapterOk) return { device: 'wasm', dtype: 'q8' };
  return { device: 'webgpu', dtype: 'fp16' };
}

/* ─────────────────────────── Worker ─────────────────────────── */
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

interface PendingRun {
  resolve: (r: { alpha: Uint8ClampedArray; width: number; height: number; timings: any }) => void;
  reject: (e: Error) => void;
}
const pendingRuns = new Map<number, PendingRun>();
let pendingLoad: { resolve: () => void; reject: (e: Error) => void } | null = null;

let rmbgBooted = false;
let rmbgBootAt: number | null = null;
let rmbgDead = false;
let probeAlive: { type: string; t?: number } | null = null;

function failRmbg(err: Error) {
  rmbgDead = true;
  pendingLoad?.reject(err);
  pendingLoad = null;
  for (const [, p] of pendingRuns) p.reject(err);
  pendingRuns.clear();
  badgeModel.textContent = '载入失败';
  badgeModel.className = 'badge warn';
}

worker.onerror = (e) => {
  failRmbg(new Error([e.message, e.filename].filter(Boolean).join(' ').trim() || 'RMBG worker failed to load'));
};
worker.onmessageerror = () => {
  failRmbg(new Error('RMBG worker message deserialize failed'));
};

if (import.meta.env.DEV) {
  const probe = new Worker(new URL('./probe-worker.ts', import.meta.url), { type: 'module' });
  probe.onmessage = (e: MessageEvent<{ type: string; t?: number }>) => {
    probeAlive = e.data;
    probe.terminate();
  };
}

worker.onmessage = (e: MessageEvent<any>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'worker-boot':
      rmbgBooted = true;
      rmbgBootAt = typeof msg.t === 'number' ? msg.t : performance.now();
      break;
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
      if (msg.where === 'boot') {
        failRmbg(err);
      } else if (msg.where === 'load' && pendingLoad) {
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
  if (rmbgDead) return Promise.reject(new Error('RMBG worker failed to load'));
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

function fillBaseAlpha(w: number, h: number, m: Uint8ClampedArray) {
  if (baseAlpha.length !== w * h) baseAlpha = new Uint8ClampedArray(w * h);
  const threshold = parseFloat(rngThreshold.value);
  const gamma = parseFloat(rngGamma.value);
  const invert = chkInvert.checked;
  const thr = Math.min(threshold, 0.999);
  const span = 1 - thr;
  for (let i = 0; i < w * h; i++) {
    let a = m[i] / 255;
    if (invert) a = 1 - a;
    a = span > 0 ? (a - thr) / span : a >= thr ? 1 : 0;
    if (a < 0) a = 0;
    else if (a > 1) a = 1;
    a = Math.pow(a, gamma);
    baseAlpha[i] = a * 255;
  }
}

function render() {
  if (!source || !alpha) return;
  const { width: w, height: h } = source;
  const src = source.pixels;
  const m = alpha;

  fillBaseAlpha(w, h, m);
  effectiveAlpha = brush.apply(baseAlpha);

  let r = 0, g = 0, b = 0;
  if (bgMode === 'color') {
    const hex = inpColor.value;
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }

  const out = new ImageData(w, h);
  const dst = out.data;

  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const a = effectiveAlpha[i] / 255;
    const sr = src[p], sg = src[p + 1], sb = src[p + 2];
    if (bgMode === 'transparent') {
      dst[p] = sr; dst[p + 1] = sg; dst[p + 2] = sb; dst[p + 3] = a * 255;
    } else if (bgMode === 'color') {
      dst[p] = r * (1 - a) + sr * a;
      dst[p + 1] = g * (1 - a) + sg * a;
      dst[p + 2] = b * (1 - a) + sb * a;
      dst[p + 3] = 255;
    } else {
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
  const pad = 48;
  const cw = Math.max(1, dropzone.clientWidth - pad);
  const ch = Math.max(1, dropzone.clientHeight - pad);
  const scale = Math.min(cw / source.width, ch / source.height);
  frame.style.width = `${Math.round(source.width * scale)}px`;
  frame.style.height = `${Math.round(source.height * scale)}px`;
  applyView();
}

function applyView() {
  frame.style.transformOrigin = 'center center';
  frame.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  btnZoomReset.textContent = `${Math.round(view.zoom * 100)}%`;
}

function setMode(mode: 'upload' | 'editor') {
  document.body.classList.toggle('mode-upload', mode === 'upload');
  document.body.classList.toggle('mode-editor', mode === 'editor');
}

function setTab(tab: string) {
  for (const b of editorTabs.querySelectorAll('button')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
  for (const p of document.querySelectorAll<HTMLElement>('[data-panel]')) {
    p.hidden = p.dataset.panel !== tab;
  }
}

function setBgMode(mode: BgMode) {
  bgMode = mode;
  for (const b of bgModes.querySelectorAll('button')) b.classList.toggle('active', b.dataset.mode === mode);
  colorField.hidden = mode !== 'color';
  syncSwatches();
  scheduleRender();
}

function syncSwatches() {
  for (const b of bgSwatches.querySelectorAll('button')) {
    const force = b.dataset.forceMode;
    const color = (b.dataset.color ?? '').toLowerCase();
    const on =
      force === 'transparent'
        ? bgMode === 'transparent'
        : bgMode === 'color' && color === inpColor.value.toLowerCase();
    b.classList.toggle('active', on);
  }
}

function setZoom(next: number) {
  view.zoom = Math.max(0.2, Math.min(8, next));
  applyView();
}

function resetToUpload() {
  if (source) URL.revokeObjectURL(source.url);
  source = null;
  sourceBlob = null;
  alpha = null;
  liveStroke = null;
  lastStrokeNote = '—';
  samImageToken += 1;
  imgOriginal.removeAttribute('src');
  empty.hidden = false;
  compare.hidden = true;
  checker.style.display = 'none';
  btnDownload.disabled = true;
  btnDownloadMask.disabled = true;
  timings.textContent = '—';
  setMode('upload');
  setTab('cutout');
  setTool('compare');
  resetView();
  syncBrushUi();
  syncSamUi();
}

function resetView() {
  view = { zoom: 1, x: 0, y: 0 };
  applyView();
}

function syncBrushUi() {
  btnUndo.disabled = !brush.stack.canUndo;
  btnRedo.disabled = !brush.stack.canRedo;
  rngRadius.value = String(brushRadius);
  valRadius.textContent = String(brushRadius);
}

/**
 * SAM state lives in the brush buttons themselves, not in a status readout:
 * usable exactly when SAM can decode; otherwise disabled with the reason in
 * the tooltip. `lastStrokeNote` remains on __cutout for tests.
 */
function syncSamUi() {
  const blocked = samBlockReason();
  let reason: string;
  if (blocked) reason = blocked;
  else if (sam.status === 'unloaded') reason = '载入图片后自动加载';
  else if (sam.status === 'loading') reason = sam.reason ? `加载中 · ${sam.reason}` : '加载中';
  else if (sam.status === 'encoding') reason = '编码图像中';
  else if (sam.status === 'unavailable') reason = sam.reason || '未知原因';
  else reason = '';

  const brushOk = samCanDecode();
  for (const b of toolModes.querySelectorAll<HTMLButtonElement>('button[data-tool="erase"], button[data-tool="restore"]')) {
    b.disabled = !brushOk;
    b.title = brushOk ? '' : `SAM 未就绪，画笔不可用：${reason}`;
  }
  if (isBrush() && !brushOk) setTool('compare');
}

function refreshComposite() {
  scheduleRender();
  syncBrushUi();
}

function imageFromEvent(e: PointerEvent | MouseEvent): Pt | null {
  if (!source) return null;
  const r = canvasResult.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return {
    x: ((e.clientX - r.left) / r.width) * source.width,
    y: ((e.clientY - r.top) / r.height) * source.height,
  };
}

function setTool(next: Tool) {
  if (next !== 'compare' && !samCanDecode()) return;
  tool = next;
  for (const b of toolModes.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.tool === next);
  }
  dropzone.classList.toggle('brush-on', isBrush());
  handle.hidden = isBrush();
  stageHint.textContent = isBrush()
    ? `在主体上涂抹即可${tool === 'restore' ? '恢复' : '擦除'} · 松开后由 SAM 生成选区 · [ ] 调半径 · 空格拖动画布`
    : '拖动分隔条对比原图 · ⌘滚轮缩放 · 空格拖动';
  if (isBrush()) {
    canvasResult.style.clipPath = 'none';
    imgOriginal.style.clipPath = 'inset(0 0 0 100%)';
  } else {
    brushCursor.hidden = true;
    dropzone.style.cursor = '';
    setSplit(splitAt);
  }
}

async function ensureSam() {
  const blocked = samBlockReason();
  if (blocked) {
    syncSamUi();
    return;
  }
  try {
    if (sam.status === 'unloaded' || sam.status === 'unavailable') {
      const { device, dtype } = pickSamBackend();
      await sam.load(device, dtype);
    }
    await encodeCurrentIfNeeded();
  } catch {
    /* SamClient already records the reason */
  }
}

async function encodeCurrentIfNeeded() {
  if (!sourceBlob || !source) return;
  if (sam.status !== 'loading' && sam.status !== 'ready' && sam.status !== 'encoding') return;
  const token = ++samImageToken;
  try {
    const encoded = await sam.encode(sourceBlob);
    if (token !== samImageToken) return;
    if (encoded.width !== source.width || encoded.height !== source.height) {
      sam.status = 'unavailable';
      sam.reason = `编码尺寸 ${encoded.width}×${encoded.height} 对不上图像`;
      syncSamUi();
    }
  } catch {
    /* status set by client */
  }
}

function samCanDecode() {
  return (
    !samBlockReason() &&
    sam.status === 'ready' &&
    !!source &&
    sam.encodedSize?.width === source.width &&
    sam.encodedSize?.height === source.height
  );
}

/** The only stroke path: decode the pointer path through SAM and commit it with its mask. */
async function applyStrokeWithSam(points: Pt[], kind: StrokeKind, radius: number) {
  const src = source;
  if (!src) return;
  try {
    const prompts = strokeToPrompts(points, src.width, src.height);
    const res = await sam.decode(prompts.input_points, prompts.input_labels);
    if (source !== src || res.width !== src.width || res.height !== src.height) {
      lastStrokeNote = '本笔丢弃（SAM 结果与当前图像不匹配）';
      syncSamUi();
      return;
    }
    brush.commit(createStroke({ points, radius, kind, samMask: res.mask }));
    lastStrokeNote = `已应用 · 候选 ${res.bestIndex + 1}/3 · IoU ${res.bestIou.toFixed(3)} · decode ${Math.round(res.decodeMs)} ms`;
    refreshComposite();
    syncSamUi();
  } catch (err) {
    lastStrokeNote = `本笔丢弃（SAM 解码失败：${shortError(err)}）`;
    syncSamUi();
  }
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
  sourceBlob = file;
  alpha = extractAlpha(imgData.data, bitmap.width, bitmap.height);
  brush.reset(bitmap.width, bitmap.height);
  liveStroke = null;
  lastStrokeNote = '—';
  resetView();

  imgOriginal.src = url;
  empty.hidden = true;
  compare.hidden = false;
  checker.style.display = 'block';
  imgOriginal.style.clipPath = 'none';
  setMode('editor');
  setTab('cutout');
  fitFrame();
  setSplit(0.5);
  btnDownload.disabled = false;
  btnDownloadMask.disabled = false;
  syncBrushUi();
  syncSamUi();
  render();

  void ensureSam();
  void infer(file);
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
  const notes: string[] = [];
  timings.textContent = loadedKey ? '正在去除背景…' : '正在准备模型…';

  try {
    await loadModel();
    timings.textContent = '推理中…';

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
      timings.textContent = '回退 WASM 重跑…';
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
      timings.textContent = '回退 fp32 重跑…';
      res = await runModel(blob);
      selDtype.value = '__auto';
    }

    alpha = res.alpha;
    brush.invalidate();
    render();
    btnDownload.disabled = false;
    btnDownloadMask.disabled = false;
    const head = `推理 ${res.timings.inferMs} ms · 后处理 ${res.timings.postMs} ms · ${source!.width}×${source!.height}`;
    timings.textContent = notes.length ? `${head}\n${notes.join('\n')}` : head;
  } catch (err: any) {
    timings.textContent = `自动抠图未完成（${shortError(err)}）。笔刷仍可用。`;
    console.error(err);
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
  modelNote.title = modelNote.textContent;
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
  if (source) {
    alpha = extractAlpha(source.pixels, source.width, source.height);
    brush.invalidate();
    scheduleRender();
    btnDownload.disabled = false;
    btnDownloadMask.disabled = false;
  }
  timings.textContent = '模型已释放。笔刷仍可用。';
});

for (const el of [rngThreshold, rngGamma, chkInvert]) {
  el.addEventListener('input', () => {
    valThreshold.textContent = parseFloat(rngThreshold.value).toFixed(2);
    valGamma.textContent = parseFloat(rngGamma.value).toFixed(2);
    brush.invalidate();
    scheduleRender();
  });
}
inpColor.addEventListener('input', () => {
  syncSwatches();
  scheduleRender();
});
bgModes.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn?.dataset.mode) return;
  setBgMode(btn.dataset.mode as BgMode);
});
bgSwatches.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  if (btn.dataset.forceMode === 'transparent') {
    setBgMode('transparent');
    return;
  }
  if (btn.dataset.color) {
    inpColor.value = btn.dataset.color;
    setBgMode('color');
  }
});
editorTabs.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn?.dataset.tab) return;
  setTab(btn.dataset.tab);
});
btnUpload.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});
btnNew.addEventListener('click', resetToUpload);
btnHome.addEventListener('click', (e) => {
  e.preventDefault();
  resetToUpload();
});
btnZoomIn.addEventListener('click', () => setZoom(view.zoom * 1.08));
btnZoomOut.addEventListener('click', () => setZoom(view.zoom / 1.08));
btnZoomReset.addEventListener('click', () => {
  view.x = 0;
  view.y = 0;
  setZoom(1);
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
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth += 1;
  dropOverlay.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  dropzone.classList.remove('dragover');
  const f = e.dataTransfer?.files?.[0];
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
  if (isBrush()) return;
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
  if (isBrush() || spaceDown) return;
  if ((e.target as HTMLElement).closest('.handle')) return;
  splitFromEvent(e);
});

toolModes.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn?.dataset.tool) return;
  setTool(btn.dataset.tool as Tool);
});
rngRadius.addEventListener('input', () => {
  brushRadius = clampRadius(parseFloat(rngRadius.value));
  syncBrushUi();
});
btnUndo.addEventListener('click', () => {
  if (brush.undo()) refreshComposite();
});
btnRedo.addEventListener('click', () => {
  if (brush.redo()) refreshComposite();
});

function placeCursor(e: { clientX: number; clientY: number }) {
  lastPointer = { clientX: e.clientX, clientY: e.clientY };
  if (!isBrush() || !source || spaceDown) {
    brushCursor.hidden = true;
    return;
  }
  const r = canvasResult.getBoundingClientRect();
  const scale = r.width / source.width;
  const size = Math.max(6, brushRadius * 2 * scale);
  brushCursor.hidden = false;
  brushCursor.style.width = `${size}px`;
  brushCursor.style.height = `${size}px`;
  brushCursor.style.left = `${e.clientX}px`;
  brushCursor.style.top = `${e.clientY}px`;
  brushCursor.classList.toggle('kind-erase', brushKind() === 'erase');
  brushCursor.classList.toggle('kind-restore', brushKind() === 'restore');
  brushCursor.classList.add('source-sam');
}

compare.addEventListener('pointermove', (e) => {
  if (panning) {
    view.x += e.clientX - panLast.x;
    view.y += e.clientY - panLast.y;
    panLast = { x: e.clientX, y: e.clientY };
    applyView();
    return;
  }
  if (liveStroke) {
    const pt = imageFromEvent(e);
    if (pt) liveStroke.points.push(pt);
  }
  placeCursor(e);
});
compare.addEventListener('pointerdown', (e) => {
  if (!source) return;
  if (spaceDown) {
    panning = true;
    dropzone.classList.add('is-panning');
    panLast = { x: e.clientX, y: e.clientY };
    compare.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  if (!isBrush()) return;
  if (e.button !== 0 || !samCanDecode()) return;
  const pt = imageFromEvent(e);
  if (!pt) return;
  liveStroke = { points: [pt], radius: brushRadius, kind: brushKind() };
  compare.setPointerCapture(e.pointerId);
  refreshComposite();
  placeCursor(e);
  e.preventDefault();
});
function endPan(e: PointerEvent) {
  if (!panning) return;
  panning = false;
  dropzone.classList.remove('is-panning');
  try {
    compare.releasePointerCapture(e.pointerId);
  } catch {
    /* already released */
  }
}

function endStroke(e: PointerEvent) {
  if (panning) {
    endPan(e);
    return;
  }
  if (!liveStroke) return;
  const { points, radius, kind } = liveStroke;
  liveStroke = null;
  if (!samCanDecode() || points.length === 0) {
    lastStrokeNote = points.length === 0 ? '—' : `本笔丢弃（SAM 不可用：${samBlockReason() || sam.reason || '尚未就绪'}）`;
    refreshComposite();
    syncSamUi();
  } else {
    lastStrokeNote = '解码中…';
    syncSamUi();
    void applyStrokeWithSam(points, kind, radius);
  }
  try {
    compare.releasePointerCapture(e.pointerId);
  } catch {
    /* already released */
  }
}

compare.addEventListener('pointerup', endStroke);
compare.addEventListener('pointercancel', endStroke);
compare.addEventListener('lostpointercapture', (e) => {
  if (panning) endPan(e);
  else if (liveStroke) endStroke(e);
});
compare.addEventListener('pointerleave', () => {
  if (!liveStroke) brushCursor.hidden = true;
});

dropzone.addEventListener(
  'wheel',
  (e) => {
    if (!source) return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      view.zoom = Math.max(0.2, Math.min(8, view.zoom * factor));
      applyView();
      return;
    }
    if (isBrush()) {
      e.preventDefault();
      const step = e.deltaY < 0 ? 2 : -2;
      brushRadius = clampRadius(brushRadius + step);
      syncBrushUi();
      placeCursor(e);
    }
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat) {
    if (source) e.preventDefault();
    spaceDown = true;
    dropzone.classList.add('panning');
    brushCursor.hidden = true;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      if (brush.redo()) refreshComposite();
    } else if (brush.undo()) {
      refreshComposite();
    }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    if (brush.redo()) refreshComposite();
    return;
  }
  if (e.key === '[') {
    e.preventDefault();
    brushRadius = clampRadius(brushRadius - 2);
    syncBrushUi();
    if (lastPointer) placeCursor(lastPointer);
  }
  if (e.key === ']') {
    e.preventDefault();
    brushRadius = clampRadius(brushRadius + 2);
    syncBrushUi();
    if (lastPointer) placeCursor(lastPointer);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceDown = false;
    panning = false;
    dropzone.classList.remove('panning', 'is-panning');
  }
});

setTool('compare');
syncSamUi();
syncSwatches();
setMode('upload');
setTab('cutout');

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
  if (!source || effectiveAlpha.length !== source.width * source.height) return;
  const c = document.createElement('canvas');
  c.width = source.width;
  c.height = source.height;
  const ctx = c.getContext('2d')!;
  const out = ctx.createImageData(source.width, source.height);
  const v = effectiveAlpha;
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

(window as unknown as { __cutout: Record<string, unknown> }).__cutout = {
  get brush() {
    return brush;
  },
  get sam() {
    return sam;
  },
  get tool() {
    return tool;
  },
  get lastStrokeNote() {
    return lastStrokeNote;
  },
  get forceSamWasm() {
    return forceSamWasm;
  },
  get webgpuAdapterOk() {
    return webgpuAdapterOk;
  },
  get rmbgBooted() {
    return rmbgBooted;
  },
  get rmbgBootAt() {
    return rmbgBootAt;
  },
  get probeAlive() {
    return probeAlive;
  },
  get effectiveAlpha() {
    return effectiveAlpha;
  },
  get view() {
    return view;
  },
};

void isWebgpuLimitError;
