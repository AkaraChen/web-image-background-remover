export type CutoutHost = {
  canvas: HTMLCanvasElement | null;
  dropzone: HTMLDivElement | null;
  frame: HTMLDivElement | null;
  img: HTMLImageElement | null;
  compare: HTMLDivElement | null;
  handle: HTMLDivElement | null;
  fileInput: HTMLInputElement | null;
  advDialog: HTMLDialogElement | null;
};

export const host: CutoutHost = {
  canvas: null,
  dropzone: null,
  frame: null,
  img: null,
  compare: null,
  handle: null,
  fileInput: null,
  advDialog: null,
};
