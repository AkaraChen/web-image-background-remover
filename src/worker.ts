/// <reference lib="webworker" />
export {};
/**
 * Vite-dev worker entry. Must not statically import transformers / onnxruntime.
 * See sam-worker.ts for the race this avoids.
 */
type Post = (msg: unknown, transfer?: Transferable[]) => void;
const post: Post = (msg, transfer) => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
};

post({ type: 'worker-boot', worker: 'rmbg', t: performance.now() });

type Runtime = typeof import('./worker-runtime');
let runtime: Promise<Runtime> | null = null;
const loadRuntime = () => (runtime ??= import('./worker-runtime'));

self.onmessage = (e: MessageEvent) => {
  void loadRuntime()
    .then((m) => m.handleRmbgMessage(e.data, post))
    .catch((err: unknown) => {
      post({ type: 'error', where: 'boot', message: String((err as Error)?.message ?? err) });
    });
};
