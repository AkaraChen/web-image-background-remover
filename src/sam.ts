import { AutoProcessor, RawImage, SamModel, SamProcessor } from '@huggingface/transformers';
import { sampleAlong, type Pt } from './brush';

export const SLIMSAM_ID = 'Xenova/slimsam-77-uniform';
export const SAM_MAX_POINTS = 16;
export const SAM_POINT_SPACING = 8;

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

function clampPt(p: Pt, imageW: number, imageH: number): Pt {
  return {
    x: Math.max(0, Math.min(imageW - 1, p.x)),
    y: Math.max(0, Math.min(imageH - 1, p.y)),
  };
}

function outsideBox(p: Pt, minX: number, minY: number, maxX: number, maxY: number) {
  return p.x < minX || p.x > maxX || p.y < minY || p.y > maxY;
}

/**
 * Sample a stroke into SAM point prompts. Coordinates stay in original image space.
 *
 * Positives: evenly spaced along the stroke, capped at `maxPts`.
 * Negatives: image-corner reference points that lie outside the stroke bbox
 * (padded). If the stroke covers every corner, one edge midpoint farthest
 * from the bbox center is used. Users who need more control can switch to
 * geometry mode or paint a restore stroke; there is no separate "exclude"
 * tool in this pass.
 */
export function strokeToPrompts(
  points: Pt[],
  imageW: number,
  imageH: number,
  spacing = SAM_POINT_SPACING,
  maxPts = SAM_MAX_POINTS,
) {
  const sampled = sampleAlong(points, spacing);
  const stride = sampled.length <= maxPts ? 1 : Math.ceil(sampled.length / maxPts);
  const pos = sampled.filter((_, i) => i % stride === 0).slice(0, maxPts);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = Math.max(16, imageW * 0.02, imageH * 0.02);
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  const corners: Pt[] = [
    { x: 8, y: 8 },
    { x: imageW - 8, y: 8 },
    { x: imageW - 8, y: imageH - 8 },
    { x: 8, y: imageH - 8 },
  ].map((p) => clampPt(p, imageW, imageH));

  let neg = corners.filter((p) => outsideBox(p, minX, minY, maxX, maxY)).slice(0, 3);
  if (neg.length === 0) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const edges: Pt[] = [
      { x: imageW / 2, y: 8 },
      { x: imageW / 2, y: imageH - 8 },
      { x: 8, y: imageH / 2 },
      { x: imageW - 8, y: imageH / 2 },
    ].map((p) => clampPt(p, imageW, imageH));
    edges.sort((a, b) => Math.hypot(b.x - cx, b.y - cy) - Math.hypot(a.x - cx, a.y - cy));
    const pick = edges.find((p) => outsideBox(p, minX, minY, maxX, maxY)) ?? edges[0];
    if (pick) neg = [pick];
  }

  const input_points = [[[...pos.map((p) => [p.x, p.y]), ...neg.map((p) => [p.x, p.y])]]];
  const input_labels = [[[...pos.map(() => 1), ...neg.map(() => 0)]]];
  return { input_points, input_labels, nPositive: pos.length, nNegative: neg.length, negatives: neg, positives: pos };
}

export function pickBestMask(
  maskTensor: { dims: number[]; data: ArrayLike<number> },
  iouScores: number[],
): { mask: Uint8ClampedArray; width: number; height: number; index: number; iou: number } {
  let index = 0;
  for (let i = 1; i < iouScores.length; i++) {
    if (iouScores[i] > iouScores[index]) index = i;
  }
  const dims = maskTensor.dims;
  const width = dims[dims.length - 1] ?? 0;
  const height = dims[dims.length - 2] ?? 0;
  const plane = width * height;
  const data = maskTensor.data;
  const offset = index * plane;
  const mask = new Uint8ClampedArray(plane);
  for (let i = 0; i < plane; i++) {
    const v = Number(data[offset + i] ?? 0);
    mask[i] = v > 1 ? v : v * 255;
  }
  return { mask, width, height, index, iou: iouScores[index] ?? 0 };
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
  const iouScores = Array.from(iou.data as ArrayLike<number>);
  const maskTensor = masks[0] as { dims: number[]; data: ArrayLike<number> };
  const best = pickBestMask(maskTensor, iouScores);
  return {
    decodeMs,
    postMs: performance.now() - t1,
    predMasksDims: Array.from(outputs.pred_masks.dims as number[]),
    iouScores,
    maskDims: Array.from((masks[0]?.dims ?? []) as number[]),
    bestIndex: best.index,
    bestIou: best.iou,
    mask: best.mask,
    maskWidth: best.width,
    maskHeight: best.height,
  };
}
