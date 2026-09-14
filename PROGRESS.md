# PROGRESS

## SETUP-01 · npm install

- 完成层级：依赖安装成功
- 证据：`npm install` 退出码 0，added 65 packages in 16s
- 阻塞项：无

## P0-01 · 几何笔刷引擎（stroke 列表，不存 mask 快照）

- 完成层级：代码落地，尚未经 Playwright 真画
- 证据：`src/brush.ts` — `StrokeStack` 只存 stroke；`BrushEngine.mask()` 每次从 stroke 重栅格化成一通道 0–255；软边径向渐变 + 抬笔后 `blur(1.25px)` 羽化
- 阻塞项：接入 UI / render / PNG 导出见 P0-02；浏览器实测见后续 e2e

## P0-02 · 接入画布、合成与 PNG 导出

- 完成层级：代码落地；拖入原图后立刻可画（`alpha` 先取原图通道，`infer` 失败不挡笔刷）；下载 PNG 走 `canvas-result.toBlob`（含笔刷）；撤销/重做按钮与 ⌘Z
- 证据：`src/main.ts` `dst.a *= 1 - brushMask[i]/255`；`acceptFile` 里 `btnDownload.disabled = false` 且 `void infer(file)`；`index.html` 笔刷面板
- 阻塞项：尚未 Playwright 真跑；下载「遮罩」仍是自动抠图 alpha，不含笔刷（cutout PNG 才含）

## P0-03 · 类型检查与生产构建

- 完成层级：`npx tsc --noEmit` 退出码 0；`npx vite build` 退出码 0（约 5.45s）
- 证据：`brushMask` 标注为 `Uint8ClampedArray<ArrayBufferLike>`，对齐 `getImageData().data`；vite 产物 `dist/assets/index-BlnH671P.js`
- 阻塞项：无（e2e 另计）

## P0-04 · Playwright 真跑画笔 / 撤销重做 / PNG 导出

- 完成层级：Chromium 实测通过（1 passed, 3.6s）。Hub 请求被 abort，覆盖「模型失败笔刷仍可用」。
- 证据：`e2e/evidence/results.json` — 画前 transparent=0；画后 40102 像素 alpha<250、minAlpha=3；撤销回到 0；重做 40102；导出 PNG 640×480、852345 bytes、transparent=40102。截图 `01-loaded.png` `02-brushed.png` `03-undone.png` `04-redone.png` `export.png`
- 阻塞项：未测键盘 ⌘Z / 滚轮改半径 / 空格平移（测的是按钮撤销重做与鼠标描边）。未在有 WebGPU 的机器上测。

## P1-01 · SAM encoder/decoder 拆分路径 + WASM 实测

- 完成层级：路径落地（`src/sam.ts`），浏览器 WASM 跑通 SlimSAM q8；**未做 P1 UI**；WebGPU 推理 **missing proof**
- 证据：Playwright `e2e/sam-feasibility.spec.ts` 1 passed / 4.1m。sessions `model` + `prompt_encoder_mask_decoder`。WASM 中位：640×480 encode 16407 ms / decode 274 ms；1000×1000 encode 18457 ms / decode 927 ms。`requestAdapter()` 为 null。Hub 体积见 `docs/sam-feasibility.md`。1000×1000 每笔 &lt;150 ms **WASM 未达标**
- 阻塞项：无 WebGPU adapter，不能给 WebGPU 数字。SAM2.1 只量了 blob 体积，没跑推理。P2 未做。

## P2-01 · 擦除 / 恢复顺序合成

- 完成层级：编译通过 / 构建通过 / 无头浏览器行为验证通过
- 证据：`src/brush.ts` — `Stroke.kind: 'erase' | 'restore'`；`BrushEngine.apply(base)` 从 base alpha 按 stroke 列表 replay（`a *= 1-m` / `a += (1-a)*m`）。Playwright `e2e/p2.spec.ts`：擦除 band 255→7、随后恢复中心 5.5→220 且 band 仍为 7；反过来先恢复再擦除，中心 255→5.5。`e2e/evidence/p2/results.json` + `01-erased.png` `02-restored-on-erase.png` `03-erase-on-restore.png`
- 阻塞项：无

## P2-02 · 下载遮罩含笔刷结果

- 完成层级：无头浏览器行为验证通过
- 证据：同一用例里导出 mask PNG，band 灰度 7.06、center 220.45，与画布 alpha 一致（`e2e/evidence/p2/effective-mask.png`）
- 阻塞项：无

## KEYS-01 · 界面已承诺的键位

- 完成层级：无头浏览器行为验证通过
- 证据：键位本来就在 `src/main.ts`；本轮补了 Playwright。`][` 24→28→26；⌘Z / ⇧⌘Z 撤销重做；⌘滚轮 zoom 1→1.08；空格拖动 view (80, 70)。`e2e/evidence/p2/keys.json`
- 阻塞项：无

## P1-02 · SAM 进 Worker + 智能笔刷 UI

- 完成层级：编译通过 / 构建通过 / 无头浏览器行为验证通过（WASM 管线正确性）。WebGPU 交互速度 **missing proof**
- 证据：复用 `src/sam.ts`（`loadSlimSam` / `encodeImage` / `decodePrompt` / `strokeToPrompts`）。`src/sam-worker.ts` 主线程不跑 encoder/decoder。负点 = 笔画 bbox 外的图像角点，见 `docs/sam-feasibility.md`。默认取 `iou_scores` 最高的 1/3 候选。无 WebGPU 不加载 SAM，几何继续画：`e2e/evidence/p2/sam-fallback.json`。`?sam=wasm` 且 Hub abort：`Failed to fetch` 回落几何，`e2e/evidence/p2/sam-load-fail.json`。
- WASM 管线（`/?sam=wasm`）：encodeCount 图变 1→再画仍为 1→换图 2；decode 每笔 +1；第一笔 IoU 0.960 decode 264 ms，ROI mean 115→25。`e2e/evidence/sam/results.json` `01-first-stroke.png` `02-second-stroke.png`
- 阻塞项：本 builder `requestAdapter()` 为 null，不能测 WebGPU 每笔 &lt;150 ms，也没有把 WASM 264 ms 写成过闸。未做三选一 UI。
