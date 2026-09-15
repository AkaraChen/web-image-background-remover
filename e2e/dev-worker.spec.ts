import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers';

const evidenceDir = path.join(root, 'e2e', 'evidence', 'r1');

async function installWorkerSpy(page: Page) {
  await page.addInitScript(() => {
    const log = [];
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url, opts) {
        super(url, opts);
        const rec = { url: String(url), type: (opts && opts.type) || '', post: [], msg: [], err: [] };
        log.push(rec);
        const origPost = this.postMessage.bind(this);
        this.postMessage = (data, ...rest) => {
          rec.post.push({ type: data && data.type });
          return origPost(data, ...rest);
        };
        this.addEventListener('message', (e) => rec.msg.push({ type: e.data && e.data.type }));
        this.addEventListener('error', (e) => rec.err.push({ msg: e.message }));
      }
    };
    window.__workerLog = log;
  });
}

test.beforeAll(() => {
  fs.mkdirSync(evidenceDir, { recursive: true });
});

test('npx vite: module workers reply (boot + zero-import probe)', async ({ page }) => {
  await installWorkerSpy(page);
  await page.goto('/');

  await page.waitForFunction(() => {
    const w = window;
    const c = w.__cutout;
    if (!c || !c.rmbgBooted || !c.sam || !c.sam.booted) return false;
    if (!c.probeAlive || c.probeAlive.type !== 'probe-alive') return false;
    const log = w.__workerLog || [];
    const appWorkers = log.filter((r) => /sam-worker|\/worker\.ts|probe-worker/.test(r.url));
    return appWorkers.length >= 3 && appWorkers.every((r) => r.msg.length > 0);
  });

  const dump = await page.evaluate(() => {
    const w = window;
    const log = w.__workerLog || [];
    return {
      rmbgBooted: w.__cutout && w.__cutout.rmbgBooted,
      rmbgBootAt: w.__cutout && w.__cutout.rmbgBootAt,
      probeAlive: w.__cutout && w.__cutout.probeAlive,
      samBooted: w.__cutout && w.__cutout.sam && w.__cutout.sam.booted,
      samBootAt: w.__cutout && w.__cutout.sam && w.__cutout.sam.bootAt,
      samStatus: w.__cutout && w.__cutout.sam && w.__cutout.sam.status,
      samDevice: w.__cutout && w.__cutout.sam && w.__cutout.sam.device,
      workers: log.map((r) => ({
        url: r.url,
        type: r.type,
        postN: r.post.length,
        msgN: r.msg.length,
        errN: r.err.length,
        msgTypes: r.msg.map((m) => m.type),
      })),
    };
  });

  fs.writeFileSync(path.join(evidenceDir, 'dev-worker.json'), JSON.stringify(dump, null, 2));

  expect(dump.probeAlive, 'zero-import probe on Vite ?worker_file must reply').toMatchObject({ type: 'probe-alive' });
  expect(dump.rmbgBooted, 'RMBG worker-boot missing — worker did not evaluate').toBe(true);
  expect(dump.samBooted, 'SAM worker-boot missing — worker did not evaluate').toBe(true);

  const rmbg = dump.workers.find((w) => /\/worker\.ts/.test(w.url) && !/sam-worker|probe-worker/.test(w.url));
  const sam = dump.workers.find((w) => /sam-worker/.test(w.url));
  const probe = dump.workers.find((w) => /probe-worker/.test(w.url));
  expect(rmbg?.msgTypes, JSON.stringify(rmbg)).toContain('worker-boot');
  expect(sam?.msgTypes, JSON.stringify(sam)).toContain('worker-boot');
  expect(probe?.msgTypes, JSON.stringify(probe)).toContain('probe-alive');
  expect(rmbg?.errN ?? 1).toBe(0);
  expect(sam?.errN ?? 1).toBe(0);
});
