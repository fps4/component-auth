import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Unit/component-test harness for the admin console (RQ-0008). jsdom + Testing Library covers the pure
// render/interaction logic and the Server Actions / API client; the Next server wiring (middleware gate,
// real render) is exercised by the Playwright smoke (e2e/), not here.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['components/**/*.test.{ts,tsx}', 'lib/**/*.test.{ts,tsx}', 'app/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      // `server-only` throws if loaded outside a React Server Component bundle; stub it so the
      // server modules (lib/api, lib/identity) can be imported and unit-tested under vitest.
      'server-only': resolve(__dirname, 'test/server-only-stub.ts'),
    },
  },
});
