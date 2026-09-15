/// <reference lib="webworker" />
export {};
/**
 * Zero-import probe on the same Vite `?worker_file&type=module` construction
 * path as the app workers. If this never replies, the worker script itself is
 * not evaluating; if it replies, any later silence is in the import graph.
 */
self.postMessage({ type: 'probe-alive', t: performance.now() });
self.onmessage = (e: MessageEvent) => {
  self.postMessage({ type: 'probe-pong', echo: e.data });
};
