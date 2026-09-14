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
