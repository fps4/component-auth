import type { Connection, Model } from 'mongoose';
import type { Logger } from '../utils/logger.js';
import type {
  TenantDocument,
  OAuthClientDocument,
  OAuthTokenDocument,
  OAuthAuthorizationDocument,
  UserDocument,
  KeyStoreDocument,
  SessionDocument
} from '../models/index.js';
import type { GoogleIdp } from './google.js';

export interface ModelsBucket {
  Tenant: Model<TenantDocument>;
  OAuthClient: Model<OAuthClientDocument>;
  OAuthToken: Model<OAuthTokenDocument>;
  OAuthAuthorization: Model<OAuthAuthorizationDocument>;
  User: Model<UserDocument>;
  KeyStore: Model<KeyStoreDocument>;
  Session: Model<SessionDocument>;
}

export interface OAuthServerDependencies {
  getMasterConnection: () => Promise<Connection>;
  makeModels: (connection: Connection) => ModelsBucket;
  // The upstream Google OIDC adapter. Injectable so tests drive the flow with a stub (no network).
  googleIdp?: GoogleIdp;
  now?: () => Date;
  logger?: Logger;
}

export interface ClientCredentialsInput {
  clientId: string;
  clientSecret: string;
  scope?: string[];
  tenantId?: string;
  subject?: string;
  sessionId?: string;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope: string[];
}

// --- User login flow (RQ-0001: Google SSO via OIDC Authorization Code + PKCE) ---

export interface StartAuthorizationInput {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod?: string; // only 'S256' is supported
  state?: string;               // the consumer's opaque state, echoed back
  scope?: string[];
}

export interface StartAuthorizationResult {
  // Fully-formed Google authorization URL the caller should redirect the browser to.
  redirectTo: string;
}

export interface HandleCallbackInput {
  code: string;   // Google's authorization code
  state: string;  // our googleState, matched against the stored authorization record
}

export interface HandleCallbackResult {
  // Where to 302 the browser back to the consumer, carrying our single-use code + the echoed state.
  redirectTo: string;
}

export interface AuthorizationCodeInput {
  code: string;          // our authorization code
  codeVerifier: string;  // PKCE verifier, hashed and matched against the stored challenge
  clientId: string;
  redirectUri: string;
}

export interface RefreshTokenInput {
  refreshToken: string;
  clientId: string;
}

export interface PasswordGrantInput {
  username: string;   // the user's email
  password: string;
  clientId: string;
}

export interface RevokeTokenInput {
  token: string;        // a refresh token; revokes it and its session
}

export interface UserTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  scope: string[];
}
