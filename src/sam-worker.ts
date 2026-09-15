/// <reference lib="webworker" />
export {};
/**
 * Vite-dev worker entry. Must not statically import transformers / onnxruntime:
 * those graphs pull `/@vite/client` into the worker and delay `onmessage` until
 * the whole module graph evaluates, which is the window where Chrome module
 * workers can drop the page's first `postMessage`s.
 */
type Post = (msg: unknown, transfer?: Transferable[]) => void;
const post: Post = (msg, transfer) => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
};

post({ type: 'worker-boot', worker: 'sam', t: performance.now() });

type Runtime = typeof import('./sam-worker-runtime');
let runtime: Promise<Runtime> | null = null;
const loadRuntime = () => (runtime ??= import('./sam-worker-runtime'));

self.onmessage = (e: MessageEvent) => {
  void loadRuntime()
    .then((m) => m.handleSamMessage(e.data, post))
    .catch((err: unknown) => {
      post({ type: 'sam-error', where: 'boot', message: String((err as Error)?.message ?? err) });
    });
};
