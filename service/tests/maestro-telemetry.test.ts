import { describe, it, expect } from 'vitest';
import { createRuntimeTokenProvider } from '../src/maestro/telemetry.js';

// Minimal fetch double: records calls and returns a queued token, so we can assert caching/refresh
// without any network.
function fakeFetch(tokens: Array<{ access_token: string; expires_in?: number }>, ok = true) {
  const calls: Array<{ url: string; body: string }> = [];
  let i = 0;
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    const payload = tokens[Math.min(i, tokens.length - 1)];
    i += 1;
    return {
      ok,
      status: ok ? 200 : 401,
      json: async () => payload
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('createRuntimeTokenProvider', () => {
  it('mints once and caches the token within its TTL', async () => {
    const { impl, calls } = fakeFetch([{ access_token: 't1', expires_in: 900 }]);
    let t = 0;
    const provider = createRuntimeTokenProvider({
      tokenEndpoint: 'http://127.0.0.1:7305/oauth2/token',
      clientId: 'components-ds1',
      clientSecret: 'secret',
      fetchImpl: impl,
      now: () => t
    });

    expect(await provider()).toBe('t1');
    t = 800_000; // 800s < 900s - 60s skew -> still cached
    expect(await provider()).toBe('t1');
    expect(calls).toHaveLength(1);
    // The exchange is a client_credentials POST carrying the client id.
    expect(calls[0].body).toContain('grant_type=client_credentials');
    expect(calls[0].body).toContain('client_id=components-ds1');
  });

  it('re-mints once the cached token is within the expiry skew', async () => {
    const { impl, calls } = fakeFetch([
      { access_token: 't1', expires_in: 900 },
      { access_token: 't2', expires_in: 900 }
    ]);
    let t = 0;
    const provider = createRuntimeTokenProvider({
      tokenEndpoint: 'http://127.0.0.1:7305/oauth2/token',
      clientId: 'components-ds1',
      clientSecret: 'secret',
      fetchImpl: impl,
      now: () => t
    });

    expect(await provider()).toBe('t1');
    t = 850_000; // within 60s of the 900s expiry -> refresh
    expect(await provider()).toBe('t2');
    expect(calls).toHaveLength(2);
  });

  it('throws when the mint is rejected (caller retries next tick)', async () => {
    const { impl } = fakeFetch([{ access_token: 'unused' }], false);
    const provider = createRuntimeTokenProvider({
      tokenEndpoint: 'http://127.0.0.1:7305/oauth2/token',
      clientId: 'components-ds1',
      clientSecret: 'bad',
      fetchImpl: impl
    });
    await expect(provider()).rejects.toThrow(/HTTP 401/);
  });
});
