import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /sam-feasibility\.spec\.ts/,
  timeout: 15 * 60 * 1000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 800, height: 600 },
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174/sam-bench.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
