import { randomUUID, randomBytes } from 'crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { CONFIG } from '../config.js';
import type {
  OAuthServerDependencies,
  ClientCredentialsInput,
  TokenResponse,
  ModelsBucket,
  StartAuthorizationInput,
  StartAuthorizationResult,
  HandleCallbackInput,
  HandleCallbackResult,
  AuthorizationCodeInput,
  RefreshTokenInput,
  RevokeTokenInput,
  PasswordGrantInput,
  UserTokenResponse
} from './types.js';
import {
  InvalidClientError,
  UnauthorizedClientError,
  InvalidScopeError,
  InvalidRequestError,
  RateLimitExceededError,
  InvalidGrantError,
  AccessDeniedError
} from './errors.js';
import { verifySecret, sha256Hex } from '../utils/hash.js';
import { getActiveKeyPair } from '../utils/key-store.js';
import { verifyPkceS256 } from './pkce.js';
import { createGoogleIdp, type GoogleIdp } from './google.js';
import type { TenantOAuthConfig, TenantDocument } from '../models/tenant.js';
import type { OAuthClientDocument } from '../models/oauth-client.js';

const GRANT_CLIENT_CREDENTIALS = 'client_credentials';
const GRANT_AUTHORIZATION_CODE = 'authorization_code';
const GRANT_PASSWORD = 'password';
const GOOGLE_SCOPE = ['openid', 'email', 'profile'];

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function createOAuthServer(deps: OAuthServerDependencies) {
  const nowFn = deps.now ?? (() => new Date());
  // Built lazily so client-credentials-only deployments (no Google config) never construct it.
  let googleIdpInstance: GoogleIdp | undefined = deps.googleIdp;
  const getGoogleIdp = (): GoogleIdp => {
    if (!googleIdpInstance) {
      if (!CONFIG.google.clientId || !CONFIG.google.clientSecret || !CONFIG.google.redirectUri) {
        throw new InvalidRequestError('Google login is not configured on this service');
      }
      googleIdpInstance = createGoogleIdp(CONFIG.google);
    }
    return googleIdpInstance;
  };

  async function issueClientCredentialsToken(input: ClientCredentialsInput): Promise<TokenResponse> {
    if (!input.clientId || !input.clientSecret) {
      throw new InvalidRequestError('client_id and client_secret are required');
    }

    const connection = await deps.getMasterConnection();
    const models = deps.makeModels(connection);

    const client = await models.OAuthClient.findById(input.clientId).lean().exec();
    if (!client) {
      throw new InvalidClientError('Client not found');
    }

    if (!client.isConfidential) {
      throw new UnauthorizedClientError('Client credentials grant requires confidential client');
    }

    if (!verifySecret(input.clientSecret, client.secretHash)) {
      throw new InvalidClientError('Client secret mismatch');
    }

    if (!client.grantTypes.includes(GRANT_CLIENT_CREDENTIALS)) {
      throw new UnauthorizedClientError('Grant type not allowed for client');
    }

    const tenantId = client.tenantId;
    const tenant = await models.Tenant.findOne({ _id: tenantId, status: 'active' }).lean().exec();
    if (!tenant) {
      throw new UnauthorizedClientError('Tenant inactive or missing');
    }

    const tenantOAuthConfig = ((tenant as unknown as { oauth?: TenantOAuthConfig })?.oauth) ?? undefined;
    if (!tenantOAuthConfig?.enabled) {
      throw new UnauthorizedClientError('Tenant not configured for OAuth');
    }

    const tenantGrantTypes = new Set(
      (tenantOAuthConfig.allowedGrantTypes && tenantOAuthConfig.allowedGrantTypes.length
        ? tenantOAuthConfig.allowedGrantTypes
        : [GRANT_CLIENT_CREDENTIALS]
      )
    );
    if (!tenantGrantTypes.has(GRANT_CLIENT_CREDENTIALS)) {
      throw new UnauthorizedClientError('Grant type not enabled for tenant');
    }

    const requestedScope = input.scope ?? [];
    let candidateScopes = requestedScope.length ? [...requestedScope] : [...(client.scopes ?? [])];
    if (!candidateScopes.length && CONFIG.oauth.defaultClientCredentialsScopes.length) {
      candidateScopes = [...CONFIG.oauth.defaultClientCredentialsScopes];
    }

    const allowedScopes = new Set(client.scopes ?? []);
    const tenantScopeAllowlist = tenantOAuthConfig.allowedScopes && tenantOAuthConfig.allowedScopes.length
      ? new Set(tenantOAuthConfig.allowedScopes)
      : null;
    const effectiveScopes: string[] = [];

    if (candidateScopes.length) {
      for (const scope of candidateScopes) {
        if (!allowedScopes.has(scope)) {
          throw new InvalidScopeError(`Scope ${scope} not permitted for client`);
        }
        if (tenantScopeAllowlist && !tenantScopeAllowlist.has(scope)) {
          throw new InvalidScopeError(`Scope ${scope} not permitted for tenant`);
        }
        if (!effectiveScopes.includes(scope)) {
          effectiveScopes.push(scope);
        }
      }
    } else if (tenantScopeAllowlist) {
      for (const scope of tenantScopeAllowlist) {
        if (allowedScopes.has(scope)) {
          effectiveScopes.push(scope);
        }
      }
    }

    for (const scope of effectiveScopes) {
      if (!allowedScopes.has(scope)) {
        throw new InvalidScopeError(`Scope ${scope} not permitted`);
      }
    }

    const issuedAt = nowFn();
    const tenantTokenLimit = tenantOAuthConfig.limits?.tokensPerMinute ?? CONFIG.oauth.tenantDefaults.maxAccessTokensPerMinute;
    await enforceRateLimit(models, tenantId, issuedAt, tenantTokenLimit);
    const expiresIn = CONFIG.oauth.accessTokenTtlSec;
    const expDate = new Date(issuedAt.getTime() + expiresIn * 1000);
    const jti = randomUUID();

    const keyPair = await getActiveKeyPair();
    const privateKey = await importPKCS8(keyPair.privateKeyPem, 'RS256');

    const payload: Record<string, unknown> = {
      tid: tenantId,
      cid: client._id,
      scope: effectiveScopes.join(' '),
      sub: input.subject ?? client._id
    };
    if (input.sessionId) {
      payload.sid = input.sessionId;
    }

    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: keyPair.kid, typ: 'JWT' })
      .setIssuer(CONFIG.auth.jwtIssuer)
      .setAudience(CONFIG.auth.jwtAudience)
      .setJti(jti)
      .setIssuedAt(Math.floor(issuedAt.getTime() / 1000))
      .setExpirationTime(Math.floor(expDate.getTime() / 1000))
      .sign(privateKey);

    await models.OAuthToken.create({
      _id: jti,
      tenantId,
      clientId: client._id,
      subject: payload.sub,
      sessionId: input.sessionId,
      type: 'access',
      scope: effectiveScopes,
      expiresAt: expDate,
      issuedAt,
      status: 'active'
    });

    deps.logger?.info?.({ tenantId, clientId: client._id, scopes: effectiveScopes }, 'issued client credentials token');

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn,
      scope: effectiveScopes
    };
  }

  // --- User login flow (RQ-0001: Google SSO, OIDC Authorization Code + PKCE) ---

  /**
   * Load + validate a client and its tenant for a user-token grant (`authorization_code` or
   * `password`). Mirrors the client-credentials checks: tenant active + OAuth enabled, and the grant
   * permitted by both tenant and client.
   */
  async function loadFlowClient(models: ModelsBucket, clientId: string, grantType: string): Promise<{
    client: OAuthClientDocument;
    tenant: TenantDocument;
  }> {
    const client = await models.OAuthClient.findById(clientId).lean().exec() as OAuthClientDocument | null;
    if (!client) {
      throw new InvalidClientError('Client not found');
    }
    if (!client.grantTypes.includes(grantType)) {
      throw new UnauthorizedClientError(`Grant ${grantType} not allowed for client`);
    }

    const tenant = await models.Tenant.findOne({ _id: client.tenantId, status: 'active' }).lean().exec() as TenantDocument | null;
    if (!tenant) {
      throw new UnauthorizedClientError('Tenant inactive or missing');
    }
    const oauthConfig = ((tenant as unknown as { oauth?: TenantOAuthConfig })?.oauth) ?? undefined;
    if (!oauthConfig?.enabled) {
      throw new UnauthorizedClientError('Tenant not configured for OAuth');
    }
    const tenantGrants = new Set(oauthConfig.allowedGrantTypes ?? []);
    if (!tenantGrants.has(grantType)) {
      throw new UnauthorizedClientError(`Grant ${grantType} not enabled for tenant`);
    }
    return { client, tenant };
  }

  async function startAuthorization(input: StartAuthorizationInput): Promise<StartAuthorizationResult> {
    if ((input.codeChallengeMethod ?? 'S256') !== 'S256') {
      throw new InvalidRequestError('Only the S256 PKCE method is supported');
    }
    if (!input.codeChallenge) {
      throw new InvalidRequestError('code_challenge is required');
    }
    if (!input.redirectUri) {
      throw new InvalidRequestError('redirect_uri is required');
    }

    const idp = getGoogleIdp();
    const connection = await deps.getMasterConnection();
    const models = deps.makeModels(connection);
    const { client } = await loadFlowClient(models, input.clientId, GRANT_AUTHORIZATION_CODE);

    // The redirect_uri MUST be pre-registered on the client (open-redirect / token-theft guard).
    if (!client.redirectUris?.includes(input.redirectUri)) {
      throw new InvalidRequestError('redirect_uri is not registered for this client');
    }
    // A user token is only meaningful if it can be audience-bound to a consumer (RQ-0001 AC4).
    if (!client.audience) {
      throw new UnauthorizedClientError('Client has no audience configured for user tokens');
    }

    const requestedScope = input.scope ?? [];
    const allowedScopes = new Set(client.scopes ?? []);
    const scope = requestedScope.filter((s) => allowedScopes.has(s));

    const issuedAt = nowFn();
    const googleState = randomToken();
    const nonce = randomToken();
    const expiresAt = new Date(issuedAt.getTime() + CONFIG.oauth.authorizationTtlSec * 1000);

    await models.OAuthAuthorization.create({
      _id: randomUUID(),
      tenantId: client.tenantId,
      clientId: client._id,
      consumerRedirectUri: input.redirectUri,
      consumerState: input.state,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: 'S256',
      scope,
      googleState,
      nonce,
      status: 'pending',
      expiresAt
    });

    const redirectTo = idp.buildAuthorizationUrl({ state: googleState, nonce, scope: GOOGLE_SCOPE });
    deps.logger?.info?.({ tenantId: client.tenantId, clientId: client._id }, 'started user authorization');
    return { redirectTo };
  }

  async function handleGoogleCallback(input: HandleCallbackInput): Promise<HandleCallbackResult> {
    if (!input.state || !input.code) {
      throw new AccessDeniedError('Missing code or state on callback');
    }
    const idp = getGoogleIdp();
    const connection = await deps.getMasterConnection();
    const models = deps.makeModels(connection);

    const record = await models.OAuthAuthorization.findOne({ googleState: input.state, status: 'pending' }).exec();
    // No trusted redirect target without a matching, unexpired record — deny outright.
    if (!record || record.expiresAt.getTime() < nowFn().getTime()) {
      throw new AccessDeniedError('Authorization state is invalid or expired');
    }

    const appendError = (uri: string): string => {
      const sep = uri.includes('?') ? '&' : '?';
      const params = new URLSearchParams({ error: 'access_denied' });
      if (record.consumerState) params.set('state', record.consumerState);
      return `${uri}${sep}${params.toString()}`;
    };

    try {
      const { idToken } = await idp.exchangeCode(input.code);
      const identity = await idp.verifyIdToken(idToken, { nonce: record.nonce });

      record.status = 'authenticated';
      record.code = randomToken();
      record.email = identity.email;
      record.sub = identity.sub;
      await record.save();

      const sep = record.consumerRedirectUri.includes('?') ? '&' : '?';
      const params = new URLSearchParams({ code: record.code });
      if (record.consumerState) params.set('state', record.consumerState);
      const redirectTo = `${record.consumerRedirectUri}${sep}${params.toString()}`;
      deps.logger?.info?.({ tenantId: record.tenantId, clientId: record.clientId }, 'google authentication succeeded');
      return { redirectTo };
    } catch (error) {
      // Google leg failed — redirect back to the (registered, therefore trusted) consumer with a
      // standard OAuth error, minting no token (RQ-0001 AC).
      deps.logger?.error?.({ err: error, clientId: record.clientId }, 'google authentication failed');
      return { redirectTo: appendError(record.consumerRedirectUri) };
    }
  }

  async function issueAuthorizationCodeToken(input: AuthorizationCodeInput): Promise<UserTokenResponse> {
    if (!input.code || !input.codeVerifier) {
      throw new InvalidRequestError('code and code_verifier are required');
    }
    const connection = await deps.getMasterConnection();
    const models = deps.makeModels(connection);

    const record = await models.OAuthAuthorization.findOne({ code: input.code, status: 'authenticated' }).exec();
    if (!record || record.expiresAt.getTime() < nowFn().getTime()) {
      throw new InvalidGrantError('Authorization code is invalid or expired');
    }
    if (record.clientId !== input.clientId) {
      throw new InvalidGrantError('Authorization code was issued to a different client');
    }
    if (record.consumerRedirectUri !== input.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request');
    }
    if (!verifyPkceS256(input.codeVerifier, record.codeChallenge)) {
      throw new InvalidGrantError('PKCE verification failed');
    }
    if (!record.email || !record.sub) {
      throw new InvalidGrantError('Authorization has no established identity');
    }

    const { client } = await loadFlowClient(models, record.clientId, GRANT_AUTHORIZATION_CODE);

    // Single-use: consume the code before issuing, so a replay cannot mint a second token.
    record.status = 'consumed';
    record.code = undefined;
    await record.save();

    return issueUserTokens(models, {
      client,
      tenantId: record.tenantId,
      email: record.email,
      sub: record.sub,
      scope: record.scope ?? []
    });
  }

  async function issuePasswordToken(input: PasswordGrantInput): Promise<UserTokenResponse> {
    if (!input.username || !input.password) {
      throw new InvalidRequestError('username and password are required');
    }
    const connection = await deps.getMasterConnection();
    const models = deps.makeModels(connection);
    const { client } = await loadFlowClient(models, input.clientId, GRANT_PASSWORD);

    const email = input.username.trim().toLowerCase();
    const user = await models.User.findOne({ tenantId: client.tenantId, email }).exec();
    const now = nowFn();

    // Uniform failure for unknown email vs wrong password — no user enumeration.
    const genericDenied = () => new InvalidGrantError('Invalid credentials');

    if (!user || user.status === 'disabled') {
      throw genericDenied();
    }
    // Temporal brute-force lockout.
    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
      throw new InvalidGrantError('Account is temporarily locked');
    }

    if (!verifySecret(input.password, user.passwordHash)) {
      user.failedAttempts = (user.failedAttempts ?? 0) + 1;
      if (user.failedAttempts >= CONFIG.auth.password.maxFailedAttempts) {
        user.lockedUntil = new Date(now.getTime() + CONFIG.auth.password.lockoutMinutes * 60 * 1000);
        user.failedAttempts = 0;
        deps.logger?.info?.({ tenantId: client.tenantId, userId: user._id }, 'user locked after failed logins');
      }
      await user.save();
      throw genericDenied();
    }

    // Success: clear the brute-force counters.
    if (user.failedAttempts || user.lockedUntil) {
      user.failedAttempts = 0;
      user.lockedUntil = null;
      await user.save();
    }

    return issueUserTokens(models, {
      client,
      tenantId: client.tenantId,
      email: user.email,
      sub: user._id, // the stable subject id
      scope: []
    });
  }

  async function refreshUserToken(input: RefreshTokenInput): Promise<UserTokenResponse> {
    if (!input.refreshToken) {
      throw new InvalidRequestError('refresh_token is required');
    }
    const connection = await deps.getMasterConnection();
    const models = deps.makeModels(connection);

    const hashed = sha256Hex(input.refreshToken);
    const tokenDoc = await models.OAuthToken.findOne({ hashedToken: hashed, type: 'refresh' }).exec();
    const now = nowFn();
    if (!tokenDoc || tokenDoc.status !== 'active' || tokenDoc.expiresAt.getTime() < now.getTime()) {
      throw new InvalidGrantError('Refresh token is invalid, expired, or revoked');
    }
    if (tokenDoc.clientId !== input.clientId) {
      throw new InvalidGrantError('Refresh token was issued to a different client');
    }

    // A refresh MUST NOT outlive a revoked session (RQ-0001 AC6).
    const session = tokenDoc.sessionId
      ? await models.Session.findById(tokenDoc.sessionId).exec()
      : null;
    if (!session || session.status !== 'active' || session.expiresAt.getTime() < now.getTime()) {
      throw new InvalidGrantError('Session is revoked or expired');
    }

    // Refresh is grant-agnostic — the client was already vetted at the original login. Just confirm
    // it still exists (audience needed to re-mint); don't require a specific login grant here.
    const client = await models.OAuthClient.findById(tokenDoc.clientId).lean().exec() as OAuthClientDocument | null;
    if (!client) {
      throw new InvalidGrantError('Client no longer exists');
    }
    const email = (session.context as { email?: string } | null)?.email ?? undefined;
    const sub = tokenDoc.subject;
    if (!sub) {
      throw new InvalidGrantError('Refresh token has no subject');
    }

    // Rotate: the presented refresh token is single-use.
    tokenDoc.status = 'revoked';
    await tokenDoc.save();

    return issueUserTokens(models, {
      client,
      tenantId: tokenDoc.tenantId,
      email,
      sub,
      scope: tokenDoc.scope ?? [],
      session
    });
  }

  async function revokeUserToken(input: RevokeTokenInput): Promise<void> {
    if (!input.token) return; // RFC 7009: revocation is idempotent; unknown tokens succeed silently.
    const connection = await deps.getMasterConnection();
    const models = deps.makeModels(connection);

    const hashed = sha256Hex(input.token);
    const tokenDoc = await models.OAuthToken.findOne({ hashedToken: hashed, type: 'refresh' }).exec();
    if (!tokenDoc) return;

    tokenDoc.status = 'revoked';
    await tokenDoc.save();

    // Cascade to the session so any sibling refresh token is also dead (AC6).
    if (tokenDoc.sessionId) {
      await models.Session.updateOne(
        { _id: tokenDoc.sessionId },
        { $set: { status: 'revoked', updatedAt: nowFn() } }
      ).exec();
    }
    deps.logger?.info?.({ clientId: tokenDoc.clientId, sessionId: tokenDoc.sessionId }, 'revoked user session');
  }

  /**
   * Mint an access JWT + a rotating refresh token for a verified user identity, persisting their
   * metadata and (on first issue) the session. Reused by the authorization-code and refresh grants.
   */
  async function issueUserTokens(
    models: ModelsBucket,
    args: {
      client: OAuthClientDocument;
      tenantId: string;
      email?: string;
      sub: string;
      scope: string[];
      session?: { _id: string; expiresAt: Date };
    }
  ): Promise<UserTokenResponse> {
    if (!args.client.audience) {
      throw new UnauthorizedClientError('Client has no audience configured for user tokens');
    }
    const issuedAt = nowFn();
    const accessExpiresIn = CONFIG.oauth.accessTokenTtlSec;
    const accessExp = new Date(issuedAt.getTime() + accessExpiresIn * 1000);

    // The session bounds the absolute lifetime; refresh tokens never outlive it.
    let sessionId: string;
    let sessionExpiresAt: Date;
    if (args.session) {
      sessionId = args.session._id;
      sessionExpiresAt = args.session.expiresAt;
    } else {
      sessionId = randomUUID();
      sessionExpiresAt = new Date(issuedAt.getTime() + CONFIG.oauth.refreshTokenTtlSec * 1000);
      await models.Session.create({
        _id: sessionId,
        tenantId: args.tenantId,
        contactId: args.sub,
        context: args.email ? { email: args.email } : {},
        status: 'active',
        expiresAt: sessionExpiresAt
      });
    }

    const jti = randomUUID();
    const accessToken = await signUserAccessToken({
      jti,
      audience: args.client.audience,
      email: args.email,
      sub: args.sub,
      scope: args.scope,
      issuedAt,
      expiresAt: accessExp
    });

    await models.OAuthToken.create({
      _id: jti,
      tenantId: args.tenantId,
      clientId: args.client._id,
      subject: args.sub,
      sessionId,
      type: 'access',
      scope: args.scope,
      expiresAt: accessExp,
      issuedAt,
      status: 'active'
    });

    // Opaque, high-entropy refresh token — only its hash is stored.
    const refreshTokenValue = randomToken();
    const refreshJti = randomUUID();
    await models.OAuthToken.create({
      _id: refreshJti,
      tenantId: args.tenantId,
      clientId: args.client._id,
      subject: args.sub,
      sessionId,
      type: 'refresh',
      scope: args.scope,
      expiresAt: sessionExpiresAt,
      issuedAt,
      status: 'active',
      hashedToken: sha256Hex(refreshTokenValue)
    });

    const refreshExpiresIn = Math.max(0, Math.floor((sessionExpiresAt.getTime() - issuedAt.getTime()) / 1000));
    deps.logger?.info?.({ tenantId: args.tenantId, clientId: args.client._id, sub: args.sub }, 'issued user token');

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: accessExpiresIn,
      refreshToken: refreshTokenValue,
      refreshExpiresIn,
      scope: args.scope
    };
  }

  /** Build the user identity JWT maestro verifies: RS256, `email` + `sub` + `iss` + `aud` + `exp`/`iat`. */
  async function signUserAccessToken(args: {
    jti: string;
    audience: string;
    email?: string;
    sub: string;
    scope: string[];
    issuedAt: Date;
    expiresAt: Date;
  }): Promise<string> {
    const keyPair = await getActiveKeyPair();
    const privateKey = await importPKCS8(keyPair.privateKeyPem, 'RS256');

    const payload: Record<string, unknown> = {};
    if (args.email) payload.email = args.email;
    if (args.scope.length) payload.scope = args.scope.join(' ');

    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: keyPair.kid, typ: 'JWT' })
      .setIssuer(CONFIG.auth.jwtIssuer)
      .setAudience(args.audience)
      .setSubject(args.sub)
      .setJti(args.jti)
      .setIssuedAt(Math.floor(args.issuedAt.getTime() / 1000))
      .setExpirationTime(Math.floor(args.expiresAt.getTime() / 1000))
      .sign(privateKey);
  }

  return {
    issueClientCredentialsToken,
    startAuthorization,
    handleGoogleCallback,
    issueAuthorizationCodeToken,
    issuePasswordToken,
    refreshUserToken,
    revokeUserToken
  };
}

async function enforceRateLimit(models: ReturnType<OAuthServerDependencies['makeModels']>, tenantId: string, issuedAt: Date, maxPerMinute: number) {
  if (!Number.isFinite(maxPerMinute) || maxPerMinute <= 0) {
    return;
  }
  const windowStart = new Date(issuedAt.getTime() - 60 * 1000);
  const count = await models.OAuthToken.countDocuments({
    tenantId,
    type: 'access',
    issuedAt: { $gte: windowStart }
  }).exec();

  if (count >= maxPerMinute) {
    throw new RateLimitExceededError(60);
  }
}
