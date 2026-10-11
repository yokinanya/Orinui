import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5173', channel: 'chrome' },
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 5173 --outDir .output/chrome-mv3',
    url: 'http://127.0.0.1:5173/newtab.html',
    reuseExistingServer: !process.env.CI,
  },
});
