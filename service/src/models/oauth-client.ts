import { randomUUID } from 'crypto';
import mongoose, { Connection, Document, Model } from 'mongoose';

export interface OAuthClientDocument extends Document {
  _id: string; // client_id
  tenantId: string;
  name: string;
  secretHash: string;
  grantTypes: string[];
  redirectUris: string[];
  scopes: string[];
  isConfidential: boolean;
  // The `aud` value stamped on tokens minted for this consumer (RQ-0001). Binds a token to one
  // workspace — maestro's COMPONENT_AUTH_AUDIENCE must equal this. Now honoured by the
  // client-credentials grant too (US-0086), so a machine principal can be audience-bound to a workspace
  // (e.g. `maestro-workspace`) rather than the service-wide default.
  audience?: string;
  // The `sub` a client-credentials token carries (US-0086). For a product_runtime credential this is the
  // deployment's runtime principal (e.g. `runtime@sovereign-llm-gateway.fps4.nl`) that the resource
  // server (maestro) resolves against its register. Falls back to the client id when unset.
  subject?: string;
  // Extra, additive claims merged into a client-credentials token (US-0086) — e.g.
  // `{ role: 'product_runtime', email: 'runtime@…' }` so the resource server can match its principal.
  // Registered claims (`iss`/`aud`/`exp`/`sub`/…) are always set by the signer and cannot be overridden.
  claims?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

const oauthClientSchema = new mongoose.Schema<OAuthClientDocument>({
  _id: { type: String, required: true, default: () => randomUUID() },
  tenantId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  secretHash: { type: String, required: true },
  grantTypes: { type: [String], default: [] },
  redirectUris: { type: [String], default: [] },
  scopes: { type: [String], default: [] },
  isConfidential: { type: Boolean, default: true },
  audience: { type: String },
  subject: { type: String },
  claims: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

oauthClientSchema.index({ tenantId: 1, _id: 1 }, { unique: true });

export function getOAuthClientModel(connection: Connection): Model<OAuthClientDocument> {
  return (connection.models.OAuthClient as Model<OAuthClientDocument>) ??
    connection.model<OAuthClientDocument>('OAuthClient', oauthClientSchema, 'oauth_clients');
}

export const OAuthClient: Model<OAuthClientDocument> =
  (mongoose.models.OAuthClient as Model<OAuthClientDocument>) ??
  mongoose.model<OAuthClientDocument>('OAuthClient', oauthClientSchema, 'oauth_clients');
