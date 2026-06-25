// Client-side identity-service edge for the admin console (RQ-0007, ADR-0010).
//
// The console authenticates an OPERATOR with the OAuth `password` grant against
// identity-service's own local IdP (a dedicated console client). The operator's user
// identity token carries a `roles` claim (RQ-0005); the management plane accepts it as
// an operator principal when one of those roles is configured (ADR-0010), so every
// console action is attributed to the human, not a shared machine client.
//
// The console is SERVER-RENDERED: lib/api.ts runs on the Next server and forwards the
// operator's token to /admin/v1 (lib/identity.ts). So the access token is mirrored into
// a server-readable cookie; the refresh token + expiries live in localStorage (client
// only). middleware.ts gates navigation on the cookie; /login does silent refresh.
//
// Ported from maestro-web's lib/auth (ADR-0019) — the proven fleet pattern.

// `||` (not `??`): treat an empty env value — common in Docker/compose build args —
// as unset, so the default applies rather than an empty base URL / client id.
export const IDENTITY_SERVICE_BASE =
  process.env.NEXT_PUBLIC_IDENTITY_SERVICE_BASE || 'http://localhost:7305';

export const IDENTITY_SERVICE_CLIENT_ID =
  process.env.NEXT_PUBLIC_IDENTITY_SERVICE_CLIENT_ID || 'identity-console';

// The access token the Next server reads server-side and forwards as
// `Authorization: Bearer` to /admin/v1 (see lib/identity.ts + middleware.ts).
export const TOKEN_COOKIE = 'ids_console_at';

const STORAGE_KEY = 'ids.console.auth.token';
// Refresh this many ms before the access token actually expires, so an in-flight
// request never races the expiry boundary.
const REFRESH_SKEW_MS = 30_000;

export class LoginError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LoginError';
  }
}

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  scope?: string;
}

interface StoredToken {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number; // epoch ms
  refreshExpiresAt: number; // epoch ms
}

// --- token endpoint calls -----------------------------------------------------

async function postTokenGrant(body: URLSearchParams): Promise<OAuthTokenResponse> {
  const response = await fetch(`${IDENTITY_SERVICE_BASE.replace(/\/+$/, '')}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    // OAuth errors carry error_description; keep it generic for the user-facing message.
    throw new LoginError(data?.error_description ?? data?.error ?? 'Login failed', response.status);
  }
  return data as OAuthTokenResponse;
}

/** OAuth `password` grant against identity-service's local IdP. */
export async function requestPasswordToken(opts: {
  username: string;
  password: string;
}): Promise<void> {
  const resp = await postTokenGrant(
    new URLSearchParams({
      grant_type: 'password',
      username: opts.username,
      password: opts.password,
      client_id: IDENTITY_SERVICE_CLIENT_ID,
    }),
  );
  storeToken(resp);
}

/** OAuth `refresh_token` grant — silent re-issue before the access token expires. */
async function refreshGrant(refreshToken: string): Promise<OAuthTokenResponse> {
  return postTokenGrant(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: IDENTITY_SERVICE_CLIENT_ID,
    }),
  );
}

// --- storage (localStorage bundle + access-token cookie) ----------------------

function setCookie(name: string, value: string, maxAgeSec: number): void {
  if (typeof document === 'undefined') return;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${value}; Max-Age=${maxAgeSec}; Path=/; SameSite=Lax${secure}`;
}

function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
}

function storeToken(resp: OAuthTokenResponse): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const stored: StoredToken = {
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token,
    accessExpiresAt: now + resp.expires_in * 1000,
    refreshExpiresAt: now + resp.refresh_expires_in * 1000,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  // The cookie carries the access token to the Next server. Its lifetime is the
  // refresh window (the value is rotated by the keepalive); middleware decodes the
  // JWT `exp` to decide freshness, so a stale-but-present cookie still routes to
  // /login for a silent refresh rather than 401-ing a server render.
  setCookie(TOKEN_COOKIE, resp.access_token, resp.refresh_expires_in);
}

function readToken(): StoredToken | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredToken;
  } catch {
    return null;
  }
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  deleteCookie(TOKEN_COOKIE);
}

export function hasStoredToken(): boolean {
  return readToken() !== null;
}

// --- access-token access (with silent refresh) -------------------------------

/** Return a usable access token, refreshing silently when near expiry. Also keeps
 * the cookie current so the next server render forwards a fresh token. Returns null
 * when there is no session or refresh failed (→ caller shows login). */
export async function ensureAccessToken(): Promise<string | null> {
  const token = readToken();
  if (!token) return null;
  const now = Date.now();
  // Refresh token itself dead → the whole session is over.
  if (token.refreshExpiresAt <= now) {
    clearTokens();
    return null;
  }
  if (token.accessExpiresAt - now > REFRESH_SKEW_MS) {
    // Still valid — make sure the cookie reflects it (e.g. after a cross-tab login).
    setCookie(TOKEN_COOKIE, token.accessToken, Math.floor((token.refreshExpiresAt - now) / 1000));
    return token.accessToken;
  }
  // Access token expired / about to — rotate via the refresh token.
  try {
    const resp = await refreshGrant(token.refreshToken);
    storeToken(resp);
    return resp.access_token;
  } catch {
    clearTokens();
    return null;
  }
}

// --- identity display ---------------------------------------------------------

/** Decode (NOT verify — the management plane verifies) the stored JWT and return the
 * operator's email, else the stable sub, for header display. */
export function identityFromToken(): string | null {
  const token = readToken();
  if (!token) return null;
  const parts = token.accessToken.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { email?: string; sub?: string };
    return payload.email || payload.sub || null;
  } catch {
    return null;
  }
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  // Re-decode as UTF-8 so non-ASCII identities survive.
  return decodeURIComponent(
    Array.from(decoded, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
  );
}
