import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sample = path.join(root, 'docs', 'demo', 'sample-input.jpg');

export type RoiStats = {
  mean: number;
  min: number;
  max: number;
  n: number;
};

export async function waitCanvas(page: Page) {
  await page.waitForFunction(() => {
    const c = document.querySelector('[data-testid="canvas-result"]') as HTMLCanvasElement | null;
    return !!c && c.width > 0 && c.height > 0 && !c.closest('#compare')?.hasAttribute('hidden');
  });
}

export async function roiStats(
  page: Page,
  frac: { x0: number; y0: number; x1: number; y1: number },
): Promise<RoiStats> {
  return page.evaluate((f) => {
    const c = document.querySelector('[data-testid="canvas-result"]') as HTMLCanvasElement | null;
    if (!c || c.width === 0) throw new Error('canvas not ready');
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2d context missing');
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    const x0 = Math.floor(f.x0 * width);
    const y0 = Math.floor(f.y0 * height);
    const x1 = Math.ceil(f.x1 * width);
    const y1 = Math.ceil(f.y1 * height);
    let sum = 0;
    let n = 0;
    let min = 255;
    let max = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const a = data[(y * width + x) * 4 + 3];
        sum += a;
        n++;
        if (a < min) min = a;
        if (a > max) max = a;
      }
    }
    return { mean: n ? sum / n : 0, min, max, n };
  }, frac);
}

export async function dragFrac(
  page: Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  steps = 12,
) {
  const box = await page.getByTestId('canvas-result').boundingBox();
  if (!box) throw new Error('canvas has no box');
  const sx = box.x + box.width * x0;
  const sy = box.y + box.height * y0;
  const ex = box.x + box.width * x1;
  const ey = box.y + box.height * y1;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(sx + ((ex - sx) * i) / steps, sy + ((ey - sy) * i) / steps);
  }
  await page.mouse.up();
}

export async function abortHub(page: Page) {
  await page.route(/huggingface\.co|hf\.co/, (route) => route.abort());
}

export async function debug(page: Page) {
  return page.evaluate(() => {
    const c = (window as unknown as { __cutout?: Record<string, unknown> }).__cutout;
    if (!c) throw new Error('__cutout missing');
    const sam = c.sam as {
      status: string;
      encodeCount: number;
      decodeCount: number;
      reason: string;
      device: string | null;
    };
    return {
      tool: c.tool,
      lastStrokeNote: c.lastStrokeNote,
      forceSamWasm: c.forceSamWasm,
      webgpuAdapterOk: c.webgpuAdapterOk,
      view: c.view as { zoom: number; x: number; y: number },
      samStatus: sam.status,
      encodeCount: sam.encodeCount,
      decodeCount: sam.decodeCount,
      samReason: sam.reason,
      samDevice: sam.device,
      strokes: (c.brush as { stack: { strokes: { kind: string; samMask: Uint8Array }[] } }).stack.strokes.map((s) => ({
        kind: s.kind,
        hasMask: !!s.samMask && s.samMask.length > 0,
      })),
    };
  });
}
