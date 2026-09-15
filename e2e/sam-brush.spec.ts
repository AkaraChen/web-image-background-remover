import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { debug, dragFrac, roiStats, root, sample, waitCanvas } from './helpers';

const evidenceDir = path.join(root, 'e2e', 'evidence', 'sam');

test.beforeAll(() => {
  fs.mkdirSync(evidenceDir, { recursive: true });
});

/**
 * Pure-SAM brush: strokes only exist once the decoder returned a mask.
 * This test owns the correctness story that geometry painting used to cover:
 * erase lowers alpha, a later restore raises it back, undo/redo replay
 * without re-running the decoder, and the encoder runs exactly once per image.
 */
test('WASM SAM: encode once, decode per stroke, undo/redo without re-decoding', async ({ page }) => {
  test.setTimeout(12 * 60 * 1000);
  page.setDefaultTimeout(12 * 60 * 1000);

  await page.goto('/?sam=wasm');
  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);

  // SAM loads by itself once an image exists; no mode switch exists anymore.
  await page.waitForFunction(() => {
    const c = (window as unknown as { __cutout?: { sam?: { status: string } } }).__cutout;
    return c?.sam?.status === 'ready' || c?.sam?.status === 'unavailable';
  });

  const afterEncode = await debug(page);
  fs.writeFileSync(path.join(evidenceDir, 'after-encode.json'), JSON.stringify(afterEncode, null, 2));
  expect(afterEncode.samStatus, afterEncode.samReason).toBe('ready');
  expect(afterEncode.samDevice).toBe('wasm');
  expect(afterEncode.encodeCount).toBe(1);
  await expect(page.getByTestId('tool-brush')).toBeEnabled();

  const before = await roiStats(page, { x0: 0.3, y0: 0.4, x1: 0.7, y1: 0.6 });

  // 1) erase stroke → committed only after decode, carrying its SAM mask.
  await page.getByTestId('tool-brush').click();
  await page.getByTestId('rng-radius').fill('24');
  await dragFrac(page, 0.38, 0.5, 0.62, 0.5, 8);
  await page.waitForFunction(() => {
    const c = (window as unknown as { __cutout?: { sam?: { decodeCount: number } } }).__cutout;
    return (c?.sam?.decodeCount ?? 0) >= 1;
  });
  const afterFirst = await debug(page);
  const firstRoi = await roiStats(page, { x0: 0.3, y0: 0.4, x1: 0.7, y1: 0.6 });
  await page.screenshot({ path: path.join(evidenceDir, '01-first-stroke.png'), fullPage: true });

  expect(afterFirst.encodeCount).toBe(1);
  expect(afterFirst.decodeCount).toBe(1);
  expect(afterFirst.strokes[0]?.kind).toBe('erase');
  expect(afterFirst.strokes[0]?.hasMask).toBe(true);
  expect(firstRoi.mean).toBeLessThan(before.mean);

  // 2) restore stroke crossing the erase → later stroke wins where they overlap.
  await page.getByTestId('tool-restore').click();
  await dragFrac(page, 0.45, 0.35, 0.45, 0.65, 8);
  await page.waitForFunction(() => {
    const c = (window as unknown as { __cutout?: { sam?: { decodeCount: number } } }).__cutout;
    return (c?.sam?.decodeCount ?? 0) >= 2;
  });
  const afterSecond = await debug(page);
  const secondRoi = await roiStats(page, { x0: 0.4, y0: 0.42, x1: 0.5, y1: 0.58 });
  await page.screenshot({ path: path.join(evidenceDir, '02-second-stroke.png'), fullPage: true });

  expect(afterSecond.encodeCount, 'image unchanged → encoder must not rerun').toBe(1);
  expect(afterSecond.decodeCount).toBe(2);
  expect(afterSecond.strokes[1]?.kind).toBe('restore');
  expect(afterSecond.strokes[1]?.hasMask).toBe(true);
  expect(secondRoi.mean, 'later restore should raise the overlap region').toBeGreaterThan(firstRoi.mean + 20);

  // 3) undo drops the restore; redo brings it back — neither re-runs the decoder.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('btn-redo')).toBeEnabled();
  const afterUndo = await debug(page);
  expect(afterUndo.strokes.length).toBe(1);
  await page.keyboard.press('Control+Shift+z');
  const afterRedo = await debug(page);
  expect(afterRedo.strokes.length).toBe(2);
  expect(afterRedo.decodeCount, 'undo/redo must not re-run the decoder').toBe(2);

  // 4) a new image re-encodes exactly once more.
  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);
  await page.waitForFunction(() => {
    const c = (window as unknown as { __cutout?: { sam?: { encodeCount: number; status: string } } }).__cutout;
    return (c?.sam?.encodeCount ?? 0) >= 2 && c?.sam?.status === 'ready';
  });
  const afterReloaded = await debug(page);
  expect(afterReloaded.encodeCount).toBe(2);
  expect(afterReloaded.strokes.length, 'new image resets the stroke stack').toBe(0);

  const report = {
    note: 'WASM pipeline correctness only. Per-stroke <150 ms is missing proof on this builder (no WebGPU adapter).',
    webgpuRuntime: 'missing proof',
    afterEncode,
    afterFirst,
    before,
    firstRoi,
    afterSecond,
    secondRoi,
    afterUndo,
    afterRedo,
    afterReloaded,
  };
  fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify(report, null, 2));
});
