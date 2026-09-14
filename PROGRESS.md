# PROGRESS

## SETUP-01 · npm install

- 完成层级：依赖安装成功
- 证据：`npm install` 退出码 0，added 65 packages in 16s
- 阻塞项：无

## P0-01 · 几何笔刷引擎（stroke 列表，不存 mask 快照）

- 完成层级：代码落地，尚未经 Playwright 真画
- 证据：`src/brush.ts` — `StrokeStack` 只存 stroke；`BrushEngine.mask()` 每次从 stroke 重栅格化成一通道 0–255；软边径向渐变 + 抬笔后 `blur(1.25px)` 羽化
- 阻塞项：接入 UI / render / PNG 导出见 P0-02；浏览器实测见后续 e2e
