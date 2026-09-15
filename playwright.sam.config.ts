import { defineConfig } from '@playwright/test';

// Heavy WASM / SlimSAM runs. Kept off `npx playwright test` because
// sam-brush.spec.ts alone takes Chrome RSS to ~2.9GB (Target crashed /
// 60s mouse.move timeouts when the default suite shares the machine).
export default defineConfig({
  testDir: './e2e',
  testMatch: /sam-feasibility\.spec\.ts|sam-brush\.spec\.ts/,
  timeout: 15 * 60 * 1000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1400, height: 900 },
    locale: 'zh-CN',
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174/sam-bench.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
