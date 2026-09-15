import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'e2e', 'evidence');
const sample = path.join(root, 'docs', 'demo', 'sample-input.jpg');

async function canvasStats(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="canvas-result"]') as HTMLCanvasElement | null;
    if (!c || c.width === 0) throw new Error('canvas not ready');
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2d context missing');
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let sum = 0;
    for (let i = 3; i < data.length; i += 4) sum += data[i];
    return { width, height, meanAlpha: sum / (width * height) };
  });
}

async function waitCanvas(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const c = document.querySelector('[data-testid="canvas-result"]') as HTMLCanvasElement | null;
    return !!c && c.width > 0 && c.height > 0 && !c.closest('#compare')?.hasAttribute('hidden');
  });
}

test.beforeAll(() => {
  fs.mkdirSync(evidenceDir, { recursive: true });
});

test('P0 without a SAM model: brush is disabled with a reason, page still works', async ({ page }) => {
  await page.route(/huggingface\.co|hf\.co/, (route) => route.abort());

  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);

  // Either the WebGPU gate refuses to even load SAM (headless Chromium has no
// adapter), or the aborted hub makes the load itself fail. Both end states
// disable the brush; wait for whichever one this browser reaches.
  await page.waitForFunction(() => {
    const c = (window as unknown as { __cutout?: { sam?: { status: string }; webgpuAdapterOk?: boolean } }).__cutout;
    return c?.sam?.status === 'unavailable' || c?.webgpuAdapterOk === false;
  });
  await expect(page.getByTestId('tool-brush')).toBeDisabled();
  await expect(page.getByTestId('tool-restore')).toBeDisabled();
  const title = (await page.getByTestId('tool-brush').getAttribute('title')) ?? '';
  expect(title).toMatch(/SAM 未就绪，画笔不可用/);
  expect(title.length).toBeGreaterThan('SAM 未就绪，画笔不可用：'.length); // a real reason follows

  const loaded = await canvasStats(page);
  await page.screenshot({ path: path.join(evidenceDir, '01-loaded.png'), fullPage: true });

  // Undo/redo stay inert: strokes only exist after a SAM decode.
  await expect(page.getByTestId('btn-undo')).toBeDisabled();
  await expect(page.getByTestId('btn-redo')).toBeDisabled();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('btn-download').click(),
  ]);
  const exportPath = path.join(evidenceDir, 'export.png');
  await download.saveAs(exportPath);
  const buf = fs.readFileSync(exportPath);
  expect(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBeTruthy();

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
    let sum = 0;
    for (let i = 3; i < data.length; i += 4) sum += data[i];
    return { width, height, meanAlpha: sum / (width * height) };
  }, buf.toString('base64'));

  expect(exported.width).toBe(loaded.width);
  expect(exported.height).toBe(loaded.height);

  const report = {
    sample,
    abortedHub: true,
    brushTooltip: title,
    loaded,
    exported,
    exportBytes: buf.length,
    screenshots: ['e2e/evidence/01-loaded.png'],
  };
  fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify(report, null, 2));
});
