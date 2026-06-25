import { randomUUID } from 'crypto';
import mongoose, { Connection, Document, Model } from 'mongoose';

/**
 * A single in-flight user login (RQ-0001). Created when the consumer's browser hits
 * `/oauth2/authorize`, carried through the Google redirect leg, and consumed once at the
 * `authorization_code` token exchange.
 *
 * Lifecycle: `pending` (awaiting Google) -> `authenticated` (Google verified, our code minted,
 * identity captured) -> `consumed` (token issued; the code is single-use). A short TTL index
 * sweeps abandoned records.
 *
 * `codeChallenge` is the consumer's PKCE challenge (S256), verified against its `code_verifier`
 * at exchange. `googleState` / `nonce` protect the Google leg against CSRF / replay.
 */
export interface OAuthAuthorizationDocument extends Document<string> {
  _id: string;                 // internal authorization id
  tenantId: string;
  clientId: string;
  consumerRedirectUri: string; // where we 302 back to the consumer (must be registered on the client)
  consumerState?: string;      // the consumer's opaque state, echoed back untouched
  codeChallenge: string;       // PKCE S256 challenge from the consumer
  codeChallengeMethod: 'S256';
  scope: string[];
  googleState: string;         // random state for the Google leg (matched on callback)
  nonce: string;               // random nonce embedded in + verified from Google's id_token
  status: 'pending' | 'authenticated' | 'consumed';
  code?: string;               // our single-use authorization code (minted after Google succeeds)
  email?: string;              // captured identity once Google verifies
  sub?: string;                // stable Google subject
  expiresAt: Date;
  createdAt?: Date;
}

const oauthAuthorizationSchema = new mongoose.Schema<OAuthAuthorizationDocument>({
  _id: { type: String, required: true, default: () => randomUUID() },
  tenantId: { type: String, required: true, index: true },
  clientId: { type: String, required: true, index: true },
  consumerRedirectUri: { type: String, required: true },
  consumerState: { type: String },
  codeChallenge: { type: String, required: true },
  codeChallengeMethod: { type: String, enum: ['S256'], default: 'S256' },
  scope: { type: [String], default: [] },
  googleState: { type: String, required: true, index: true },
  nonce: { type: String, required: true },
  status: { type: String, enum: ['pending', 'authenticated', 'consumed'], default: 'pending', index: true },
  code: { type: String, index: true },
  email: { type: String },
  sub: { type: String },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

// TTL sweep of abandoned/expired login attempts.
oauthAuthorizationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export function getOAuthAuthorizationModel(connection: Connection): Model<OAuthAuthorizationDocument> {
  return (connection.models.OAuthAuthorization as Model<OAuthAuthorizationDocument>) ??
    connection.model<OAuthAuthorizationDocument>('OAuthAuthorization', oauthAuthorizationSchema, 'oauth_authorizations');
}

export const OAuthAuthorization: Model<OAuthAuthorizationDocument> =
  (mongoose.models.OAuthAuthorization as Model<OAuthAuthorizationDocument>) ??
  mongoose.model<OAuthAuthorizationDocument>('OAuthAuthorization', oauthAuthorizationSchema, 'oauth_authorizations');
