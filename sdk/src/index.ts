export interface ComponentAuthClientOptions {
  baseUrl: string;
  apiKey?: string;
  defaultTenantId?: string;
  fetchImpl?: typeof fetch;
  defaultHeaders?: Record<string, string>;
  defaultClientId?: string;
  defaultClientSecret?: string;
}

export interface CreateSessionParams {
  tenantId?: string;
  visitorId?: string;
  subject?: string;
  clientMeta?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface CreateSessionResponse {
  sessionId: string;
  token: string;
  expiresIn: number;
  expiresAt: string;
  visitorId: string;
}

export interface UpdateSessionParams {
  sessionId: string;
  contactId?: string;
  cookies?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface UpdateSessionResponse {
  sessionId: string;
  updated: {
    contactId?: string | null;
    context?: Record<string, unknown> | null;
    updatedAt: string;
  };
}

export interface ClientCredentialsParams {
  clientId?: string;
  clientSecret?: string;
  scope?: string[];
  headers?: Record<string, string>;
}

export interface ClientCredentialsResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  scope: string[];
}

export interface BeginGoogleLoginParams {
  clientId?: string;
  redirectUri: string;
  scope?: string[];
  state?: string;
  headers?: Record<string, string>;
}

export interface BeginGoogleLoginResult {
  /** Navigate the browser here (e.g. `window.location.assign(authorizationUrl)`) to start Google login. */
  authorizationUrl: string;
  /** PKCE verifier — stash it (e.g. sessionStorage) and pass it back to `completeGoogleLogin`. */
  codeVerifier: string;
  /** Opaque CSRF state echoed back on the redirect; compare it before completing. */
  state: string;
}

export interface CompleteGoogleLoginParams {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId?: string;
  headers?: Record<string, string>;
}

export interface RefreshUserTokenParams {
  refreshToken: string;
  clientId?: string;
  headers?: Record<string, string>;
}

export interface RevokeUserTokenParams {
  token: string;
  headers?: Record<string, string>;
}

export interface RegisterWithPasswordParams {
  tenantId?: string;
  email: string;
  password: string;
  headers?: Record<string, string>;
}

export interface RegisteredUser {
  id: string;
  email: string;
  tenantId: string;
}

export interface LoginWithPasswordParams {
  username: string;
  password: string;
  clientId?: string;
  headers?: Record<string, string>;
}

export interface UserTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  scope: string[];
}

interface RequestOptions {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  skipDefaultAuth?: boolean;
}

export class ComponentAuthClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultTenantId?: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly defaultClientId?: string;
  private readonly defaultClientSecret?: string;

  constructor(options: ComponentAuthClientOptions) {
    if (!options?.baseUrl) {
      throw new Error('baseUrl is required');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.defaultTenantId = options.defaultTenantId;
    this.fetchImpl = options.fetchImpl;
    this.defaultHeaders = options.defaultHeaders ? { ...options.defaultHeaders } : {};
    this.defaultClientId = options.defaultClientId;
    this.defaultClientSecret = options.defaultClientSecret;
  }

  async createSession(params: CreateSessionParams): Promise<CreateSessionResponse> {
    const tenantId = params.tenantId ?? this.defaultTenantId;
    if (!tenantId) {
      throw new Error('tenantId is required when creating a session');
    }

    const url = `${this.baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/sessions`;
    const payload: Record<string, unknown> = {};
    if (params.visitorId) payload.visitorId = params.visitorId;
    if (params.subject) payload.subject = params.subject;
    if (params.clientMeta) payload.clientMeta = params.clientMeta;

    const response = await this.request<CreateSessionResponse>(url, {
      method: 'POST',
      headers: params.headers,
      body: JSON.stringify(payload)
    });

    return response;
  }

  async updateSession(params: UpdateSessionParams): Promise<UpdateSessionResponse> {
    if (!params.sessionId) {
      throw new Error('sessionId is required when updating a session');
    }

    const url = `${this.baseUrl}/v1/sessions/${encodeURIComponent(params.sessionId)}`;
    const payload: Record<string, unknown> = { sessionId: params.sessionId };
    if (params.contactId) payload.contactId = params.contactId;
    if (params.cookies) payload.cookies = params.cookies;

    const response = await this.request<UpdateSessionResponse>(url, {
      method: 'PATCH',
      headers: params.headers,
      body: JSON.stringify(payload)
    });

    return response;
  }

  async requestClientCredentialsToken(params: ClientCredentialsParams = {}): Promise<ClientCredentialsResponse> {
    const clientId = params.clientId ?? this.defaultClientId;
    const clientSecret = params.clientSecret ?? this.defaultClientSecret;
    if (!clientId || !clientSecret) {
      throw new Error('clientId and clientSecret are required to request client credentials tokens');
    }

    const url = `${this.baseUrl}/oauth2/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials'
    });
    if (params.scope?.length) {
      body.set('scope', params.scope.join(' '));
    }

    const headers: Record<string, string> = {
      ...params.headers,
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    if (!headers.Authorization && !headers.authorization) {
      const bufferCtor = (globalThis as any)?.Buffer;
      if (bufferCtor?.from) {
        headers.Authorization = `Basic ${bufferCtor.from(`${clientId}:${clientSecret}`).toString('base64')}`;
      } else {
        body.set('client_id', clientId);
        body.set('client_secret', clientSecret);
      }
    } else {
      body.set('client_id', clientId);
    }

    const response = await this.request<any>(url, {
      method: 'POST',
      headers,
      body: body.toString(),
      skipDefaultAuth: true
    });

    return {
      accessToken: response.access_token,
      tokenType: response.token_type,
      expiresIn: response.expires_in,
      scope: typeof response.scope === 'string' && response.scope.trim()
        ? response.scope.trim().split(/\s+/)
        : []
    };
  }

  /**
   * Start a Google login (RQ-0001). Generates a PKCE verifier/challenge and returns the
   * `/oauth2/authorize` URL to redirect the browser to, plus the `codeVerifier` and `state` the
   * caller must persist (the redirect comes back to `redirectUri` with `?code&state`).
   */
  async beginGoogleLogin(params: BeginGoogleLoginParams): Promise<BeginGoogleLoginResult> {
    const clientId = params.clientId ?? this.defaultClientId;
    if (!clientId) {
      throw new Error('clientId is required to begin Google login');
    }
    if (!params.redirectUri) {
      throw new Error('redirectUri is required to begin Google login');
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await deriveCodeChallenge(codeVerifier);
    const state = params.state ?? generateCodeVerifier();

    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: params.redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state
    });
    if (params.scope?.length) {
      query.set('scope', params.scope.join(' '));
    }

    return {
      authorizationUrl: `${this.baseUrl}/oauth2/authorize?${query.toString()}`,
      codeVerifier,
      state
    };
  }

  /** Exchange the authorization `code` (with its PKCE `codeVerifier`) for a user token. */
  async completeGoogleLogin(params: CompleteGoogleLoginParams): Promise<UserTokenResponse> {
    const clientId = params.clientId ?? this.defaultClientId;
    if (!clientId) {
      throw new Error('clientId is required to complete Google login');
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      code_verifier: params.codeVerifier,
      client_id: clientId,
      redirect_uri: params.redirectUri
    });
    return this.postUserToken(body, params.headers);
  }

  /** Rotate a refresh token for a fresh access + refresh token pair. */
  async refreshUserToken(params: RefreshUserTokenParams): Promise<UserTokenResponse> {
    const clientId = params.clientId ?? this.defaultClientId;
    if (!clientId) {
      throw new Error('clientId is required to refresh a user token');
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
      client_id: clientId
    });
    return this.postUserToken(body, params.headers);
  }

  /** Revoke a refresh token and its session (RFC 7009; succeeds even for unknown tokens). */
  async revokeUserToken(params: RevokeUserTokenParams): Promise<void> {
    const body = new URLSearchParams({ token: params.token });
    await this.request(`${this.baseUrl}/oauth2/revoke`, {
      method: 'POST',
      headers: { ...params.headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      skipDefaultAuth: true
    });
  }

  /** Self-service local-credential registration (RQ-0002). Login is a separate `loginWithPassword`. */
  async registerWithPassword(params: RegisterWithPasswordParams): Promise<RegisteredUser> {
    const tenantId = params.tenantId ?? this.defaultTenantId;
    if (!tenantId) {
      throw new Error('tenantId is required to register');
    }
    const url = `${this.baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/register`;
    return this.request<RegisteredUser>(url, {
      method: 'POST',
      headers: params.headers,
      body: JSON.stringify({ email: params.email, password: params.password })
    });
  }

  /** Log in with email + password (the `password` grant), returning a user token. */
  async loginWithPassword(params: LoginWithPasswordParams): Promise<UserTokenResponse> {
    const clientId = params.clientId ?? this.defaultClientId;
    if (!clientId) {
      throw new Error('clientId is required to log in with a password');
    }
    const body = new URLSearchParams({
      grant_type: 'password',
      username: params.username,
      password: params.password,
      client_id: clientId
    });
    return this.postUserToken(body, params.headers);
  }

  private async postUserToken(body: URLSearchParams, headers?: Record<string, string>): Promise<UserTokenResponse> {
    const response = await this.request<any>(`${this.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      skipDefaultAuth: true
    });
    return {
      accessToken: response.access_token,
      tokenType: response.token_type,
      expiresIn: response.expires_in,
      refreshToken: response.refresh_token,
      refreshExpiresIn: response.refresh_expires_in,
      scope: typeof response.scope === 'string' && response.scope.trim()
        ? response.scope.trim().split(/\s+/)
        : []
    };
  }

  private async request<T>(url: string, init: RequestOptions & { skipDefaultAuth?: boolean }): Promise<T> {
    const fetcher = await this.resolveFetch();
    const headers = this.buildHeaders(init.headers, init.skipDefaultAuth);
    const response = await fetcher(url, {
      method: init.method,
      body: init.body,
      headers
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = data?.message ?? response.statusText;
      const error = new Error(message);
      (error as any).status = response.status;
      (error as any).details = data;
      throw error;
    }
    return data as T;
  }

  private buildHeaders(headers?: Record<string, string>, skipDefaultAuth?: boolean) {
    const result: Record<string, string> = {
      ...this.defaultHeaders,
      ...(headers ?? {})
    };
    if (!result['Content-Type'] && !result['content-type']) {
      result['Content-Type'] = 'application/json';
    }
    if (!skipDefaultAuth && this.apiKey && !result.Authorization && !result.authorization) {
      result.Authorization = `Bearer ${this.apiKey}`;
    }
    return result;
  }

  private async resolveFetch(): Promise<typeof fetch> {
    if (this.fetchImpl) {
      return this.fetchImpl;
    }
    if (typeof fetch === 'function') {
      return fetch;
    }
    throw new Error('No fetch implementation available. Supply fetchImpl option or polyfill global fetch.');
  }
}

// --- PKCE helpers (RFC 7636). Portable across browsers and Node 18+ via WebCrypto. ---

function getCrypto(): Crypto {
  const c = (globalThis as any).crypto as Crypto | undefined;
  if (!c?.subtle || typeof c.getRandomValues !== 'function') {
    throw new Error('WebCrypto is unavailable; PKCE login requires a browser or Node 18+');
  }
  return c;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : (globalThis as any).Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateCodeVerifier(): string {
  const random = new Uint8Array(32);
  getCrypto().getRandomValues(random);
  return base64UrlEncode(random);
}

async function deriveCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await getCrypto().subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

export default ComponentAuthClient;
