import { defineConfig } from '@playwright/test';

// Playwright smoke for the console (RQ-0008). Boots the stub /admin/v1 and the built console pointed at
// it, then drives a real browser. LOCAL by default — the DoD CI job runs build + vitest; run this with
// `npm run build && npm run test:e2e` where browsers are installed (`npx playwright install chromium`).

const STUB_PORT = 7399;
const APP_PORT = 7398;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${APP_PORT}` },
  webServer: [
    {
      command: `node e2e/stub-api.mjs ${STUB_PORT}`,
      port: STUB_PORT,
      reuseExistingServer: !process.env.CI,
    },
    {
      // The console talks to the stub server-side; no real identity-service needed for the smoke.
      command: `next start -p ${APP_PORT}`,
      port: APP_PORT,
      reuseExistingServer: !process.env.CI,
      env: { ADMIN_API_URL: `http://localhost:${STUB_PORT}/admin/v1` },
    },
  ],
});
