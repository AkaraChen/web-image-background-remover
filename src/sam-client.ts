import type { SamDevice } from './sam';

export type SamUiStatus = 'unloaded' | 'loading' | 'encoding' | 'ready' | 'unavailable';

export type SamEncoded = {
  id: number;
  width: number;
  height: number;
  encodeMs: number;
};

export type SamDecoded = {
  id: number;
  width: number;
  height: number;
  mask: Uint8ClampedArray;
  iouScores: number[];
  bestIndex: number;
  bestIou: number;
  decodeMs: number;
  postMs: number;
};

type Pending<T> = { resolve: (v: T) => void; reject: (e: Error) => void };

export class SamClient {
  readonly worker = new Worker(new URL('./sam-worker.ts', import.meta.url), { type: 'module' });
  status: SamUiStatus = 'unloaded';
  reason = '';
  device: SamDevice | null = null;
  dtype: string | null = null;
  sessionNames: string[] = [];
  encodeCount = 0;
  decodeCount = 0;
  lastEncodeMs: number | null = null;
  lastDecodeMs: number | null = null;
  encodedSize: { width: number; height: number } | null = null;
  /** True after the worker evaluated far enough to post `worker-boot`. */
  booted = false;
  bootAt: number | null = null;

  private encodeSeq = 0;
  private decodeSeq = 0;
  private pendingLoad: Pending<void> | null = null;
  private pendingEncode = new Map<number, Pending<SamEncoded>>();
  private pendingDecode = new Map<number, Pending<SamDecoded>>();
  private onChange: () => void;
  private dead = false;

  constructor(onChange: () => void) {
    this.onChange = onChange;
    this.worker.onmessage = (e: MessageEvent<Record<string, unknown>>) => this.onMessage(e.data);
    this.worker.onerror = (e) => {
      const detail = [e.message, e.filename].filter(Boolean).join(' ').trim();
      this.failAll(new Error(detail || 'SAM worker failed to load'));
    };
    this.worker.onmessageerror = () => {
      this.failAll(new Error('SAM worker message deserialize failed'));
    };
  }

  private failAll(err: Error) {
    this.dead = true;
    this.status = 'unavailable';
    this.reason = err.message;
    this.pendingLoad?.reject(err);
    this.pendingLoad = null;
    for (const [, p] of this.pendingEncode) p.reject(err);
    this.pendingEncode.clear();
    for (const [, p] of this.pendingDecode) p.reject(err);
    this.pendingDecode.clear();
    this.onChange();
  }

  private failPending(err: Error, where?: string, id?: number) {
    if ((where === 'load' || where === 'boot') && this.pendingLoad) {
      this.pendingLoad.reject(err);
      this.pendingLoad = null;
    }
    if (where === 'encode' && id != null) {
      this.pendingEncode.get(id)?.reject(err);
      this.pendingEncode.delete(id);
    }
    if (where === 'decode' && id != null) {
      this.pendingDecode.get(id)?.reject(err);
      this.pendingDecode.delete(id);
    }
  }

  private onMessage(msg: Record<string, unknown>) {
    switch (msg.type) {
      case 'worker-boot':
        this.booted = true;
        this.bootAt = typeof msg.t === 'number' ? msg.t : performance.now();
        this.onChange();
        break;
      case 'sam-progress': {
        const file = String(msg.file ?? '');
        const status = String(msg.status ?? '');
        if (file) this.reason = `${status} ${file}`.trim();
        this.onChange();
        break;
      }
      case 'sam-ready':
        this.status = 'loading';
        this.reason = '';
        this.device = msg.device as SamDevice;
        this.dtype = String(msg.dtype ?? '');
        this.sessionNames = (msg.sessionNames as string[]) ?? [];
        this.pendingLoad?.resolve();
        this.pendingLoad = null;
        this.onChange();
        break;
      case 'sam-encoded': {
        const id = msg.id as number;
        this.encodeCount += 1;
        this.lastEncodeMs = msg.encodeMs as number;
        this.encodedSize = { width: msg.width as number, height: msg.height as number };
        this.status = 'ready';
        this.reason = '';
        this.pendingEncode.get(id)?.resolve({
          id,
          width: msg.width as number,
          height: msg.height as number,
          encodeMs: msg.encodeMs as number,
        });
        this.pendingEncode.delete(id);
        this.onChange();
        break;
      }
      case 'sam-decoded': {
        const id = msg.id as number;
        this.decodeCount += 1;
        this.lastDecodeMs = msg.decodeMs as number;
        const mask = msg.mask as Uint8ClampedArray;
        this.pendingDecode.get(id)?.resolve({
          id,
          width: msg.width as number,
          height: msg.height as number,
          mask,
          iouScores: (msg.iouScores as number[]) ?? [],
          bestIndex: msg.bestIndex as number,
          bestIou: msg.bestIou as number,
          decodeMs: msg.decodeMs as number,
          postMs: msg.postMs as number,
        });
        this.pendingDecode.delete(id);
        this.onChange();
        break;
      }
      case 'sam-error': {
        const err = new Error(String(msg.message ?? 'SAM error'));
        const where = String(msg.where ?? '');
        const id = msg.id as number | undefined;
        if (where === 'boot') {
          this.failAll(err);
          break;
        }
        if (where === 'load' || where === 'encode') {
          this.status = 'unavailable';
          this.reason = err.message;
        }
        this.failPending(err, where, id);
        this.onChange();
        break;
      }
      case 'sam-disposed':
        this.status = 'unloaded';
        this.reason = '';
        this.encodedSize = null;
        this.onChange();
        break;
    }
  }

  private rejectIfDead(): Error | null {
    if (!this.dead) return null;
    this.status = 'unavailable';
    this.reason ||= 'SAM worker failed to load';
    this.onChange();
    return new Error(this.reason);
  }

  load(device: SamDevice, dtype: string): Promise<void> {
    const dead = this.rejectIfDead();
    if (dead) return Promise.reject(dead);
    this.status = 'loading';
    this.reason = '正在载入 SlimSAM…';
    this.onChange();
    return new Promise<void>((resolve, reject) => {
      this.pendingLoad = { resolve, reject };
      this.worker.postMessage({ type: 'load', device, dtype });
    });
  }

  encode(blob: Blob): Promise<SamEncoded> {
    const dead = this.rejectIfDead();
    if (dead) return Promise.reject(dead);
    const id = ++this.encodeSeq;
    this.status = 'encoding';
    this.reason = '正在编码图像…';
    this.onChange();
    return new Promise<SamEncoded>((resolve, reject) => {
      this.pendingEncode.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'encode', id, blob });
    });
  }

  decode(input_points: number[][][][], input_labels: number[][][]): Promise<SamDecoded> {
    const dead = this.rejectIfDead();
    if (dead) return Promise.reject(dead);
    const id = ++this.decodeSeq;
    return new Promise<SamDecoded>((resolve, reject) => {
      this.pendingDecode.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'decode', id, input_points, input_labels });
    });
  }

  dispose() {
    this.worker.postMessage({ type: 'dispose' });
  }
}
