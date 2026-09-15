export type Pt = { x: number; y: number };

export type StrokeKind = 'erase' | 'restore';
export type StrokeSource = 'geometry' | 'sam';

export interface Stroke {
  id: number;
  points: Pt[];
  radius: number;
  kind: StrokeKind;
  source: StrokeSource;
  /** SAM decoder output, 0–255, image-sized. Geometry is re-rasterized. */
  samMask?: Uint8ClampedArray;
}

export const BRUSH_MIN = 4;
export const BRUSH_MAX = 160;
export const FEATHER_PX = 1.25;

let nextStrokeId = 1;

export function createStroke(init: {
  points: Pt[];
  radius: number;
  kind: StrokeKind;
  source?: StrokeSource;
  samMask?: Uint8ClampedArray;
}): Stroke {
  return {
    id: nextStrokeId++,
    source: 'geometry',
    ...init,
  };
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

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function ctx2d(canvas: OffscreenCanvas | HTMLCanvasElement): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d context unavailable');
  return ctx as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
}

export function paintStroke(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  stroke: Pick<Stroke, 'points' | 'radius'>,
): void {
  if (stroke.points.length === 0) return;
  const spacing = Math.max(1, stroke.radius * 0.32);
  const stamps = sampleAlong(stroke.points, spacing);
  for (const p of stamps) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, stroke.radius);
    g.addColorStop(0, 'rgba(255,255,255,0.88)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.42)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, stroke.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function readMask(canvas: OffscreenCanvas | HTMLCanvasElement, width: number, height: number): Uint8ClampedArray {
  const ctx = ctx2d(canvas);
  const data = ctx.getImageData(0, 0, width, height).data;
  const mask = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 3; i < mask.length; i++, p += 4) mask[i] = data[p];
  return mask;
}

function featherCanvas(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, width: number, height: number) {
  const src = makeCanvas(width, height);
  ctx2d(src).drawImage(ctx.canvas, 0, 0);
  ctx.filter = `blur(${FEATHER_PX}px)`;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(src, 0, 0);
  ctx.filter = 'none';
}

export function rasterizeStroke(
  stroke: Pick<Stroke, 'points' | 'radius'>,
  width: number,
  height: number,
  feather = true,
): Uint8ClampedArray {
  const canvas = makeCanvas(width, height);
  const ctx = ctx2d(canvas);
  ctx.clearRect(0, 0, width, height);
  paintStroke(ctx, stroke);
  if (feather && stroke.points.length > 0) featherCanvas(ctx, width, height);
  return readMask(canvas, width, height);
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

  find(id: number): Stroke | undefined {
    return this.strokes.find((s) => s.id === id) ?? this.redoStack.find((s) => s.id === id);
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
 * Geometry is re-rasterized; SAM results are stored on the stroke so undo
 * does not re-run the decoder.
 */
export class BrushEngine {
  width = 0;
  height = 0;
  readonly stack = new StrokeStack();
  private rasterCache = new Map<number, Uint8ClampedArray>();
  private committed: Uint8ClampedArray | null = null;
  private committedFrom: Uint8ClampedArray | null = null;

  reset(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.stack.clear();
    this.rasterCache.clear();
    this.committed = null;
    this.committedFrom = null;
  }

  invalidate() {
    this.committed = null;
    this.committedFrom = null;
  }

  private strokeMask(stroke: Stroke, feather: boolean): Uint8ClampedArray {
    if (stroke.source === 'sam' && stroke.samMask && stroke.samMask.length === this.width * this.height) {
      return stroke.samMask;
    }
    const cached = this.rasterCache.get(stroke.id);
    if (cached) return cached;
    const mask = rasterizeStroke(stroke, this.width, this.height, feather);
    this.rasterCache.set(stroke.id, mask);
    return mask;
  }

  private rebuildCommitted(base: Uint8ClampedArray) {
    const out = new Uint8ClampedArray(base);
    for (const stroke of this.stack.strokes) {
      mixAlpha(out, this.strokeMask(stroke, true), stroke.kind);
    }
    this.committed = out;
    this.committedFrom = base;
  }

  commit(stroke: Stroke) {
    if (stroke.points.length === 0) return;
    this.stack.push(stroke);
    this.invalidate();
  }

  attachSamMask(id: number, mask: Uint8ClampedArray): boolean {
    const stroke = this.stack.find(id);
    if (!stroke) return false;
    stroke.source = 'sam';
    stroke.samMask = mask;
    this.rasterCache.delete(id);
    this.invalidate();
    return this.stack.strokes.some((s) => s.id === id);
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
  apply(base: Uint8ClampedArray, live: Stroke | null = null): Uint8ClampedArray {
    if (this.width === 0 || base.length !== this.width * this.height) {
      return new Uint8ClampedArray(base);
    }
    if (!this.committed || this.committedFrom !== base) {
      this.rebuildCommitted(base);
    }
    const committed = this.committed!;
    if (!live || live.points.length === 0) return new Uint8ClampedArray(committed);
    const out = new Uint8ClampedArray(committed);
    mixAlpha(out, rasterizeStroke(live, this.width, this.height, false), live.kind);
    return out;
  }
}
