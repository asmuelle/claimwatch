/**
 * Playwright e2e against the production build of apps/web (`just e2e`).
 * The runner expects `next build` to have happened already (the root `e2e`
 * script does it); it then serves with `next start` and kills it afterwards.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 3411; // non-default port: never collides with a running dev server

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next start --port ${PORT}`,
    cwd: './apps/web',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
