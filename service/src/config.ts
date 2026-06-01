import dotenv from 'dotenv';

dotenv.config();

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseOrigins = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const CONFIG = {
  environment: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 7305),
  mongo: {
    uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017',
    dbName: process.env.MONGO_DB_NAME ?? 'component-auth'
  },
  auth: {
    sessionTtlMinutes: toNumber(process.env.SESSION_TTL_MINUTES, 15),
    jwtSecret: process.env.AUTH_JWT_SECRET ?? '',
    jwtIssuer: process.env.AUTH_JWT_ISSUER ?? 'component-auth-service',
    jwtAudience: process.env.AUTH_JWT_AUDIENCE ?? 'component-auth-clients',
    // Local-credential IdP (RQ-0002): password policy + brute-force lockout.
    password: {
      minLength: toNumber(process.env.AUTH_PASSWORD_MIN_LENGTH, 10),
      maxFailedAttempts: toNumber(process.env.AUTH_PASSWORD_MAX_ATTEMPTS, 5),
      lockoutMinutes: toNumber(process.env.AUTH_PASSWORD_LOCKOUT_MINUTES, 15),
      // Per-tenant self-service registration rate limit (abuse guard on the public endpoint).
      registrationsPerMinute: toNumber(process.env.AUTH_REGISTRATIONS_PER_MINUTE, 20)
    }
  },
  oauth: {
    accessTokenTtlSec: toNumber(process.env.OAUTH_ACCESS_TOKEN_TTL_SEC, 15 * 60),
    refreshTokenTtlSec: toNumber(process.env.OAUTH_REFRESH_TOKEN_TTL_SEC, 30 * 24 * 60 * 60),
    defaultClientCredentialsScopes: parseOrigins(process.env.OAUTH_CLIENT_CREDENTIALS_SCOPE),
    // The short-lived authorization record (state + PKCE challenge + nonce, then the minted code)
    // that ties the Google redirect leg to the consumer's token exchange. Kept small.
    authorizationTtlSec: toNumber(process.env.OAUTH_AUTHORIZATION_TTL_SEC, 10 * 60),
    key: {
      encryptionPassphrase: process.env.OAUTH_KEY_PASSPHRASE ?? '',
      rotationIntervalHours: toNumber(process.env.OAUTH_KEY_ROTATION_HOURS, 24 * 30)
    },
    tenantDefaults: {
      maxClients: toNumber(process.env.OAUTH_TENANT_MAX_CLIENTS, 50),
      maxAccessTokensPerMinute: toNumber(process.env.OAUTH_TENANT_MAX_TOKENS_PER_MINUTE, 200),
      maxRefreshTokens: toNumber(process.env.OAUTH_TENANT_MAX_REFRESH_TOKENS, 10_000)
    }
  },
  // Upstream Google OIDC app (RQ-0001). A single Google app per deployment federates user login;
  // the issued user token's `aud` is still per-consumer (oauth_clients.audience), not Google's.
  // Endpoints are overridable so tests can inject a stub IdP with no network.
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    issuer: process.env.GOOGLE_ISSUER ?? 'https://accounts.google.com',
    authorizationEndpoint: process.env.GOOGLE_AUTHORIZATION_ENDPOINT ?? 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: process.env.GOOGLE_TOKEN_ENDPOINT ?? 'https://oauth2.googleapis.com/token',
    jwksUri: process.env.GOOGLE_JWKS_URI ?? 'https://www.googleapis.com/oauth2/v3/certs',
    // Where Google redirects back to this service; must be a registered redirect URI on the Google app.
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? ''
  },
  cors: {
    staticOrigins: parseOrigins(process.env.CORS_ORIGINS),
    allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS']
  },
  corsRefreshIntervalMs: toNumber(process.env.TENANT_CORS_REFRESH_INTERVAL_MS, 5 * 60 * 1000)
} as const;

export default CONFIG;
