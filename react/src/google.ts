// Google SSO (RQ-0001) for the drop-in <Login/> (RQ-0012). The redirect leg is browser-owned: begin
// the flow (build the /oauth2/authorize URL with a fresh PKCE pair) and, after Google returns to the
// consumer's callback, complete it (exchange the code for a user token). Framework-free and
// dependency-free — PKCE uses the Web Crypto API — mirroring the headless @fps4/identity-service-sdk
// contract so the two agree. Unlike the password grant, the consumer owns a callback route; this module
// gives it a one-call helper (`completeGoogleLoginFromRedirect`) so that route stays a one-liner.

import { LoginError, type UserTokenResponse } from './password.js';

/** sessionStorage keys the begin/complete pair use to carry the PKCE verifier + state across the redirect. */
export const GOOGLE_PKCE_STORAGE_KEY = 'identity-service.google.pkce';

export interface BeginGoogleLoginRequest {
  /** identity-service base URL, e.g. https://auth-dev.example.com */
  baseUrl: string;
  /** an OAuth client that allows the `authorization_code` grant and has an `audience` */
  clientId: string;
  /** where identity-service returns the browser (must be registered on the client, exact match) */
  redirectUri: string;
  /** optional OAuth scopes to request */
  scope?: string[];
  /** optional opaque state; generated if omitted */
  state?: string;
}

export interface BeginGoogleLoginResult {
  /** Navigate the browser here to start Google login (e.g. `window.location.assign(authorizationUrl)`). */
  authorizationUrl: string;
  /** PKCE verifier — persist it and pass it back to `completeGoogleLogin` (or use the *FromRedirect helper). */
  codeVerifier: string;
  /** the state echoed back on the callback — validate it to defend the redirect leg. */
  state: string;
}

export interface CompleteGoogleLoginRequest {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  /** the `code` identity-service put on the callback URL */
  code: string;
  /** the PKCE verifier from `beginGoogleLogin` */
  codeVerifier: string;
  /** override fetch (tests / SSR); defaults to global fetch */
  fetchImpl?: typeof fetch;
}

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle || typeof c.getRandomValues !== 'function') {
    throw new LoginError('Web Crypto is unavailable — Google login must run in a browser', 0);
  }
  return c;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateCodeVerifier(): string {
  const random = new Uint8Array(32);
  getCrypto().getRandomValues(random);
  return base64UrlEncode(random);
}

async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await getCrypto().subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Start a Google login: mint a PKCE pair and build the `/oauth2/authorize` URL to redirect to. The
 * caller persists `codeVerifier` + `state` (the *FromRedirect helpers do this via sessionStorage).
 */
export async function beginGoogleLogin(req: BeginGoogleLoginRequest): Promise<BeginGoogleLoginResult> {
  if (!req.clientId) throw new LoginError('clientId is required to begin Google login', 0);
  if (!req.redirectUri) throw new LoginError('redirectUri is required to begin Google login', 0);

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);
  const state = req.state ?? generateCodeVerifier();

  const query = new URLSearchParams({
    client_id: req.clientId,
    redirect_uri: req.redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state
  });
  if (req.scope?.length) query.set('scope', req.scope.join(' '));

  return {
    authorizationUrl: `${req.baseUrl.replace(/\/+$/, '')}/oauth2/authorize?${query.toString()}`,
    codeVerifier,
    state
  };
}

/** Exchange the authorization `code` (+ PKCE `codeVerifier`) for a user token (the `authorization_code` grant). */
export async function completeGoogleLogin(req: CompleteGoogleLoginRequest): Promise<UserTokenResponse> {
  const fetcher = req.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetcher) throw new LoginError('No fetch implementation available', 0);
  if (!req.code || !req.codeVerifier) throw new LoginError('code and codeVerifier are required', 0);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: req.code,
    code_verifier: req.codeVerifier,
    client_id: req.clientId,
    redirect_uri: req.redirectUri
  });

  const response = await fetcher(`${req.baseUrl.replace(/\/+$/, '')}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new LoginError(data?.error_description ?? data?.error ?? 'Login failed', response.status);
  }

  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    expiresIn: data.expires_in,
    refreshToken: data.refresh_token,
    refreshExpiresIn: data.refresh_expires_in,
    scope: typeof data.scope === 'string' && data.scope.trim() ? data.scope.trim().split(/\s+/) : []
  };
}

/**
 * Begin Google login and redirect the browser — stashing the PKCE verifier + state in sessionStorage
 * for the callback. Call from the <Login/> Google button; pair with `completeGoogleLoginFromRedirect`.
 */
export async function startGoogleLoginRedirect(
  req: BeginGoogleLoginRequest,
  deps: { storage?: Storage; assign?: (url: string) => void } = {}
): Promise<void> {
  const storage = deps.storage ?? globalThis.sessionStorage;
  const assign = deps.assign ?? ((url: string) => { globalThis.location.assign(url); });
  const { authorizationUrl, codeVerifier, state } = await beginGoogleLogin(req);
  storage?.setItem(GOOGLE_PKCE_STORAGE_KEY, JSON.stringify({ codeVerifier, state }));
  assign(authorizationUrl);
}

/**
 * Complete Google login on the consumer's callback route: read `code` + `state` from the current URL,
 * validate the state against the value stashed at begin-time, exchange the code, and clear the stash.
 * Makes the callback route a one-liner. Throws a LoginError on a state mismatch or a missing stash.
 */
export async function completeGoogleLoginFromRedirect(
  req: { baseUrl: string; clientId: string; redirectUri: string; fetchImpl?: typeof fetch },
  deps: { url?: string; storage?: Storage } = {}
): Promise<UserTokenResponse> {
  const storage = deps.storage ?? globalThis.sessionStorage;
  const href = deps.url ?? globalThis.location?.href;
  if (!href) throw new LoginError('No callback URL available', 0);

  const params = new URL(href).searchParams;
  if (params.get('error')) {
    throw new LoginError(params.get('error_description') ?? params.get('error') ?? 'Google login failed', 0);
  }
  const code = params.get('code');
  const state = params.get('state');
  if (!code) throw new LoginError('Missing authorization code on callback', 0);

  const stashed = storage?.getItem(GOOGLE_PKCE_STORAGE_KEY);
  if (!stashed) throw new LoginError('No login in progress (missing PKCE state)', 0);
  const { codeVerifier, state: expectedState } = JSON.parse(stashed) as { codeVerifier: string; state: string };
  if (!codeVerifier || state !== expectedState) {
    throw new LoginError('Login state mismatch — possible CSRF; aborting', 0);
  }
  storage?.removeItem(GOOGLE_PKCE_STORAGE_KEY);

  return completeGoogleLogin({
    baseUrl: req.baseUrl,
    clientId: req.clientId,
    redirectUri: req.redirectUri,
    code,
    codeVerifier,
    fetchImpl: req.fetchImpl
  });
}
