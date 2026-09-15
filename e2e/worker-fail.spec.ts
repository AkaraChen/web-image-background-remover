import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { abortHub, debug, root, sample, waitCanvas } from './helpers';

const evidenceDir = path.join(root, 'e2e', 'evidence', 'r2');

test.beforeAll(() => {
  fs.mkdirSync(evidenceDir, { recursive: true });
});

test('SAM worker script 500 marks SAM unavailable and gates the brush', async ({ page }) => {
  await page.route(/sam-worker/i, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'text/plain',
      body: 'intentional sam-worker failure',
    }),
  );
  await abortHub(page);

  await page.goto('/?sam=wasm');
  await page.getByTestId('file-input').setInputFiles(sample);
  await waitCanvas(page);

  await page.waitForFunction(() => {
    const c = (window as unknown as { __cutout?: { sam?: { status: string } } }).__cutout;
    return c?.sam?.status === 'unavailable';
  });

  await expect(page.getByTestId('tool-brush')).toBeDisabled();
  await expect(page.getByTestId('tool-restore')).toBeDisabled();
  await expect(page.getByTestId('btn-undo')).toBeDisabled();
  const title = (await page.getByTestId('tool-brush').getAttribute('title')) ?? '';
  expect(title).toMatch(/SAM 未就绪，画笔不可用/);

  const info = await debug(page);
  expect(info.samStatus).toBe('unavailable');
  expect(info.strokes.length).toBe(0);
  expect(info.tool).toBe('compare');

  fs.writeFileSync(path.join(evidenceDir, 'worker-fail.json'), JSON.stringify({ title, info }, null, 2));
  await page.screenshot({ path: path.join(evidenceDir, 'worker-fail.png'), fullPage: true });
});
