import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: /sam-feasibility\.spec\.ts|sam-brush\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  use: {
    viewport: { width: 1400, height: 900 },
    locale: 'zh-CN',
  },
  projects: [
    {
      name: 'preview',
      testIgnore: /sam-feasibility\.spec\.ts|sam-brush\.spec\.ts|dev-worker\.spec\.ts/,
      use: { baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'dev',
      testMatch: /dev-worker\.spec\.ts/,
      use: { baseURL: 'http://127.0.0.1:5176' },
    },
  ],
  webServer: [
    {
      command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5176 --strictPort',
      url: 'http://127.0.0.1:5176',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
