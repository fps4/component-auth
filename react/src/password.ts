// The one network call behind <Login/> (RQ-0003): the OAuth `password` grant against identity-service.
// Kept as a standalone, framework-free function so it is unit-testable with a mocked fetch and reusable
// by custom UIs. Self-contained on purpose — this package depends only on React (peer), nothing else.

export interface UserTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  scope: string[];
}

export interface PasswordLoginRequest {
  /** identity-service base URL, e.g. https://auth-dev.example.com */
  baseUrl: string;
  /** an OAuth client that allows the `password` grant and has an `audience` */
  clientId: string;
  username: string;
  password: string;
  /** override fetch (tests / SSR); defaults to global fetch */
  fetchImpl?: typeof fetch;
}

export class LoginError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'LoginError';
  }
}

export async function requestPasswordToken(req: PasswordLoginRequest): Promise<UserTokenResponse> {
  const fetcher = req.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetcher) {
    throw new LoginError('No fetch implementation available', 0);
  }

  const body = new URLSearchParams({
    grant_type: 'password',
    username: req.username,
    password: req.password,
    client_id: req.clientId
  });

  const response = await fetcher(`${req.baseUrl.replace(/\/+$/, '')}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    // OAuth errors carry error_description; keep it generic for the user-facing message.
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
