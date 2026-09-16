import { DTYPES, MODELS, modelById, type Dtype, type ModelSpec } from '../models';
import {
  BrushEngine,
  clampRadius,
  createStroke,
  extractAlpha,
  type Pt,
  type StrokeKind,
} from '../brush';
import { strokeToPrompts, type SamDevice } from '../sam';
import { SamClient } from '../sam-client';
import { host } from './host';
import type { AppMode, BgMode, CutoutUi, EditorTab, Source, Tool } from './types';

export type StoreSlice = {
  get: () => CutoutUi;
  set: (partial: Partial<CutoutUi>) => void;
};

const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

type PendingStroke = { points: Pt[]; radius: number; kind: StrokeKind };

export function defaultUi(): CutoutUi {
  const spec = MODELS[0];
  const params = new URLSearchParams(location.search);
  return {
    mode: 'upload',
    tab: 'cutout',
    tool: 'compare',
    bgMode: 'transparent',
    color: '#0F70E6',
    threshold: 0.5,
    gamma: 1,
    invert: false,
    brushRadius: 24,
    canUndo: false,
    canRedo: false,
    brushDisabled: true,
    brushTitle: 'SAM 未就绪，画笔不可用：载入图片后自动加载',
    downloadsDisabled: true,
    emptyHidden: false,
    compareHidden: true,
    checkerOn: false,
    handleHidden: false,
    busyHidden: true,
    busyText: '推理中…',
    progressHidden: true,
    progressPct: 0,
    progressLabel: '',
    badgeDevice: '检测中…',
    badgeDeviceClass: 'badge',
    badgeModel: '未载入模型',
    badgeModelClass: 'badge',
    timings: '—',
    stageHint: '拖动分隔条对比原图',
    modelId: spec.id,
    dtype: '__auto',
    device: hasWebGPU ? 'auto' : 'wasm',
    modelNote: `${spec.note} 授权：${spec.license}`,
    dropOverlayHidden: true,
    dropzoneDragover: false,
    dropzoneBrushOn: false,
    dropzonePanning: false,
    dropzoneIsPanning: false,
    imgSrc: '',
    imgClip: 'none',
    canvasClip: 'none',
    frameW: 0,
    frameH: 0,
    view: { zoom: 1, x: 0, y: 0 },
    splitAt: 0.5,
    lastStrokeNote: '—',
    webgpuAdapterOk: false,
    rmbgBooted: false,
    rmbgBootAt: null,
    probeAlive: null,
    forceSamWasm: params.get('sam') === 'wasm',
    brushCursor: { hidden: true, width: 0, height: 0, left: 0, top: 0, erase: false, restore: false },
  };
}

export const MODEL_OPTIONS = MODELS.map((m) => ({
  id: m.id,
  label: `${m.label} · 约 ${m.sizeMB} MB`,
}));

export const DTYPE_OPTIONS = [
  { id: '__auto', label: '推荐（自动）' },
  ...DTYPES.map((d) => ({ id: d, label: d })),
];

function isBrush(tool: Tool) {
  return tool === 'erase' || tool === 'restore';
}

function brushKind(tool: Tool): StrokeKind {
  return tool === 'restore' ? 'restore' : 'erase';
}

function shortError(err: unknown) {
  const m = String((err as { message?: string })?.message ?? err).replace(/\s+/g, ' ').trim();
  return m.length > 110 ? `${m.slice(0, 110)}…` : m;
}

function coverage(m: Uint8ClampedArray) {
  let n = 0;
  for (let i = 0; i < m.length; i += 4) if (m[i] > 127) n++;
  return n / (m.length / 4);
}

async function detectWebGPU(): Promise<boolean> {
  if (!hasWebGPU) return false;
  try {
    const adapter = await (
      navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }
    ).gpu?.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

export class CutoutRuntime {
  readonly brush = new BrushEngine();
  sam: SamClient;
  worker: Worker | null = null;
  probe: Worker | null = null;

  source: Source | null = null;
  sourceBlob: Blob | null = null;
  alpha: Uint8ClampedArray | null = null;
  baseAlpha = new Uint8ClampedArray(0);
  effectiveAlpha: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(0);

  liveStroke: PendingStroke | null = null;
  runSeq = 0;
  loadedKey = '';
  lastSpec: ModelSpec = MODELS[0];
  samImageToken = 0;

  spaceDown = false;
  panning = false;
  panLast = { x: 0, y: 0 };
  lastPointer: { clientX: number; clientY: number } | null = null;
  splitDragging = false;
  dragDepth = 0;

  rmbgDead = false;
  pendingRuns = new Map<
    number,
    {
      resolve: (r: { alpha: Uint8ClampedArray; width: number; height: number; timings: Record<string, number> }) => void;
      reject: (e: Error) => void;
    }
  >();
  pendingLoad: { resolve: () => void; reject: (e: Error) => void } | null = null;

  lastPaint = 0;
  pendingPaint: { label: string; pct: number } | null = null;
  paintTimer: number | undefined;
  renderQueued = false;

  private api: StoreSlice;

  constructor(api: StoreSlice) {
    this.api = api;
    this.sam = new SamClient(() => this.syncSamUi());
    this.worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
    this.worker.onerror = (e) => {
      this.failRmbg(new Error([e.message, e.filename].filter(Boolean).join(' ').trim() || 'RMBG worker failed to load'));
    };
    this.worker.onmessageerror = () => {
      this.failRmbg(new Error('RMBG worker message deserialize failed'));
    };
    this.worker.onmessage = (e: MessageEvent<Record<string, unknown>>) => this.onWorkerMessage(e.data);

    if (import.meta.env.DEV) {
      this.probe = new Worker(new URL('../probe-worker.ts', import.meta.url), { type: 'module' });
      this.probe.onmessage = (e: MessageEvent<{ type: string; t?: number }>) => {
        this.set({ probeAlive: e.data });
        this.probe?.terminate();
        this.probe = null;
      };
    }
  }

  private get ui() {
    return this.api.get();
  }

  private set(partial: Partial<CutoutUi>) {
    this.api.set(partial);
  }

  start() {
    this.setTool('compare');
    this.syncSamUi();
    this.applySplit(this.ui.splitAt);
    void this.initDeviceBadge();
  }

  private failRmbg(err: Error) {
    this.rmbgDead = true;
    this.pendingLoad?.reject(err);
    this.pendingLoad = null;
    for (const [, p] of this.pendingRuns) p.reject(err);
    this.pendingRuns.clear();
    this.set({ badgeModel: '载入失败', badgeModelClass: 'badge warn' });
  }

  private onWorkerMessage(msg: Record<string, unknown>) {
    switch (msg.type) {
      case 'worker-boot':
        this.set({
          rmbgBooted: true,
          rmbgBootAt: typeof msg.t === 'number' ? msg.t : performance.now(),
        });
        break;
      case 'progress': {
        const { status, file, loaded, total } = msg as {
          status: string;
          file: string;
          loaded: number;
          total: number;
        };
        this.set({ progressHidden: false });
        if (status === 'progress' && total) {
          this.paintProgress(
            status,
            `${file} · ${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`,
            (loaded / total) * 100,
          );
        } else if (status === 'done') {
          this.paintProgress(status, `${file} 已缓存`, 100);
        } else if (status === 'ready') {
          this.set({ progressLabel: '初始化推理会话…' });
        }
        break;
      }
      case 'ready':
        this.paintProgress('ready', '', 100, true);
        this.loadedKey = String(msg.key ?? '');
        this.set({
          badgeModel: `${this.lastSpec.label} · ${this.dtypeFor(this.lastSpec)}`,
          badgeModelClass: 'badge ok',
          progressHidden: true,
          progressPct: 0,
        });
        this.pendingLoad?.resolve();
        this.pendingLoad = null;
        break;
      case 'result': {
        const p = this.pendingRuns.get(msg.id as number);
        this.pendingRuns.delete(msg.id as number);
        p?.resolve(msg as never);
        break;
      }
      case 'error': {
        const err = new Error(String(msg.message ?? 'worker error'));
        if (msg.where === 'boot') this.failRmbg(err);
        else if (msg.where === 'load' && this.pendingLoad) {
          this.pendingLoad.reject(err);
          this.pendingLoad = null;
        } else if (msg.id != null) {
          const p = this.pendingRuns.get(msg.id as number);
          this.pendingRuns.delete(msg.id as number);
          p?.reject(err);
        } else console.error(err);
        break;
      }
      case 'disposed':
        this.loadedKey = '';
        this.set({ badgeModel: '未载入模型', badgeModelClass: 'badge' });
        break;
    }
  }

  private paintProgress(status: string, label: string, pct: number, force = false) {
    this.pendingPaint = { label, pct };
    const now = performance.now();
    const flush = () => {
      if (!this.pendingPaint) return;
      this.set({
        progressPct: Number(this.pendingPaint.pct.toFixed(2)),
        progressLabel: this.pendingPaint.label,
      });
      this.pendingPaint = null;
      this.lastPaint = performance.now();
    };
    if (force || now - this.lastPaint > 50) return flush();
    if (this.paintTimer === undefined) {
      this.paintTimer = window.setTimeout(() => {
        this.paintTimer = undefined;
        flush();
      }, 50);
    }
    void status;
  }

  private pickDevice(): 'webgpu' | 'wasm' {
    if (this.ui.device === 'auto') return hasWebGPU ? 'webgpu' : 'wasm';
    return this.ui.device as 'webgpu' | 'wasm';
  }

  private dtypeFor(spec: ModelSpec): Dtype {
    if (this.ui.dtype && this.ui.dtype !== '__auto') return this.ui.dtype as Dtype;
    return spec.dtype[this.pickDevice()];
  }

  private loadModel(force = false): Promise<void> {
    if (this.rmbgDead || !this.worker) return Promise.reject(new Error('RMBG worker failed to load'));
    const spec = this.lastSpec;
    const dtype = this.dtypeFor(spec);
    const device = this.pickDevice();
    const key = `${spec.id}|${dtype}|${device}`;
    if (!force && this.loadedKey === key) return Promise.resolve();
    this.set({
      progressHidden: false,
      progressPct: 0,
      progressLabel: '准备中…',
      badgeModel: '载入中…',
      badgeModelClass: 'badge warn',
    });
    return new Promise<void>((resolve, reject) => {
      this.pendingLoad = { resolve, reject };
      this.worker!.postMessage({ type: 'load', model: spec.id, dtype, device });
    });
  }

  private runModel(blob: Blob) {
    const id = ++this.runSeq;
    return new Promise<{ alpha: Uint8ClampedArray; width: number; height: number; timings: Record<string, number> }>(
      (resolve, reject) => {
        this.pendingRuns.set(id, { resolve, reject });
        this.worker!.postMessage({ type: 'run', id, blob });
      },
    );
  }

  scheduleRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private fillBaseAlpha(w: number, h: number, m: Uint8ClampedArray) {
    if (this.baseAlpha.length !== w * h) this.baseAlpha = new Uint8ClampedArray(w * h);
    const { threshold, gamma, invert } = this.ui;
    const thr = Math.min(threshold, 0.999);
    const span = 1 - thr;
    for (let i = 0; i < w * h; i++) {
      let a = m[i] / 255;
      if (invert) a = 1 - a;
      a = span > 0 ? (a - thr) / span : a >= thr ? 1 : 0;
      if (a < 0) a = 0;
      else if (a > 1) a = 1;
      this.baseAlpha[i] = Math.pow(a, gamma) * 255;
    }
  }

  render() {
    const canvas = host.canvas;
    if (!this.source || !this.alpha || !canvas) return;
    const { width: w, height: h } = this.source;
    const src = this.source.pixels;
    this.fillBaseAlpha(w, h, this.alpha);
    this.effectiveAlpha = this.brush.apply(this.baseAlpha);

    let r = 0,
      g = 0,
      b = 0;
    if (this.ui.bgMode === 'color') {
      const hex = this.ui.color;
      r = parseInt(hex.slice(1, 3), 16);
      g = parseInt(hex.slice(3, 5), 16);
      b = parseInt(hex.slice(5, 7), 16);
    }

    const out = new ImageData(w, h);
    const dst = out.data;
    const bgMode = this.ui.bgMode;
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const a = this.effectiveAlpha[i] / 255;
      const sr = src[p],
        sg = src[p + 1],
        sb = src[p + 2];
      if (bgMode === 'transparent') {
        dst[p] = sr;
        dst[p + 1] = sg;
        dst[p + 2] = sb;
        dst[p + 3] = a * 255;
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
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d', { willReadFrequently: false })!.putImageData(out, 0, 0);
  }

  fitFrame() {
    if (!this.source || !host.dropzone) return;
    const pad = 48;
    const cw = Math.max(1, host.dropzone.clientWidth - pad);
    const ch = Math.max(1, host.dropzone.clientHeight - pad);
    const scale = Math.min(cw / this.source.width, ch / this.source.height);
    this.set({
      frameW: Math.round(this.source.width * scale),
      frameH: Math.round(this.source.height * scale),
    });
  }

  setMode(mode: AppMode) {
    this.set({ mode });
    document.body.classList.toggle('mode-upload', mode === 'upload');
    document.body.classList.toggle('mode-editor', mode === 'editor');
  }

  setTab(tab: EditorTab) {
    this.set({ tab });
  }

  openAdvanced() {
    host.advDialog?.showModal();
  }

  closeAdvanced() {
    host.advDialog?.close();
  }

  onAdvancedBackdrop(e: MouseEvent) {
    if (e.target === host.advDialog) host.advDialog?.close();
  }

  setBgMode(mode: BgMode) {
    this.set({ bgMode: mode });
    this.scheduleRender();
  }

  setColor(color: string) {
    this.set({ color });
    this.scheduleRender();
  }

  pickSwatch(color: string, forceMode?: string) {
    if (forceMode === 'transparent') {
      this.setBgMode('transparent');
      return;
    }
    this.set({ color, bgMode: 'color' });
    this.scheduleRender();
  }

  setZoom(next: number) {
    this.set({ view: { ...this.ui.view, zoom: Math.max(0.2, Math.min(8, next)) } });
  }

  resetView() {
    this.set({ view: { zoom: 1, x: 0, y: 0 } });
  }

  zoomIn() {
    this.setZoom(this.ui.view.zoom * 1.08);
  }

  zoomOut() {
    this.setZoom(this.ui.view.zoom / 1.08);
  }

  zoomReset() {
    this.set({ view: { zoom: 1, x: 0, y: 0 } });
  }

  syncBrushUi() {
    this.set({
      canUndo: this.brush.stack.canUndo,
      canRedo: this.brush.stack.canRedo,
    });
  }

  samBlockReason(): string | null {
    if (this.ui.forceSamWasm) return null;
    if (!this.ui.webgpuAdapterOk) {
      return '无 WebGPU。交互闸门要 WebGPU（WASM 每笔过不了 150 ms），画笔已禁用。';
    }
    return null;
  }

  pickSamBackend(): { device: SamDevice; dtype: string } {
    if (this.ui.forceSamWasm || !this.ui.webgpuAdapterOk) return { device: 'wasm', dtype: 'q8' };
    return { device: 'webgpu', dtype: 'fp16' };
  }

  syncSamUi() {
    const blocked = this.samBlockReason();
    let reason: string;
    if (blocked) reason = blocked;
    else if (this.sam.status === 'unloaded') reason = '载入图片后自动加载';
    else if (this.sam.status === 'loading') reason = this.sam.reason ? `加载中 · ${this.sam.reason}` : '加载中';
    else if (this.sam.status === 'encoding') reason = '编码图像中';
    else if (this.sam.status === 'unavailable') reason = this.sam.reason || '未知原因';
    else reason = '';

    const brushOk = this.samCanDecode();
    this.set({
      brushDisabled: !brushOk,
      brushTitle: brushOk ? '' : `SAM 未就绪，画笔不可用：${reason}`,
    });
    if (isBrush(this.ui.tool) && !brushOk) this.setTool('compare');
  }

  refreshComposite() {
    this.scheduleRender();
    this.syncBrushUi();
  }

  imageFromEvent(e: { clientX: number; clientY: number }): Pt | null {
    if (!this.source || !host.canvas) return null;
    const r = host.canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return {
      x: ((e.clientX - r.left) / r.width) * this.source.width,
      y: ((e.clientY - r.top) / r.height) * this.source.height,
    };
  }

  applySplit(p: number) {
    const splitAt = Math.max(0, Math.min(1, p));
    if (isBrush(this.ui.tool)) {
      this.set({ splitAt, canvasClip: 'none', imgClip: 'inset(0 0 0 100%)' });
      return;
    }
    this.set({
      splitAt,
      canvasClip: `inset(0 ${((1 - splitAt) * 100).toFixed(3)}% 0 0)`,
      imgClip: `inset(0 0 0 ${(splitAt * 100).toFixed(3)}%)`,
    });
  }

  setTool(next: Tool) {
    if (next !== 'compare' && !this.samCanDecode()) return;
    const brush = isBrush(next);
    this.set({
      tool: next,
      dropzoneBrushOn: brush,
      handleHidden: brush,
      stageHint: brush
        ? `在主体上涂抹即可${next === 'restore' ? '恢复' : '擦除'} · 松开后由 SAM 生成选区 · [ ] 调半径 · 空格拖动画布`
        : '拖动分隔条对比原图 · ⌘滚轮缩放 · 空格拖动',
    });
    if (brush) {
      this.set({ canvasClip: 'none', imgClip: 'inset(0 0 0 100%)' });
    } else {
      this.set({ brushCursor: { ...this.ui.brushCursor, hidden: true } });
      this.applySplit(this.ui.splitAt);
    }
  }

  async ensureSam() {
    const blocked = this.samBlockReason();
    if (blocked) {
      this.syncSamUi();
      return;
    }
    try {
      if (this.sam.status === 'unloaded' || this.sam.status === 'unavailable') {
        const { device, dtype } = this.pickSamBackend();
        await this.sam.load(device, dtype);
      }
      await this.encodeCurrentIfNeeded();
    } catch {
      /* SamClient already records the reason */
    }
  }

  async encodeCurrentIfNeeded() {
    if (!this.sourceBlob || !this.source) return;
    if (this.sam.status !== 'loading' && this.sam.status !== 'ready' && this.sam.status !== 'encoding') return;
    const token = ++this.samImageToken;
    try {
      const encoded = await this.sam.encode(this.sourceBlob);
      if (token !== this.samImageToken) return;
      if (encoded.width !== this.source.width || encoded.height !== this.source.height) {
        this.sam.status = 'unavailable';
        this.sam.reason = `编码尺寸 ${encoded.width}×${encoded.height} 对不上图像`;
        this.syncSamUi();
      }
    } catch {
      /* status set by client */
    }
  }

  samCanDecode() {
    return (
      !this.samBlockReason() &&
      this.sam.status === 'ready' &&
      !!this.source &&
      this.sam.encodedSize?.width === this.source.width &&
      this.sam.encodedSize?.height === this.source.height
    );
  }

  async applyStrokeWithSam(points: Pt[], kind: StrokeKind, radius: number) {
    const src = this.source;
    if (!src) return;
    try {
      const prompts = strokeToPrompts(points, src.width, src.height);
      const res = await this.sam.decode(prompts.input_points, prompts.input_labels);
      if (this.source !== src || res.width !== src.width || res.height !== src.height) {
        this.set({ lastStrokeNote: '本笔丢弃（SAM 结果与当前图像不匹配）' });
        this.syncSamUi();
        return;
      }
      this.brush.commit(createStroke({ points, radius, kind, samMask: res.mask }));
      this.set({
        lastStrokeNote: `已应用 · 候选 ${res.bestIndex + 1}/3 · IoU ${res.bestIou.toFixed(3)} · decode ${Math.round(res.decodeMs)} ms`,
      });
      this.refreshComposite();
      this.syncSamUi();
    } catch (err) {
      this.set({ lastStrokeNote: `本笔丢弃（SAM 解码失败：${shortError(err)}）` });
      this.syncSamUi();
    }
  }

  resetToUpload() {
    if (this.source) URL.revokeObjectURL(this.source.url);
    this.source = null;
    this.sourceBlob = null;
    this.alpha = null;
    this.liveStroke = null;
    this.samImageToken += 1;
    this.set({
      lastStrokeNote: '—',
      imgSrc: '',
      emptyHidden: false,
      compareHidden: true,
      checkerOn: false,
      downloadsDisabled: true,
      timings: '—',
    });
    this.setMode('upload');
    this.setTab('cutout');
    this.setTool('compare');
    this.resetView();
    this.syncBrushUi();
    this.syncSamUi();
  }

  async acceptFile(file: File | Blob) {
    if (!file.type.startsWith('image/')) return;
    const bitmap = await createImageBitmap(file);
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    if (this.source) URL.revokeObjectURL(this.source.url);
    const url = URL.createObjectURL(file);
    this.source = {
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      pixels: imgData.data,
      url,
    };
    this.sourceBlob = file;
    this.alpha = extractAlpha(imgData.data, bitmap.width, bitmap.height);
    this.brush.reset(bitmap.width, bitmap.height);
    this.liveStroke = null;
    this.resetView();
    this.set({
      lastStrokeNote: '—',
      imgSrc: url,
      emptyHidden: true,
      compareHidden: false,
      checkerOn: true,
      imgClip: 'none',
      downloadsDisabled: false,
    });
    this.setMode('editor');
    this.setTab('cutout');
    this.fitFrame();
    this.applySplit(0.5);
    this.syncBrushUi();
    this.syncSamUi();
    this.render();
    void this.ensureSam();
    void this.infer(file);
  }

  async infer(blob: Blob) {
    const notes: string[] = [];
    this.set({ timings: this.loadedKey ? '正在去除背景…' : '正在准备模型…' });
    try {
      await this.loadModel();
      this.set({ timings: '推理中…' });
      let device = this.pickDevice();
      let res: Awaited<ReturnType<typeof this.runModel>>;
      try {
        res = await this.runModel(blob);
      } catch (err) {
        if (device !== 'webgpu') throw err;
        notes.push(`WebGPU 跑不动这个模型（${shortError(err)}）→ 已回退 WASM`);
        this.set({ device: 'wasm' });
        await this.loadModel(true);
        this.set({ timings: '回退 WASM 重跑…' });
        res = await this.runModel(blob);
      }
      const fg = coverage(res.alpha);
      if ((fg < 0.002 || fg > 0.998) && this.ui.dtype === '__auto' && this.pickDevice() === 'webgpu' && this.dtypeFor(this.lastSpec) !== 'fp32') {
        notes.push('遮罩全空/全满 → 已自动回退 fp32 重跑');
        this.set({ dtype: 'fp32' });
        await this.loadModel(true);
        this.set({ timings: '回退 fp32 重跑…' });
        res = await this.runModel(blob);
        this.set({ dtype: '__auto' });
      }
      this.alpha = res.alpha;
      this.brush.invalidate();
      this.render();
      this.set({ downloadsDisabled: false });
      const head = `推理 ${res.timings.inferMs} ms · 后处理 ${res.timings.postMs} ms · ${this.source!.width}×${this.source!.height}`;
      this.set({ timings: notes.length ? `${head}\n${notes.join('\n')}` : head });
    } catch (err: unknown) {
      this.set({ timings: `自动抠图未完成（${shortError(err)}）。笔刷仍可用。` });
      console.error(err);
    }
  }

  setModelId(id: string) {
    this.set({ modelId: id, badgeModel: '未载入模型', badgeModelClass: 'badge' });
    this.loadedKey = '';
    this.lastSpec = modelById(id);
    this.set({ modelNote: `${this.lastSpec.note} 授权：${this.lastSpec.license}` });
  }

  setDtype(dtype: string) {
    this.set({ dtype });
    this.loadedKey = '';
  }

  setDevice(device: string) {
    this.set({ device });
    this.loadedKey = '';
  }

  async loadClicked() {
    this.set({ busyHidden: false, busyText: '载入模型…' });
    try {
      await this.loadModel(true);
    } catch (err: unknown) {
      this.set({ timings: `载入失败：${(err as Error)?.message ?? err}` });
    } finally {
      this.set({ busyHidden: true });
    }
  }

  releaseClicked() {
    this.worker?.postMessage({ type: 'dispose' });
    if (this.source) {
      this.alpha = extractAlpha(this.source.pixels, this.source.width, this.source.height);
      this.brush.invalidate();
      this.scheduleRender();
      this.set({ downloadsDisabled: false });
    }
    this.set({ timings: '模型已释放。笔刷仍可用。' });
  }

  setAdjust(partial: { threshold?: number; gamma?: number; invert?: boolean }) {
    this.set(partial);
    this.brush.invalidate();
    this.scheduleRender();
  }

  setRadius(raw: number) {
    this.set({ brushRadius: clampRadius(raw) });
  }

  undo() {
    if (this.brush.undo()) this.refreshComposite();
  }

  redo() {
    if (this.brush.redo()) this.refreshComposite();
  }

  openFilePicker() {
    host.fileInput?.click();
  }

  onFileInputChange() {
    const f = host.fileInput?.files?.[0];
    if (f) void this.acceptFile(f);
    if (host.fileInput) host.fileInput.value = '';
  }

  placeCursor(e: { clientX: number; clientY: number }) {
    this.lastPointer = { clientX: e.clientX, clientY: e.clientY };
    if (!isBrush(this.ui.tool) || !this.source || this.spaceDown || !host.canvas) {
      this.set({ brushCursor: { ...this.ui.brushCursor, hidden: true } });
      return;
    }
    const r = host.canvas.getBoundingClientRect();
    const scale = r.width / this.source.width;
    const size = Math.max(6, this.ui.brushRadius * 2 * scale);
    this.set({
      brushCursor: {
        hidden: false,
        width: size,
        height: size,
        left: e.clientX,
        top: e.clientY,
        erase: brushKind(this.ui.tool) === 'erase',
        restore: brushKind(this.ui.tool) === 'restore',
      },
    });
  }

  hideCursorIfIdle() {
    if (!this.liveStroke) this.set({ brushCursor: { ...this.ui.brushCursor, hidden: true } });
  }

  onComparePointerMove(e: PointerEvent) {
    if (this.panning) {
      this.set({
        view: {
          ...this.ui.view,
          x: this.ui.view.x + e.clientX - this.panLast.x,
          y: this.ui.view.y + e.clientY - this.panLast.y,
        },
      });
      this.panLast = { x: e.clientX, y: e.clientY };
      return;
    }
    if (this.splitDragging) {
      this.splitFromEvent(e);
      return;
    }
    if (this.liveStroke) {
      const pt = this.imageFromEvent(e);
      if (pt) this.liveStroke.points.push(pt);
    }
    this.placeCursor(e);
  }

  splitFromEvent(e: { clientX: number }) {
    if (!host.frame) return;
    const r = host.frame.getBoundingClientRect();
    this.applySplit((e.clientX - r.left) / r.width);
  }

  onHandlePointerDown(e: PointerEvent) {
    if (isBrush(this.ui.tool)) return;
    this.splitDragging = true;
    host.handle?.setPointerCapture(e.pointerId);
    e.stopPropagation();
  }

  onHandlePointerMove(e: PointerEvent) {
    if (this.splitDragging) this.splitFromEvent(e);
  }

  onHandlePointerUp(e: PointerEvent) {
    this.splitDragging = false;
    try {
      host.handle?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  onComparePointerDown(e: PointerEvent) {
    if (!this.source) {
      if (!isBrush(this.ui.tool) && !this.spaceDown && !(e.target as HTMLElement).closest('.handle')) {
        this.splitFromEvent(e);
      }
      return;
    }
    if (this.spaceDown) {
      this.panning = true;
      this.set({ dropzoneIsPanning: true });
      this.panLast = { x: e.clientX, y: e.clientY };
      host.compare?.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (!isBrush(this.ui.tool)) {
      if (!(e.target as HTMLElement).closest('.handle')) this.splitFromEvent(e);
      return;
    }
    if (e.button !== 0 || !this.samCanDecode()) return;
    const pt = this.imageFromEvent(e);
    if (!pt) return;
    this.liveStroke = { points: [pt], radius: this.ui.brushRadius, kind: brushKind(this.ui.tool) };
    host.compare?.setPointerCapture(e.pointerId);
    this.refreshComposite();
    this.placeCursor(e);
    e.preventDefault();
  }

  endPan(e: PointerEvent) {
    if (!this.panning) return;
    this.panning = false;
    this.set({ dropzoneIsPanning: false });
    try {
      host.compare?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  endStroke(e: PointerEvent) {
    if (this.splitDragging) {
      this.onHandlePointerUp(e);
      return;
    }
    if (this.panning) {
      this.endPan(e);
      return;
    }
    if (!this.liveStroke) return;
    const { points, radius, kind } = this.liveStroke;
    this.liveStroke = null;
    if (!this.samCanDecode() || points.length === 0) {
      this.set({
        lastStrokeNote:
          points.length === 0 ? '—' : `本笔丢弃（SAM 不可用：${this.samBlockReason() || this.sam.reason || '尚未就绪'}）`,
      });
      this.refreshComposite();
      this.syncSamUi();
    } else {
      this.set({ lastStrokeNote: '解码中…' });
      this.syncSamUi();
      void this.applyStrokeWithSam(points, kind, radius);
    }
    try {
      host.compare?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  onLostCapture(e: PointerEvent) {
    if (this.panning) this.endPan(e);
    else if (this.liveStroke) this.endStroke(e);
  }

  onWheel(e: WheelEvent) {
    if (!this.source) return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      this.set({
        view: { ...this.ui.view, zoom: Math.max(0.2, Math.min(8, this.ui.view.zoom * factor)) },
      });
      return;
    }
    if (isBrush(this.ui.tool)) {
      e.preventDefault();
      this.set({ brushRadius: clampRadius(this.ui.brushRadius + (e.deltaY < 0 ? 2 : -2)) });
      this.placeCursor(e);
    }
  }

  onKeyDown(e: KeyboardEvent) {
    if (e.code === 'Space' && !e.repeat) {
      if (this.source) e.preventDefault();
      this.spaceDown = true;
      this.set({ dropzonePanning: true, brushCursor: { ...this.ui.brushCursor, hidden: true } });
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (e.key === '[') {
      e.preventDefault();
      this.set({ brushRadius: clampRadius(this.ui.brushRadius - 2) });
      if (this.lastPointer) this.placeCursor(this.lastPointer);
    }
    if (e.key === ']') {
      e.preventDefault();
      this.set({ brushRadius: clampRadius(this.ui.brushRadius + 2) });
      if (this.lastPointer) this.placeCursor(this.lastPointer);
    }
  }

  onKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') {
      this.spaceDown = false;
      this.panning = false;
      this.set({ dropzonePanning: false, dropzoneIsPanning: false });
    }
  }

  onWindowDragEnter(e: DragEvent) {
    e.preventDefault();
    this.dragDepth += 1;
    this.set({ dropOverlayHidden: false });
  }

  onWindowDragLeave() {
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.set({ dropOverlayHidden: true });
  }

  onWindowDrop(e: DragEvent) {
    e.preventDefault();
    this.dragDepth = 0;
    this.set({ dropOverlayHidden: true, dropzoneDragover: false });
    const f = e.dataTransfer?.files?.[0];
    if (f) void this.acceptFile(f);
  }

  onPaste(e: ClipboardEvent) {
    const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
    const f = item?.getAsFile();
    if (f) void this.acceptFile(f);
  }

  downloadBlob(blob: Blob, name: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  downloadResult() {
    host.canvas?.toBlob((b) => b && this.downloadBlob(b, `cutout-${Date.now()}.png`), 'image/png');
  }

  downloadMask() {
    if (!this.source || this.effectiveAlpha.length !== this.source.width * this.source.height) return;
    const c = document.createElement('canvas');
    c.width = this.source.width;
    c.height = this.source.height;
    const ctx = c.getContext('2d')!;
    const out = ctx.createImageData(this.source.width, this.source.height);
    const v = this.effectiveAlpha;
    for (let i = 0, p = 0; i < v.length; i++, p += 4) {
      out.data[p] = out.data[p + 1] = out.data[p + 2] = v[i];
      out.data[p + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    c.toBlob((b) => b && this.downloadBlob(b, `mask-${Date.now()}.png`), 'image/png');
  }

  async initDeviceBadge() {
    if (!hasWebGPU) {
      this.set({
        webgpuAdapterOk: false,
        badgeDevice: '无 WebGPU · 走 WASM',
        badgeDeviceClass: 'badge warn',
        device: 'wasm',
      });
      this.syncSamUi();
      return;
    }
    const ok = await detectWebGPU();
    if (ok) {
      const adapter = await (
        navigator as Navigator & {
          gpu?: {
            requestAdapter: () => Promise<{
              info?: { description?: string; vendor?: string; architecture?: string };
              requestAdapterInfo?: () => Promise<{ description?: string; vendor?: string; architecture?: string }>;
            }>;
          };
        }
      ).gpu!.requestAdapter();
      let label = 'WebGPU 可用';
      try {
        const info = adapter?.info ?? (adapter?.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
        if (info?.description || info?.vendor) {
          label = `WebGPU · ${info.description || [info.vendor, info.architecture].filter(Boolean).join(' ')}`;
        }
      } catch {
        /* optional */
      }
      this.set({ webgpuAdapterOk: true, badgeDevice: label, badgeDeviceClass: 'badge ok' });
    } else {
      this.set({
        webgpuAdapterOk: false,
        badgeDevice: 'WebGPU 不可用 · 走 WASM',
        badgeDeviceClass: 'badge warn',
        device: 'wasm',
      });
    }
    this.syncSamUi();
  }
}
