import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { abortHub, debug, root, sample, waitCanvas } from './helpers';

const evidenceDir = path.join(root, 'e2e', 'evidence', 'p2');

test.beforeAll(() => {
  fs.mkdirSync(evidenceDir, { recursive: true });
});

// The old "P2 erase lowers alpha, restore raises it, later stroke wins" test
// painted with geometry. Without a geometry fallback, stroke semantics live in
// e2e/sam-brush.spec.ts (real SAM decode), which asserts the same orderings.

test('promised keyboard shortcuts actually work', async ({ page }) => {
  await abortHub(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);

  const startRadius = Number(await page.getByTestId('val-radius').textContent());
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  const afterInc = Number(await page.getByTestId('val-radius').textContent());
  expect(afterInc).toBe(startRadius + 4);
  await page.keyboard.press('[');
  const afterDec = Number(await page.getByTestId('val-radius').textContent());
  expect(afterDec).toBe(startRadius + 2);

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
    JSON.stringify({ startRadius, afterInc, afterDec, zoomed: zoomed.view, panned: panned.view }, null, 2),
  );
});

test('when SAM cannot serve, the brush is disabled with a reason and never blocks the page', async ({ page }) => {
  await abortHub(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);

  // Headless Chromium: no WebGPU adapter → refused before loading.
  // A browser with WebGPU: hub aborted → the load itself fails.
  await page.waitForFunction(() => {
    const c = (window as unknown as { __cutout?: { sam?: { status: string }; webgpuAdapterOk?: boolean } }).__cutout;
    return c?.sam?.status === 'unavailable' || c?.webgpuAdapterOk === false;
  });
  const status = (await page.getByTestId('sam-status').textContent()) ?? '';
  expect(status).toMatch(/不可用/);

  await expect(page.getByTestId('tool-brush')).toBeDisabled();
  await expect(page.getByTestId('tool-restore')).toBeDisabled();
  const info = await debug(page);
  expect(info.tool).toBe('compare');
  expect(info.strokes.length).toBe(0);

  fs.writeFileSync(path.join(evidenceDir, 'sam-gated.json'), JSON.stringify({ status, info }, null, 2));
  await page.screenshot({ path: path.join(evidenceDir, '04-sam-gated.png'), fullPage: true });
});

test('SAM load failure with ?sam=wasm keeps the brush gated and explains itself', async ({ page }) => {
  await abortHub(page);
  await page.goto('/?sam=wasm');
  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);
  // ?sam=wasm bypasses the WebGPU gate, so a real load runs and must fail.
  await page.waitForFunction(() => {
    const c = (window as unknown as { __cutout?: { sam?: { status: string } } }).__cutout;
    return c?.sam?.status === 'unavailable';
  });
  await expect(page.getByTestId('tool-brush')).toBeDisabled();
  await expect(page.getByTestId('tool-restore')).toBeDisabled();
  const info = await debug(page);
  expect(info.forceSamWasm).toBeTruthy();
  expect(info.samStatus).toBe('unavailable');
  fs.writeFileSync(path.join(evidenceDir, 'sam-load-fail.json'), JSON.stringify({ info }, null, 2));
});
