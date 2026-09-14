import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, host: true },
  worker: { format: 'es' },
  // transformers.js ships its own onnxruntime-web build; pre-bundling breaks the wasm paths
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  build: { target: 'esnext' },
});
