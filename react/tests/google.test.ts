import { describe, it, expect } from 'vitest';
import {
  beginGoogleLogin,
  completeGoogleLogin,
  startGoogleLoginRedirect,
  completeGoogleLoginFromRedirect,
  GOOGLE_PKCE_STORAGE_KEY
} from '../src/google.js';
import { LoginError } from '../src/password.js';

// A fake fetch that records the request and returns a canned response.
function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: any }> = [];
  const impl = (async (url: string, init: any) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

// A minimal in-memory Storage stand-in.
function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() { return m.size; }
  } as Storage;
}

const TOKEN = { access_token: 'jwt-abc', token_type: 'Bearer', expires_in: 900, refresh_token: 'r-xyz', refresh_expires_in: 2592000, scope: 'openid email' };

describe('beginGoogleLogin (RQ-0012)', () => {
  it('builds the /oauth2/authorize URL with S256 PKCE and returns the verifier + state', async () => {
    const res = await beginGoogleLogin({
      baseUrl: 'https://auth.example.com/', clientId: 'coach-web', redirectUri: 'https://coach.test/auth/callback', scope: ['openid', 'email']
    });

    const url = new URL(res.authorizationUrl);
    expect(url.origin + url.pathname).toBe('https://auth.example.com/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('coach-web');
    expect(url.searchParams.get('redirect_uri')).toBe('https://coach.test/auth/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).not.toBe(res.codeVerifier); // challenge is the hash, not the verifier
    expect(url.searchParams.get('state')).toBe(res.state);
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(res.codeVerifier.length).toBeGreaterThan(20);
  });

  it('requires clientId and redirectUri', async () => {
    await expect(beginGoogleLogin({ baseUrl: 'x', clientId: '', redirectUri: 'y' })).rejects.toBeInstanceOf(LoginError);
    await expect(beginGoogleLogin({ baseUrl: 'x', clientId: 'c', redirectUri: '' })).rejects.toBeInstanceOf(LoginError);
  });
});

describe('completeGoogleLogin (RQ-0012)', () => {
  it('POSTs the authorization_code grant and maps the token', async () => {
    const { impl, calls } = fakeFetch(200, TOKEN);
    const token = await completeGoogleLogin({
      baseUrl: 'https://auth.example.com', clientId: 'coach-web', redirectUri: 'https://coach.test/auth/callback',
      code: 'the-code', codeVerifier: 'the-verifier', fetchImpl: impl
    });

    expect(token.accessToken).toBe('jwt-abc');
    expect(token.scope).toEqual(['openid', 'email']);
    expect(calls[0].url).toBe('https://auth.example.com/oauth2/token');
    const sent = new URLSearchParams(calls[0].init.body);
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code')).toBe('the-code');
    expect(sent.get('code_verifier')).toBe('the-verifier');
    expect(sent.get('client_id')).toBe('coach-web');
  });

  it('throws a LoginError carrying the status on a rejected exchange', async () => {
    const { impl } = fakeFetch(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
    await expect(completeGoogleLogin({
      baseUrl: 'https://auth.example.com', clientId: 'coach-web', redirectUri: 'https://coach.test/cb',
      code: 'x', codeVerifier: 'y', fetchImpl: impl
    })).rejects.toMatchObject({ name: 'LoginError', status: 400, message: 'PKCE verification failed' });
  });
});

describe('the redirect round-trip (begin → complete)', () => {
  it('stashes PKCE at begin and validates state + exchanges at complete', async () => {
    const storage = memStorage();
    let assigned = '';
    await startGoogleLoginRedirect(
      { baseUrl: 'https://auth.example.com', clientId: 'coach-web', redirectUri: 'https://coach.test/auth/callback' },
      { storage, assign: (u) => { assigned = u; } }
    );
    expect(assigned).toContain('/oauth2/authorize?');
    const stash = JSON.parse(storage.getItem(GOOGLE_PKCE_STORAGE_KEY)!);
    const state = new URL(assigned).searchParams.get('state');

    const { impl, calls } = fakeFetch(200, TOKEN);
    const token = await completeGoogleLoginFromRedirect(
      { baseUrl: 'https://auth.example.com', clientId: 'coach-web', redirectUri: 'https://coach.test/auth/callback', fetchImpl: impl },
      { url: `https://coach.test/auth/callback?code=cb-code&state=${state}`, storage }
    );

    expect(token.accessToken).toBe('jwt-abc');
    expect(new URLSearchParams(calls[0].init.body).get('code_verifier')).toBe(stash.codeVerifier);
    expect(storage.getItem(GOOGLE_PKCE_STORAGE_KEY)).toBeNull(); // stash cleared after use
  });

  it('rejects a state mismatch (CSRF guard) and issues no token', async () => {
    const storage = memStorage();
    await startGoogleLoginRedirect(
      { baseUrl: 'https://auth.example.com', clientId: 'coach-web', redirectUri: 'https://coach.test/auth/callback' },
      { storage, assign: () => {} }
    );
    const { impl, calls } = fakeFetch(200, TOKEN);
    await expect(completeGoogleLoginFromRedirect(
      { baseUrl: 'https://auth.example.com', clientId: 'coach-web', redirectUri: 'https://coach.test/auth/callback', fetchImpl: impl },
      { url: 'https://coach.test/auth/callback?code=cb-code&state=TAMPERED', storage }
    )).rejects.toBeInstanceOf(LoginError);
    expect(calls).toHaveLength(0);
  });

  it('surfaces an upstream error on the callback URL', async () => {
    const storage = memStorage();
    storage.setItem(GOOGLE_PKCE_STORAGE_KEY, JSON.stringify({ codeVerifier: 'v', state: 's' }));
    await expect(completeGoogleLoginFromRedirect(
      { baseUrl: 'https://auth.example.com', clientId: 'coach-web', redirectUri: 'https://coach.test/auth/callback' },
      { url: 'https://coach.test/auth/callback?error=access_denied&state=s', storage }
    )).rejects.toMatchObject({ name: 'LoginError' });
  });
});
