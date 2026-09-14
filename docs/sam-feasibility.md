# P1 SAM feasibility

Runtime numbers below are **browser WASM** (Playwright Chromium 153 / Linux x86_64 on this builder). WebGPU inference was **not run** — **missing proof**.

Measured at 2026-09-14T15:19:42.280Z. Raw dump: `docs/sam-feasibility.json`.

## Split path (implemented, not wired to UI)

`src/sam.ts`:

1. `loadSlimSam({ device: 'wasm', dtype: 'q8' })` → sessions `model` (vision_encoder) + `prompt_encoder_mask_decoder`
2. `encodeImage` → `SamModel.get_image_embeddings({ pixel_values })` once per image
3. `decodePrompt` → `model({ image_embeddings, image_positional_embeddings, input_points, input_labels })` then `processor.post_process_masks`

P1 UI was **not** added. Issue gate is per-stroke < 150 ms at 1000×1000 after encoder cache.

## WebGPU

`navigator.gpu` exists in this Chromium, but `requestAdapter()` returned **null**. Encoder/decoder were not executed on WebGPU.

```json
{
  "userAgent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36",
  "webgpuApi": true,
  "webgpuAdapter": null,
  "webgpuError": "requestAdapter() returned null"
}
```

## WASM runtime — Xenova/slimsam-77-uniform q8

Encoder input is always padded to **1×3×1024×1024**. Masks post-process back to the original resolution.

| Input | encode median (WASM) | decode median (WASM) | decode min–max | post_process min–max |
| --- | --- | --- | --- | --- |
| 640×480 sample | **16407 ms** | **274 ms** | 253–917 ms | 180–1477 ms |
| 1000×1000 resize | **18457 ms** | **927 ms** | 240–1027 ms | 74–8388 ms |

Load (WASM q8): **6016 ms** (weights already cached after first file fetch in that run).

n=3 timed runs after one warmup. Variance is real (GC / CPU); the 8388 ms post_process on the last 1000×1000 run is not discarded.

**Gate:** 1000×1000 per-stroke < 150 ms — **not met on WASM** (decode median 927 ms, even the fastest decode was 240 ms). Interactive smart brush needs a WebGPU (or otherwise faster) decoder measurement that this builder does not have.

## HF blob sizes (Hub API, not runtime)

`GET https://huggingface.co/api/models/<repo>?blobs=true`

### Xenova/slimsam-77-uniform

- `onnx/vision_encoder.onnx` 22.2 MB (23276014)
- `onnx/vision_encoder_fp16.onnx` 11.6 MB (12170657)
- `onnx/vision_encoder_quantized.onnx` 8.5 MB (8882165)
- `onnx/prompt_encoder_mask_decoder.onnx` 15.8 MB (16557892)
- `onnx/prompt_encoder_mask_decoder_fp16.onnx` 8.2 MB (8550118)
- `onnx/prompt_encoder_mask_decoder_quantized.onnx` 4.7 MB (4903810)

q8 pair ≈ 8.5 + 4.7 MB. fp16 pair ≈ 11.6 + 8.2 MB.

### onnx-community/sam2.1-hiera-tiny-ONNX

Encoder+data fp32 ≈ 0.3 + 127.9 MB. fp16 ≈ 0.3 + 63.9 MB. quantized ≈ 0.4 + 50.1 MB. Decoder+data fp32 ≈ 0.2 + 20 MB.

SAM2.1 **runtime was not run**. Only blob sizes.

---

## WebGPU numbers (review pass, Apple-silicon host)

The WASM numbers above leave the P1 gate open: issue #1 asks for **<150 ms per stroke at 1000x1000**,
and WASM decode is 927 ms. Measured on an Apple-silicon Mac (Chrome 140, `device: 'webgpu'`,
`dtype: 'fp16'`), same encode/decode split through `src/sam.ts`: 1 warmup then 5 timed runs per size.

| input | WASM (q8, builder) | WebGPU (fp16, Apple GPU) |
| --- | --- | --- |
| 640x480 encode | 16407 ms | **1041 ms** |
| 640x480 decode | 274 ms | **34 ms** |
| 1000x1000 encode | 18457 ms | **1053 ms** |
| 1000x1000 decode | 927 ms | **35 ms** |

**Verdict: the <150 ms per-stroke bar passes on WebGPU (35 ms at 1000x1000) and fails on WASM
(927 ms).** One-time `loadMs` = 21368 ms (~21 s download + session build, cached afterwards);
encoder is a further ~1 s per image, so the one-shot-encoder / per-stroke-decoder split is what
makes the interaction viable. `maskDims` = `[1,3,1000,1000]` confirms 3 candidate masks come back
at full input resolution, matching the multimask contract.

Raw result: `docs/sam-webgpu-bench.json`.
Reproduce: `npx vite`, open `/sam-webgpu-bench.html`, read `window.__BENCH__`.

Stated limits, so this is not read as more than it is:
- **The two columns use different quantization** (WASM q8 / WebGPU fp16). Each backend is measured
  at the dtype that backend would actually run, so the ratio is not a pure backend comparison.
  An fp32 WebGPU run was measured first and was *worse* (encode 1691 / decode 40 at 640x480),
  so fp16 is not a strawman in WebGPU's favour.
- Synthetic canvas images, not photographs: these are timing runs, not quality runs.
- Single machine, single browser build, one run per cell (median of 5). No cross-device spread.
- `warmupDecodeMs` (738 ms at 640x480) is first-call shader compilation; it is excluded from the
  median on purpose and reported so the exclusion is visible.
