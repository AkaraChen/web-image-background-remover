export type DeviceKind = 'webgpu' | 'wasm';

export interface ModelSpec {
  /** Hugging Face repo id — passed straight to transformers.js */
  id: string;
  label: string;
  /** one-line description shown in the UI */
  note: string;
  kind: 'general' | 'portrait' | 'heavy';
  /** repo licence, shown verbatim so nobody is surprised later */
  license: string;
  /** on-disk size of the recommended dtype, in MB (measured from the HF API) */
  sizeMB: number;
  /** recommended dtype per backend */
  dtype: Record<DeviceKind, Dtype>;
  /** some exports want the raw logits instead of the pre-sigmoided map */
  defaultInvert?: boolean;
}

export type Dtype = 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'q4f16' | 'bnb4';

export const MODELS: ModelSpec[] = [
  {
    id: 'kittypdf/RMBG-1.4-transformersjs',
    label: 'RMBG-1.4',
    note: '默认。通用题材最稳，本机 WebGPU 实测 0.6s。官方 briaai 那份在 transformers.js v4 里跑不了，这是社区修过 config 的分支。非商用授权。',
    kind: 'general',
    license: 'bria-rmbg-1.4（非商用）',
    sizeMB: 84,
    dtype: { webgpu: 'fp16', wasm: 'q8' },
  },
  {
    id: 'onnx-community/ISNet-ONNX',
    label: 'ISNet',
    note: '就是 @imgly/background-removal 那个家族，发丝边缘比 RMBG 更细一点。AGPL-3.0。',
    kind: 'general',
    license: 'AGPL-3.0',
    sizeMB: 84,
    dtype: { webgpu: 'fp16', wasm: 'q8' },
  },
  {
    id: 'Xenova/modnet',
    label: 'MODNet',
    note: '只有 12MB，秒开。但只认人像，别的题材会糊掉。',
    kind: 'portrait',
    license: 'Apache-2.0',
    sizeMB: 12,
    dtype: { webgpu: 'fp16', wasm: 'q8' },
  },
  {
    id: 'jiabins0303/birefnet-lite-1024-webgpu',
    label: 'BiRefNet-lite 1024',
    note: '2025 的 SOTA 轻量版，细节最好，但要 5s 左右。只有 fp16 导出，所以基本只能走 WebGPU。',
    kind: 'heavy',
    license: 'MIT',
    sizeMB: 109,
    dtype: { webgpu: 'fp16', wasm: 'fp16' },
  },
];

export function modelById(id: string): ModelSpec {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export const DTYPES: Dtype[] = ['fp32', 'fp16', 'q8', 'int8', 'uint8', 'q4', 'q4f16', 'bnb4'];
