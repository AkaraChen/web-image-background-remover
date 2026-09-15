// REVIEW-ONLY scaffold (never committed): same measurement shape as sam-bench.ts,
// but forces device:'webgpu' so the Apple-GPU number can be captured.
import { RawImage } from '@huggingface/transformers';
import { loadSlimSam, encodeImage, decodePrompt } from './sam';

declare global {
  interface Window { __BENCH__?: unknown }
}



const setStatus = (s: string) => {
  const el = document.getElementById('status');
  if (el) el.textContent = s;
  console.log('[sam-webgpu-bench]', s);
};

const DTYPE = 'fp16';

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function makeImage(w: number, h: number): Promise<RawImage> {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#12203a'); g.addColorStop(1, '#f2e6d8');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d63b3b';
  ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2fa14a';
  ctx.fillRect(w * 0.08, h * 0.7, w * 0.3, h * 0.2);
  const blob = await new Promise<Blob>((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  return RawImage.fromBlob(blob);
}

async function main() {
  const out: any = { device: 'webgpu', dtype: DTYPE, startedAt: new Date().toISOString(), runs: {} };
  const gpu = (navigator as any).gpu;
  out.webgpuApi = !!gpu;
  if (gpu) {
    try {
      const a = await gpu.requestAdapter();
      out.webgpuAdapter = a ? (a.info ?? { present: true }) : null;
      out.webgpuError = a ? null : 'requestAdapter() returned null';
    } catch (e) { out.webgpuError = String(e); }
  } else {
    out.webgpuError = 'navigator.gpu missing';
  }

  if (!out.webgpuApi || out.webgpuError) {
    out.verdict = 'webgpu unavailable';
    window.__BENCH__ = out; setStatus('NO WEBGPU: ' + JSON.stringify(out)); return;
  }

  setStatus('loading SlimSAM on webgpu (one-time ~20MB download)…');
  const t0 = performance.now();
  const handle = await loadSlimSam({ device: 'webgpu', dtype: DTYPE });
  out.loadMs = performance.now() - t0;

  for (const [w, h] of [[640, 480], [1000, 1000]] as Array<[number, number]>) {
    const image = await makeImage(w, h);
    setStatus(`warmup ${w}x${h}…`);
    const wenc = await encodeImage(handle, image);
    const wdec = await decodePrompt(handle, image, wenc.embeddings,
      [[[[Math.round(w / 2), Math.round(h / 2)]]]], [[[1]]]);

    const encs: number[] = [], decs: number[] = [];
    for (let i = 0; i < 5; i++) {
      setStatus(`${w}x${h} run ${i + 1}/5…`);
      const e = await encodeImage(handle, image);
      encs.push(e.encodeMs);
      const d = await decodePrompt(handle, image, e.embeddings,
        [[[[Math.round(w / 2), Math.round(h / 2)]]]], [[[1]]]);
      decs.push(d.decodeMs);
    }
    out.runs[`${w}x${h}`] = {
      encodeMs: encs, encodeMedianMs: median(encs),
      decodeMs: decs, decodeMedianMs: median(decs),
      warmupEncodeMs: wenc.encodeMs, warmupDecodeMs: wdec.decodeMs,
      iouScores: wdec.iouScores, maskDims: wdec.maskDims,
    };
  }
  out.verdict = 'measured';
  window.__BENCH__ = out;
  setStatus('DONE\n' + JSON.stringify(out, null, 2));
}

main().catch((e) => {
  window.__BENCH__ = { error: String(e?.stack ?? e), device: 'webgpu' };
  setStatus('ERROR ' + String(e));
});
