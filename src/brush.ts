export type Pt = { x: number; y: number };

export interface Stroke {
  points: Pt[];
  radius: number;
}

export const BRUSH_MIN = 4;
export const BRUSH_MAX = 160;
export const FEATHER_PX = 1.25;

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
  stroke: Stroke,
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

/** Rasterize strokes into a 0–255 erase mask. History is the stroke list, not snapshots. */
export class BrushEngine {
  width = 0;
  height = 0;
  readonly stack = new StrokeStack();
  private committed: OffscreenCanvas | HTMLCanvasElement | null = null;

  reset(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.stack.clear();
    this.committed = makeCanvas(width, height);
    ctx2d(this.committed).clearRect(0, 0, width, height);
  }

  private rebuildCommitted() {
    const canvas = makeCanvas(this.width, this.height);
    const ctx = ctx2d(canvas);
    ctx.clearRect(0, 0, this.width, this.height);
    for (const stroke of this.stack.strokes) {
      paintStroke(ctx, stroke);
    }
    if (this.stack.strokes.length > 0) this.feather(ctx);
    this.committed = canvas;
  }

  private feather(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) {
    const src = makeCanvas(this.width, this.height);
    ctx2d(src).drawImage(ctx.canvas, 0, 0);
    ctx.filter = `blur(${FEATHER_PX}px)`;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(src, 0, 0);
    ctx.filter = 'none';
  }

  commit(stroke: Stroke) {
    if (stroke.points.length === 0) return;
    this.stack.push(stroke);
    this.rebuildCommitted();
  }

  undo(): boolean {
    if (!this.stack.undo()) return false;
    this.rebuildCommitted();
    return true;
  }

  redo(): boolean {
    if (!this.stack.redo()) return false;
    this.rebuildCommitted();
    return true;
  }

  mask(live: Stroke | null = null): Uint8ClampedArray {
    if (!this.committed || this.width === 0) return new Uint8ClampedArray(0);
    if (!live || live.points.length === 0) return readMask(this.committed, this.width, this.height);
    const canvas = makeCanvas(this.width, this.height);
    const ctx = ctx2d(canvas);
    ctx.drawImage(this.committed, 0, 0);
    paintStroke(ctx, live);
    return readMask(canvas, this.width, this.height);
  }
}
