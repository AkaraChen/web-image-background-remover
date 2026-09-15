import { defineConfig, type Plugin } from 'vite';

/**
 * Vite's import-analysis rewrites unanalyzable `import(url)` in onnxruntime-web to
 * `import { injectQuery } from '/@vite/client'`. Workers then evaluate the HMR
 * client (WebSocket + `location.reload()`), which is how a `?worker_file`
 * module worker can sit silent: `onmessage` never sticks, no `error` event.
 * Inlining the helper keeps the dynamic import working without pulling HMR
 * into the worker. The page still loads `/@vite/client` from `index.html`.
 */
function inlineInjectQueryInNodeModules(): Plugin {
  const importRe =
    /import\s*\{\s*injectQuery as __vite__injectQuery\s*\}\s*from\s*["'][^"']*vite\/client["']\s*;?/;
  const helper = `const __vite__injectQuery = (url, queryToInject) => {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return pathname + "?" + queryToInject + (search ? "&" + search.slice(1) : "") + (hash || "");
};`;
  return {
    name: 'inline-inject-query-in-node-modules',
    transform: {
      // import-analysis is a later core plugin; hook order 'post' runs after it.
      order: 'post',
      handler(code, id) {
        const file = id.split('?')[0] ?? id;
        if (!file.includes('node_modules') || !importRe.test(code)) return null;
        return { code: code.replace(importRe, helper), map: null };
      },
    },
  };
}

export default defineConfig({
  server: { port: 5173, host: true },
  worker: { format: 'es' },
  plugins: [inlineInjectQueryInNodeModules()],
  // transformers.js ships its own onnxruntime-web build; pre-bundling breaks the wasm paths
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  build: { target: 'esnext' },
});
