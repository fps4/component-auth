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
