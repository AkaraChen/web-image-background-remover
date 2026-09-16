import { create } from 'zustand';
import { CutoutRuntime, defaultUi } from '../cutout/runtime';
import type { CutoutUi } from '../cutout/types';

export type CutoutStore = CutoutUi & {
  runtime: CutoutRuntime;
};

export const useCutoutStore = create<CutoutStore>((set, get) => {
  const runtime = new CutoutRuntime({
    get: () => get(),
    set: (partial) => set(partial),
  });
  return {
    ...defaultUi(),
    runtime,
  };
});

export function getRuntime() {
  return useCutoutStore.getState().runtime;
}

export function installDebugBridge() {
  window.__cutout = {
    get brush() {
      return getRuntime().brush;
    },
    get sam() {
      return getRuntime().sam;
    },
    get tool() {
      return useCutoutStore.getState().tool;
    },
    get lastStrokeNote() {
      return useCutoutStore.getState().lastStrokeNote;
    },
    get forceSamWasm() {
      return useCutoutStore.getState().forceSamWasm;
    },
    get webgpuAdapterOk() {
      return useCutoutStore.getState().webgpuAdapterOk;
    },
    get rmbgBooted() {
      return useCutoutStore.getState().rmbgBooted;
    },
    get rmbgBootAt() {
      return useCutoutStore.getState().rmbgBootAt;
    },
    get probeAlive() {
      return useCutoutStore.getState().probeAlive;
    },
    get effectiveAlpha() {
      return getRuntime().effectiveAlpha;
    },
    get view() {
      return useCutoutStore.getState().view;
    },
  };
}

installDebugBridge();
