import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'docs');
const sample = path.join(root, 'docs', 'demo', 'sample-input.jpg');

type Sibling = { rfilename: string; size: number };

async function hfBlobs(repo: string): Promise<Sibling[]> {
  const r = await fetch(`https://huggingface.co/api/models/${repo}?blobs=true`);
  if (!r.ok) throw new Error(`HF API ${repo} ${r.status}`);
  const j = (await r.json()) as { siblings?: { rfilename: string; size?: number }[] };
  return (j.siblings ?? [])
    .filter((s) => typeof s.size === 'number')
    .map((s) => ({ rfilename: s.rfilename, size: s.size as number }));
}

function mb(n: number) {
  return Math.round((n / 1048576) * 10) / 10;
}

test('P1 SlimSAM encoder/decoder split on browser WASM', async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);

  const [slimBlobs, sam2Blobs] = await Promise.all([
    hfBlobs('Xenova/slimsam-77-uniform'),
    hfBlobs('onnx-community/sam2.1-hiera-tiny-ONNX'),
  ]);

  page.setDefaultTimeout(15 * 60 * 1000);
  await page.goto('/sam-bench.html');
  await page.waitForFunction(() => typeof (window as unknown as { runSamBench?: unknown }).runSamBench === 'function');

  const jpegB64 = fs.readFileSync(sample).toString('base64');
  const bench = await page.evaluate(async (b64) => {
    return (window as unknown as { runSamBench: (s: string) => Promise<unknown> }).runSamBench(b64);
  }, jpegB64);

  const report = {
    measuredAt: new Date().toISOString(),
    host: 'playwright chromium (this builder)',
    note: 'All runtime numbers below are browser WASM. WebGPU inference was not run.',
    hfBlobs: {
      source: 'GET https://huggingface.co/api/models/<repo>?blobs=true',
      slimsam: slimBlobs.filter((s) => /onnx|onnx_data|json$/i.test(s.rfilename)).map((s) => ({ ...s, mb: mb(s.size) })),
      sam2_1_hiera_tiny: sam2Blobs
        .filter((s) => /onnx|onnx_data|json$/i.test(s.rfilename))
        .map((s) => ({ ...s, mb: mb(s.size) })),
    },
    bench,
  };

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'sam-feasibility.json'), JSON.stringify(report, null, 2));

  const b = bench as { ok?: boolean; error?: string; backend?: string; sessionNames?: string[] };
  expect(b.ok, b.error ?? 'bench failed').toBeTruthy();
  expect(b.backend).toBe('wasm');
  expect(b.sessionNames ?? []).toEqual(expect.arrayContaining(['model', 'prompt_encoder_mask_decoder']));
});
