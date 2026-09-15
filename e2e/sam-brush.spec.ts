import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { debug, dragFrac, roiStats, root, sample, waitCanvas } from './helpers';

const evidenceDir = path.join(root, 'e2e', 'evidence', 'sam');

test.beforeAll(() => {
  fs.mkdirSync(evidenceDir, { recursive: true });
});

test('WASM SAM: encode once per image, decode per stroke, apply mask', async ({ page }) => {
  test.setTimeout(12 * 60 * 1000);
  page.setDefaultTimeout(12 * 60 * 1000);

  await page.goto('/?sam=wasm');
  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);
  await page.getByTestId('prompt-sam').click();

  await page.waitForFunction(() => {
    const c = (window as unknown as { __cutout?: { sam?: { status: string } } }).__cutout;
    return c?.sam?.status === 'ready' || c?.sam?.status === 'unavailable';
  });

  const afterEncode = await debug(page);
  fs.writeFileSync(path.join(evidenceDir, 'after-encode.json'), JSON.stringify(afterEncode, null, 2));
  expect(afterEncode.samStatus, afterEncode.samReason).toBe('ready');
  expect(afterEncode.samDevice).toBe('wasm');
  expect(afterEncode.encodeCount).toBe(1);

  const before = await roiStats(page, { x0: 0.3, y0: 0.4, x1: 0.7, y1: 0.6 });
  await page.getByTestId('tool-brush').click();
  await page.getByTestId('rng-radius').fill('24');
  await dragFrac(page, 0.38, 0.5, 0.62, 0.5, 8);

  await page.waitForFunction(() => {
    const c = (window as unknown as { __cutout?: { lastStrokeSource?: string } }).__cutout;
    return c?.lastStrokeSource === 'sam';
  });
  await page.waitForTimeout(80);
  const afterFirst = await debug(page);
  const firstRoi = await roiStats(page, { x0: 0.3, y0: 0.4, x1: 0.7, y1: 0.6 });
  await page.screenshot({ path: path.join(evidenceDir, '01-first-stroke.png'), fullPage: true });

  expect(afterFirst.encodeCount).toBe(1);
  expect(afterFirst.decodeCount).toBe(1);
  expect(afterFirst.lastStrokeSource).toBe('sam');
  expect(afterFirst.strokes[0]?.source).toBe('sam');
  expect(firstRoi.mean).toBeLessThan(before.mean);

  await dragFrac(page, 0.45, 0.35, 0.45, 0.65, 8);
  await page.waitForFunction(() => {
    const c = (window as unknown as { __cutout?: { sam?: { decodeCount: number } } }).__cutout;
    return (c?.sam?.decodeCount ?? 0) >= 2;
  });
  const afterSecond = await debug(page);
  await page.screenshot({ path: path.join(evidenceDir, '02-second-stroke.png'), fullPage: true });
  expect(afterSecond.encodeCount, 'image unchanged → encoder must not rerun').toBe(1);
  expect(afterSecond.decodeCount).toBe(2);

  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);
  await page.waitForFunction(() => {
    const c = (window as unknown as { __cutout?: { sam?: { encodeCount: number; status: string } } }).__cutout;
    return (c?.sam?.encodeCount ?? 0) >= 2 && c?.sam?.status === 'ready';
  });
  const afterReloaded = await debug(page);
  expect(afterReloaded.encodeCount).toBeGreaterThanOrEqual(2);

  const report = {
    note: 'WASM pipeline correctness only. Per-stroke <150 ms is missing proof on this builder (no WebGPU adapter).',
    webgpuRuntime: 'missing proof',
    afterEncode,
    afterFirst,
    firstRoi,
    before,
    afterSecond,
    afterReloaded,
  };
  fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify(report, null, 2));
});
