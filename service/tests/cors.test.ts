import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import cors from 'cors';
import type { Server } from 'http';
import { buildCorsOptions, corsErrorHandler } from '../src/utils/cors.js';

// Regression: a disallowed Origin used to hit cors's `callback(new Error())` and surface as Express's
// default 500 HTML. It must instead be a clean 403 JSON, while allowed / origin-less requests pass.

function makeApp() {
  const app = express();
  app.use(express.json());
  // Non-empty allow-list so the "no allow-list → permissive" escape hatch does not apply.
  app.use(cors(buildCorsOptions({ allowedOrigins: new Set(['https://ok.example']), isProd: true, methods: ['GET', 'POST'] })));
  app.post('/oauth2/token', (_req, res) => { res.json({ ok: true }); });
  app.use(corsErrorHandler);
  return app;
}

describe('CORS origin handling', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = makeApp().listen(0, () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        base = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const post = (headers: Record<string, string> = {}) =>
    fetch(`${base}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });

  it('returns a clean 403 JSON for a disallowed Origin (not a 500)', async () => {
    const res = await post({ Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toMatchObject({ error: 'origin_not_allowed' });
  });

  it('allows a request with no Origin (non-browser caller)', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('allows an allow-listed Origin', async () => {
    const res = await post({ Origin: 'https://ok.example' });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://ok.example');
  });
});
