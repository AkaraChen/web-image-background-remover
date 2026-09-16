export type BgMode = 'transparent' | 'color' | 'dim';
export type Tool = 'compare' | 'erase' | 'restore';
export type AppMode = 'upload' | 'editor';
export type EditorTab = 'cutout' | 'background' | 'adjust';

export type Source = {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  url: string;
};

export type View = { zoom: number; x: number; y: number };

export type BrushCursor = {
  hidden: boolean;
  width: number;
  height: number;
  left: number;
  top: number;
  erase: boolean;
  restore: boolean;
};

export type CutoutUi = {
  mode: AppMode;
  tab: EditorTab;
  tool: Tool;
  bgMode: BgMode;
  color: string;
  threshold: number;
  gamma: number;
  invert: boolean;
  brushRadius: number;
  canUndo: boolean;
  canRedo: boolean;
  brushDisabled: boolean;
  brushTitle: string;
  downloadsDisabled: boolean;
  emptyHidden: boolean;
  compareHidden: boolean;
  checkerOn: boolean;
  handleHidden: boolean;
  busyHidden: boolean;
  busyText: string;
  progressHidden: boolean;
  progressPct: number;
  progressLabel: string;
  badgeDevice: string;
  badgeDeviceClass: string;
  badgeModel: string;
  badgeModelClass: string;
  timings: string;
  stageHint: string;
  modelId: string;
  dtype: string;
  device: string;
  modelNote: string;
  dropOverlayHidden: boolean;
  dropzoneDragover: boolean;
  dropzoneBrushOn: boolean;
  dropzonePanning: boolean;
  dropzoneIsPanning: boolean;
  imgSrc: string;
  imgClip: string;
  canvasClip: string;
  frameW: number;
  frameH: number;
  view: View;
  splitAt: number;
  lastStrokeNote: string;
  webgpuAdapterOk: boolean;
  rmbgBooted: boolean;
  rmbgBootAt: number | null;
  probeAlive: { type: string; t?: number } | null;
  forceSamWasm: boolean;
  brushCursor: BrushCursor;
};
