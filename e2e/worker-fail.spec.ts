import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { abortHub, debug, dragFrac, roiStats, root, sample, waitCanvas } from './helpers';

const evidenceDir = path.join(root, 'e2e', 'evidence', 'r2');

test.beforeAll(() => {
  fs.mkdirSync(evidenceDir, { recursive: true });
});

test('SAM worker script 500 falls back to unavailable; geometry still paints', async ({ page }) => {
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
  await page.getByTestId('prompt-sam').click();

  await page.waitForFunction(() => {
    const t = document.querySelector('[data-testid="sam-status"]')?.textContent ?? '';
    return /不可用/.test(t) && !/加载中/.test(t);
  });

  const status = (await page.getByTestId('sam-status').textContent()) ?? '';
  expect(status).toMatch(/不可用/);
  expect(status).not.toMatch(/加载中/);

  await page.getByTestId('tool-brush').click();
  await page.getByTestId('rng-radius').fill('40');
  await dragFrac(page, 0.25, 0.5, 0.75, 0.5);
  await page.waitForTimeout(80);

  const info = await debug(page);
  expect(info.samStatus).toBe('unavailable');
  expect(info.lastStrokeSource).toBe('geometry');
  const painted = await roiStats(page, { x0: 0.35, y0: 0.45, x1: 0.65, y1: 0.55 });
  expect(painted.mean).toBeLessThan(220);
  await expect(page.getByTestId('btn-undo')).toBeEnabled();

  fs.writeFileSync(path.join(evidenceDir, 'worker-fail.json'), JSON.stringify({ status, info, painted }, null, 2));
  await page.screenshot({ path: path.join(evidenceDir, 'worker-fail.png'), fullPage: true });
});
