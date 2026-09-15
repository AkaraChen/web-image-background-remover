export type Pt = { x: number; y: number };

export type StrokeKind = 'erase' | 'restore';

export interface Stroke {
  id: number;
  /** Raw pointer path, kept for prompt regeneration and history. */
  points: Pt[];
  radius: number;
  kind: StrokeKind;
  /** SAM decoder output, 0–255, image-sized. A stroke only exists once SAM produced this. */
  samMask: Uint8ClampedArray;
}

export const BRUSH_MIN = 4;
export const BRUSH_MAX = 160;

let nextStrokeId = 1;

export function createStroke(init: {
  points: Pt[];
  radius: number;
  kind: StrokeKind;
  samMask: Uint8ClampedArray;
}): Stroke {
  return { id: nextStrokeId++, ...init };
}

export function clampRadius(r: number): number {
  return Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, Math.round(r)));
}

export function extractAlpha(pixels: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 3; i < alpha.length; i++, p += 4) alpha[i] = pixels[p];
  return alpha;
}

export function sampleAlong(points: Pt[], spacing: number): Pt[] {
  if (points.length === 0) return [];
  const out: Pt[] = [{ x: points[0].x, y: points[0].y }];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    let x = points[i - 1].x;
    let y = points[i - 1].y;
    const x1 = points[i].x;
    const y1 = points[i].y;
    let dx = x1 - x;
    let dy = y1 - y;
    let dist = Math.hypot(dx, dy);
    if (dist === 0) continue;
    while (carry + dist >= spacing) {
      const t = (spacing - carry) / dist;
      x += dx * t;
      y += dy * t;
      out.push({ x, y });
      dx = x1 - x;
      dy = y1 - y;
      dist = Math.hypot(dx, dy);
      carry = 0;
    }
    carry += dist;
  }
  return out;
}

/** Mutates `alpha` in place. `kind` is order-sensitive: later strokes cover earlier ones. */
export function mixAlpha(alpha: Uint8ClampedArray, mask: Uint8ClampedArray, kind: StrokeKind): void {
  const n = Math.min(alpha.length, mask.length);
  if (kind === 'erase') {
    for (let i = 0; i < n; i++) {
      alpha[i] = alpha[i] * (1 - mask[i] / 255);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const a = alpha[i] / 255;
      const m = mask[i] / 255;
      alpha[i] = (a + (1 - a) * m) * 255;
    }
  }
}

export class StrokeStack {
  strokes: Stroke[] = [];
  redoStack: Stroke[] = [];

  push(stroke: Stroke) {
    this.strokes.push(stroke);
    this.redoStack = [];
  }

  undo(): boolean {
    const s = this.strokes.pop();
    if (!s) return false;
    this.redoStack.push(s);
    return true;
  }

  redo(): boolean {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.strokes.push(s);
    return true;
  }

  clear() {
    this.strokes = [];
    this.redoStack = [];
  }

  get canUndo() {
    return this.strokes.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}

/**
 * Replay strokes onto a base alpha. History is the stroke list.
 * Every stroke carries its SAM decoder mask, so undo/redo never
 * re-runs the decoder and no geometry rasterization exists anymore.
 */
export class BrushEngine {
  width = 0;
  height = 0;
  readonly stack = new StrokeStack();
  private committed: Uint8ClampedArray | null = null;
  private committedFrom: Uint8ClampedArray | null = null;

  reset(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.stack.clear();
    this.committed = null;
    this.committedFrom = null;
  }

  invalidate() {
    this.committed = null;
    this.committedFrom = null;
  }

  private rebuildCommitted(base: Uint8ClampedArray) {
    const out = new Uint8ClampedArray(base);
    for (const stroke of this.stack.strokes) {
      if (stroke.samMask.length !== this.width * this.height) continue;
      mixAlpha(out, stroke.samMask, stroke.kind);
    }
    this.committed = out;
    this.committedFrom = base;
  }

  /** Call only after SAM decoding succeeded; a stroke without a mask does not exist. */
  commit(stroke: Stroke) {
    if (stroke.points.length === 0) return;
    this.stack.push(stroke);
    this.invalidate();
  }

  undo(): boolean {
    if (!this.stack.undo()) return false;
    this.invalidate();
    return true;
  }

  redo(): boolean {
    if (!this.stack.redo()) return false;
    this.invalidate();
    return true;
  }

  /** Start from `base` (auto-cutout alpha) and replay strokes in order. */
  apply(base: Uint8ClampedArray): Uint8ClampedArray {
    if (this.width === 0 || base.length !== this.width * this.height) {
      return new Uint8ClampedArray(base);
    }
    if (!this.committed || this.committedFrom !== base) {
      this.rebuildCommitted(base);
    }
    return new Uint8ClampedArray(this.committed!);
  }
}
