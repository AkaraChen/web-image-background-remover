# 抠图台 · web-image-background-remover

浏览器本地去背景：图片不离开机器，模型跑在 WebGPU（不可用时回落 WASM/CPU）。

## 跑起来

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 静态产物在 dist/
```

## 它是怎么工作的

**没有 WebGL shader，也没有自己写模型。** 整条链路是
`@huggingface/transformers` (transformers.js v4) → `onnxruntime-web` → WebGPU EP。

1. `pipeline('background-removal', <repo>)` 从 Hugging Face Hub 拉 ONNX 权重
   （浏览器 Cache Storage 会缓存，第二次是秒开）。
2. 模型在 **Web Worker** 里跑，主线程只负责合成，所以调滑块不会卡。
3. `BackgroundRemovalPipeline` 返回的是把遮罩写进 alpha 通道的 RGBA 图
   （见 `utils/image.js` 的 `putAlpha`），我们只把 alpha 抽出来传回主线程。
4. 合成（阈值 / 羽化 / 背景色 / 透明）全在主线程用 `ImageData` 做，
   改背景色不会重跑网络。

## 模型

四条都是**在本机实跑通**的（Apple M 系 / Chrome 140 / WebGPU，输入 640×480）：

| 模型 | 精度 | 体积 | 推理 | 说明 |
| --- | --- | --- | --- | --- |
| `kittypdf/RMBG-1.4-transformersjs` | fp16 | 84 MB | **0.6 s** | 默认。通用题材最稳 |
| `onnx-community/ISNet-ONNX` | fp16 | 84 MB | 0.65 s | @imgly/background-removal 那个家族 |
| `Xenova/modnet` | fp16 | 12 MB | 1.7 s | 人像专用，别的题材会糊 |
| `jiabins0303/birefnet-lite-1024-webgpu` | fp16 | 109 MB | 5.3 s | 细节最好，代价是慢 |

体积来自 HF API 的 `siblings[].size`，推理时间是 `performance.now()` 量的，都不是估的。

**被筛掉的（都实测过，别再踩一遍）**：

| 模型 | 结果 |
| --- | --- |
| `briaai/RMBG-1.4` | `Unsupported model type "SegformerForSemanticSegmentation"` —— config 里 `model_type` 写的不是合法值，v4 的 registry 解不了 |
| `onnx-community/BiRefNet_lite-ONNX` / `BiRefNet-ONNX` | Swin 架构撞 WebGPU `maxStorageBuffersPerShaderStage`（11 > 10）；退到 WASM 又 `std::bad_alloc`（213 MB fp32 撑爆 WASM 堆） |
| `kittypdf/...` 用 **q8** | 能跑但慢到 9.7 s —— 量化权重在 GPU 上要逐算子反量化，不如直接 fp16 |
| `onnx-community/MVANet-ONNX` | 最小的导出也有 81 MB，且同为 Swin 系，未测 |

## 踩到的坑（都写在代码注释里了）

- **`briaai/RMBG-1.4` 在 transformers.js v4 里跑不了。** 它的 `config.json` 里
  `model_type` 写的是 `SegformerForSemanticSegmentation`（不是合法的 model_type），
  `architectures` 是 `['BriaRMBG']`。registry 里没有这个键 → `Unsupported model type`。
  要质量请用 BiRefNet-lite / ISNet。
- **BiRefNet 原版撞 WebGPU 的 `maxStorageBuffersPerShaderStage`**（11 > 10）。
  `infer()` 捕到这类错误会自动切后端到 WASM 重跑并在输出区写明原因 ——
  顺便也说明为什么表里用的是 `jiabins0303/birefnet-lite-1024-webgpu`（有人重新导出过，能塞进去）。
- **部分 fp16 导出会退化成全 0 / 全 255 的遮罩。** 检测前景占比，落在
  (0.2%, 99.8%) 之外且当前是 `auto` 精度时就回退 fp32 重跑一次。
- `[hidden]` 必须显式 `display: none !important`，否则 CSS 里的 `display: flex`
  会盖掉它 —— 活动指示器会永远挂在画布上。
- 对比滑块要**同时裁掉原图**。只裁画布的话，画布的透明区会透出下面的原图，
  抠图结果看起来"什么都没发生"。
- ORT 一个 100MB 的下载会发几千次 progress 回调，逐次写 DOM 会卡主线程 →
  `paintProgress()` 把它们合并到约 20fps。

## 目录

```
index.html      页面骨架
src/models.ts   模型注册表（体积 / 授权 / 各后端推荐精度）
src/worker.ts   推理 worker：拉权重、跑 pipeline、抽出 alpha
src/main.ts     UI、设备与精度探测、自动回退、合成、对比滑块
src/style.css   自适应深浅色的样式
docs/demo/      实测样张（sample-input.jpg → cutout-rmbg14-fp16-webgpu.jpg）
```

## 授权提醒

模型权重各自的授权是分开的：ISNet 是 **AGPL-3.0**，BiRefNet 是 MIT，
MODNet 是 Apache-2.0。商用前先看你自己选的那个。
