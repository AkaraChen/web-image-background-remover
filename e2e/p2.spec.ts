import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { abortHub, debug, dragFrac, roiStats, root, sample, waitCanvas } from './helpers';

const evidenceDir = path.join(root, 'e2e', 'evidence', 'p2');
const band = { x0: 0.18, y0: 0.46, x1: 0.24, y1: 0.54 };
const center = { x0: 0.47, y0: 0.47, x1: 0.53, y1: 0.53 };

test.beforeAll(() => {
  fs.mkdirSync(evidenceDir, { recursive: true });
});

test('P2 erase lowers alpha, restore raises it, later stroke wins', async ({ page }) => {
  await abortHub(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);

  const beforeBand = await roiStats(page, band);
  const beforeCenter = await roiStats(page, center);

  await page.getByTestId('tool-brush').click();
  await page.getByTestId('rng-radius').fill('70');
  await dragFrac(page, 0.12, 0.5, 0.88, 0.5);
  await page.waitForTimeout(80);
  const erasedBand = await roiStats(page, band);
  const erasedCenter = await roiStats(page, center);
  await page.screenshot({ path: path.join(evidenceDir, '01-erased.png'), fullPage: true });

  expect(erasedBand.mean, 'erase should drop band alpha').toBeLessThan(beforeBand.mean - 40);
  expect(erasedCenter.mean, 'erase should drop center alpha').toBeLessThan(beforeCenter.mean - 40);

  await page.getByTestId('tool-restore').click();
  await page.getByTestId('rng-radius').fill('28');
  await dragFrac(page, 0.5, 0.42, 0.5, 0.58);
  await page.waitForTimeout(80);
  const restoredBand = await roiStats(page, band);
  const restoredCenter = await roiStats(page, center);
  await page.screenshot({ path: path.join(evidenceDir, '02-restored-on-erase.png'), fullPage: true });

  expect(restoredCenter.mean, 'later restore should raise center').toBeGreaterThan(erasedCenter.mean + 40);
  expect(restoredBand.mean, 'band outside restore should stay erased').toBeLessThan(80);

  const [maskDl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('btn-download-mask').click(),
  ]);
  const maskPath = path.join(evidenceDir, 'effective-mask.png');
  await maskDl.saveAs(maskPath);
  const maskBuf = fs.readFileSync(maskPath);
  const maskB64 = maskBuf.toString('base64');
  const maskRoi = await page.evaluate(async (pngB64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${pngB64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('mask decode canvas missing');
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    const mean = (x0: number, y0: number, x1: number, y1: number) => {
      let sum = 0;
      let n = 0;
      for (let y = Math.floor(y0 * height); y < Math.ceil(y1 * height); y++) {
        for (let x = Math.floor(x0 * width); x < Math.ceil(x1 * width); x++) {
          sum += data[(y * width + x) * 4];
          n++;
        }
      }
      return sum / n;
    };
    return {
      width,
      height,
      band: mean(0.18, 0.46, 0.24, 0.54),
      center: mean(0.47, 0.47, 0.53, 0.53),
    };
  }, maskB64);

  expect(maskRoi.center, 'exported mask includes restore').toBeGreaterThan(maskRoi.band + 40);

  // reverse order on a fresh load: restore first, then erase — erase wins
  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);
  await page.getByTestId('tool-restore').click();
  await page.getByTestId('rng-radius').fill('28');
  await dragFrac(page, 0.5, 0.42, 0.5, 0.58);
  await page.waitForTimeout(80);
  const restoreFirst = await roiStats(page, center);

  await page.getByTestId('tool-brush').click();
  await page.getByTestId('rng-radius').fill('70');
  await dragFrac(page, 0.12, 0.5, 0.88, 0.5);
  await page.waitForTimeout(80);
  const eraseLastCenter = await roiStats(page, center);
  const eraseLastBand = await roiStats(page, band);
  await page.screenshot({ path: path.join(evidenceDir, '03-erase-on-restore.png'), fullPage: true });

  expect(eraseLastCenter.mean, 'later erase should cover earlier restore').toBeLessThan(restoreFirst.mean - 40);
  expect(eraseLastBand.mean).toBeLessThan(80);

  const report = {
    beforeBand,
    beforeCenter,
    erasedBand,
    erasedCenter,
    restoredBand,
    restoredCenter,
    maskRoi,
    restoreFirst,
    eraseLastCenter,
    eraseLastBand,
    debug: await debug(page),
  };
  fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify(report, null, 2));
});

test('promised keyboard shortcuts actually work', async ({ page }) => {
  await abortHub(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);
  await page.getByTestId('tool-brush').click();

  const startRadius = Number(await page.getByTestId('val-radius').textContent());
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  const afterInc = Number(await page.getByTestId('val-radius').textContent());
  expect(afterInc).toBe(startRadius + 4);
  await page.keyboard.press('[');
  const afterDec = Number(await page.getByTestId('val-radius').textContent());
  expect(afterDec).toBe(startRadius + 2);

  await page.getByTestId('rng-radius').fill('48');
  await dragFrac(page, 0.2, 0.5, 0.8, 0.5);
  await page.waitForTimeout(80);
  const brushed = await roiStats(page, { x0: 0.3, y0: 0.45, x1: 0.7, y1: 0.55 });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  const undone = await roiStats(page, { x0: 0.3, y0: 0.45, x1: 0.7, y1: 0.55 });
  expect(undone.mean).toBeGreaterThan(brushed.mean + 20);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(80);
  const redone = await roiStats(page, { x0: 0.3, y0: 0.45, x1: 0.7, y1: 0.55 });
  expect(redone.mean).toBeLessThan(undone.mean - 20);

  await page.getByTestId('dropzone').hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  const zoomed = await debug(page);
  expect(zoomed.view.zoom).toBeGreaterThan(1.05);

  await page.keyboard.down('Space');
  const box = await page.getByTestId('canvas-result').boundingBox();
  if (!box) throw new Error('no box');
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 150);
  await page.mouse.up();
  await page.keyboard.up('Space');
  const panned = await debug(page);
  expect(Math.abs(panned.view.x) + Math.abs(panned.view.y)).toBeGreaterThan(20);

  fs.writeFileSync(
    path.join(evidenceDir, 'keys.json'),
    JSON.stringify({ startRadius, afterInc, afterDec, brushed, undone, redone, zoomed: zoomed.view, panned: panned.view }, null, 2),
  );
});

test('SAM without WebGPU falls back to geometry and does not block', async ({ page }) => {
  await abortHub(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);
  await page.getByTestId('prompt-sam').click();
  const status = await page.getByTestId('sam-status').textContent();
  expect(status ?? '').toMatch(/不可用|无 WebGPU/);

  await page.getByTestId('tool-brush').click();
  await page.getByTestId('rng-radius').fill('48');
  await dragFrac(page, 0.2, 0.5, 0.8, 0.5);
  await page.waitForTimeout(80);
  const info = await debug(page);
  expect(info.lastStrokeSource).toBe('geometry');
  expect(info.encodeCount).toBe(0);
  const painted = await roiStats(page, { x0: 0.3, y0: 0.45, x1: 0.7, y1: 0.55 });
  expect(painted.mean).toBeLessThan(200);
  await expect(page.getByTestId('btn-undo')).toBeEnabled();

  fs.writeFileSync(path.join(evidenceDir, 'sam-fallback.json'), JSON.stringify({ status, info, painted }, null, 2));
  await page.screenshot({ path: path.join(evidenceDir, '04-sam-fallback.png'), fullPage: true });
});

test('SAM load failure with ?sam=wasm still paints geometrically', async ({ page }) => {
  await abortHub(page);
  await page.goto('/?sam=wasm');
  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);
  await page.getByTestId('prompt-sam').click();
  await page.waitForFunction(() => {
    const t = document.querySelector('[data-testid="sam-status"]')?.textContent ?? '';
    return /不可用/.test(t);
  });
  await page.getByTestId('tool-brush').click();
  await page.getByTestId('rng-radius').fill('40');
  await dragFrac(page, 0.25, 0.5, 0.75, 0.5);
  await page.waitForTimeout(80);
  const info = await debug(page);
  expect(info.lastStrokeSource).toBe('geometry');
  expect(info.forceSamWasm).toBeTruthy();
  const painted = await roiStats(page, { x0: 0.35, y0: 0.45, x1: 0.65, y1: 0.55 });
  expect(painted.mean).toBeLessThan(220);
  fs.writeFileSync(path.join(evidenceDir, 'sam-load-fail.json'), JSON.stringify({ info, painted }, null, 2));
});
