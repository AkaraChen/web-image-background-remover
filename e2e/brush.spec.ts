import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'e2e', 'evidence');
const sample = path.join(root, 'docs', 'demo', 'sample-input.jpg');

type AlphaStats = {
  width: number;
  height: number;
  pixels: number;
  transparent: number;
  minAlpha: number;
  meanAlpha: number;
};

async function canvasStats(page: Page): Promise<AlphaStats> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="canvas-result"]') as HTMLCanvasElement | null;
    if (!c || c.width === 0) throw new Error('canvas not ready');
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2d context missing');
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let transparent = 0;
    let sum = 0;
    let minAlpha = 255;
    for (let i = 3; i < data.length; i += 4) {
      const a = data[i];
      sum += a;
      if (a < minAlpha) minAlpha = a;
      if (a < 250) transparent++;
    }
    const pixels = width * height;
    return { width, height, pixels, transparent, minAlpha, meanAlpha: sum / pixels };
  });
}

async function waitCanvas(page: Page) {
  await page.waitForFunction(() => {
    const c = document.querySelector('[data-testid="canvas-result"]') as HTMLCanvasElement | null;
    return !!c && c.width > 0 && c.height > 0 && !c.closest('#compare')?.hasAttribute('hidden');
  });
}

async function paintStroke(page: Page) {
  const box = await page.getByTestId('canvas-result').boundingBox();
  if (!box) throw new Error('canvas has no box');
  const y = box.y + box.height * 0.5;
  const x0 = box.x + box.width * 0.22;
  const x1 = box.x + box.width * 0.78;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y);
  }
  await page.mouse.up();
  await expect(page.getByTestId('btn-undo')).toBeEnabled();
}

test.beforeAll(() => {
  fs.mkdirSync(evidenceDir, { recursive: true });
});

test('P0 brush, undo/redo, PNG export work without a model', async ({ page }) => {
  await page.route(/huggingface\.co|hf\.co/, (route) => route.abort());

  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);

  const before = await canvasStats(page);
  await page.screenshot({ path: path.join(evidenceDir, '01-loaded.png'), fullPage: true });

  await page.getByTestId('tool-brush').click();
  await page.getByTestId('rng-radius').fill('48');
  await paintStroke(page);
  // compositing is rAF-scheduled
  await page.waitForTimeout(80);
  const brushed = await canvasStats(page);
  await page.screenshot({ path: path.join(evidenceDir, '02-brushed.png'), fullPage: true });

  expect(brushed.transparent, 'stroke should punch alpha holes').toBeGreaterThan(200);
  expect(brushed.minAlpha).toBeLessThan(before.minAlpha);

  await page.getByTestId('btn-undo').click();
  await page.waitForTimeout(80);
  const undone = await canvasStats(page);
  await page.screenshot({ path: path.join(evidenceDir, '03-undone.png'), fullPage: true });
  expect(undone.transparent).toBeLessThan(brushed.transparent / 4);
  await expect(page.getByTestId('btn-redo')).toBeEnabled();

  await page.getByTestId('btn-redo').click();
  await page.waitForTimeout(80);
  const redone = await canvasStats(page);
  await page.screenshot({ path: path.join(evidenceDir, '04-redone.png'), fullPage: true });
  expect(redone.transparent).toBeGreaterThan(200);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('btn-download').click(),
  ]);
  const exportPath = path.join(evidenceDir, 'export.png');
  await download.saveAs(exportPath);
  const buf = fs.readFileSync(exportPath);
  expect(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBeTruthy();

  const b64 = buf.toString('base64');
  const exported = await page.evaluate(async (pngB64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${pngB64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('decode canvas missing');
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let transparent = 0;
    let minAlpha = 255;
    for (let i = 3; i < data.length; i += 4) {
      const a = data[i];
      if (a < minAlpha) minAlpha = a;
      if (a < 250) transparent++;
    }
    return { width, height, transparent, minAlpha };
  }, b64);

  expect(exported.width).toBe(brushed.width);
  expect(exported.height).toBe(brushed.height);
  expect(exported.transparent).toBeGreaterThan(200);

  const report = {
    sample,
    abortedHub: true,
    before,
    brushed,
    undone,
    redone,
    exported,
    exportBytes: buf.length,
    exportPath: 'e2e/evidence/export.png',
    screenshots: [
      'e2e/evidence/01-loaded.png',
      'e2e/evidence/02-brushed.png',
      'e2e/evidence/03-undone.png',
      'e2e/evidence/04-redone.png',
    ],
  };
  fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify(report, null, 2));
});
