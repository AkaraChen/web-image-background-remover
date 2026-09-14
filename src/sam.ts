import { AutoProcessor, RawImage, SamModel, SamProcessor } from '@huggingface/transformers';
import { sampleAlong, type Pt } from './brush';

export const SLIMSAM_ID = 'Xenova/slimsam-77-uniform';

export type SamDevice = 'wasm' | 'webgpu';

export type SamHandle = {
  model: SamModel;
  processor: SamProcessor;
  sessionNames: string[];
};

export async function loadSlimSam(opts: {
  device: SamDevice;
  dtype: string;
  progress_callback?: (p: unknown) => void;
}): Promise<SamHandle> {
  const model = (await SamModel.from_pretrained(SLIMSAM_ID, {
    device: opts.device,
    dtype: opts.dtype as never,
    progress_callback: opts.progress_callback as never,
  })) as SamModel;
  const processor = (await AutoProcessor.from_pretrained(SLIMSAM_ID)) as SamProcessor;
  const sessions = (model as unknown as { sessions?: Record<string, unknown> }).sessions ?? {};
  return { model, processor, sessionNames: Object.keys(sessions) };
}

export async function encodeImage(handle: SamHandle, image: RawImage) {
  const processed = await handle.processor(image);
  const t0 = performance.now();
  const embeddings = await handle.model.get_image_embeddings({ pixel_values: processed.pixel_values });
  return {
    embeddings,
    processed,
    encodeMs: performance.now() - t0,
    pixelValuesDims: Array.from(processed.pixel_values.dims as number[]),
    imageEmbeddingsDims: Array.from(embeddings.image_embeddings.dims as number[]),
  };
}

/** Sample a stroke into SAM point prompts. Coordinates stay in original image space. */
export function strokeToPrompts(points: Pt[], imageW: number, imageH: number, spacing = 8, maxPts = 16) {
  const sampled = sampleAlong(points, spacing);
  const stride = sampled.length <= maxPts ? 1 : Math.ceil(sampled.length / maxPts);
  const pos = sampled.filter((_, i) => i % stride === 0).slice(0, maxPts);
  const neg: Pt[] = [
    { x: 8, y: 8 },
    { x: imageW - 8, y: 8 },
    { x: 8, y: imageH - 8 },
  ];
  const input_points = [[[...pos.map((p) => [p.x, p.y]), ...neg.map((p) => [p.x, p.y])]]];
  const input_labels = [[[...pos.map(() => 1), ...neg.map(() => 0)]]];
  return { input_points, input_labels, nPositive: pos.length, nNegative: neg.length };
}

export async function decodePrompt(
  handle: SamHandle,
  image: RawImage,
  embeddings: { image_embeddings: unknown; image_positional_embeddings: unknown },
  input_points: number[][][][],
  input_labels: number[][][],
) {
  const processed = await handle.processor(image, { input_points, input_labels });
  const t0 = performance.now();
  const outputs = await handle.model({
    image_embeddings: embeddings.image_embeddings,
    image_positional_embeddings: embeddings.image_positional_embeddings,
    input_points: processed.input_points,
    input_labels: processed.input_labels,
  });
  const decodeMs = performance.now() - t0;
  const t1 = performance.now();
  const masks = await handle.processor.post_process_masks(
    outputs.pred_masks,
    processed.original_sizes,
    processed.reshaped_input_sizes,
  );
  const iou = outputs.iou_scores;
  return {
    decodeMs,
    postMs: performance.now() - t1,
    predMasksDims: Array.from(outputs.pred_masks.dims as number[]),
    iouScores: Array.from(iou.data as ArrayLike<number>),
    maskDims: Array.from((masks[0]?.dims ?? []) as number[]),
  };
}
