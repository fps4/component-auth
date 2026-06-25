import mongoose, { Connection, Document, Model } from 'mongoose';

export interface OAuthTokenDocument extends Document<string> {
  _id: string; // access token id (jti) or refresh token id
  tenantId: string;
  clientId: string;
  subject?: string;
  sessionId?: string;
  type: 'access' | 'refresh';
  scope: string[];
  expiresAt: Date;
  issuedAt: Date;
  refreshTokenId?: string;
  status: 'active' | 'revoked' | 'expired';
  hashedToken?: string; // for refresh tokens to avoid storing raw value
}

const oauthTokenSchema = new mongoose.Schema<OAuthTokenDocument>({
  _id: { type: String, required: true },
  tenantId: { type: String, required: true, index: true },
  clientId: { type: String, required: true, index: true },
  subject: { type: String },
  sessionId: { type: String },
  type: { type: String, enum: ['access', 'refresh'], required: true },
  scope: { type: [String], default: [] },
  expiresAt: { type: Date, required: true, index: true },
  issuedAt: { type: Date, required: true },
  refreshTokenId: { type: String },
  status: { type: String, enum: ['active', 'revoked', 'expired'], default: 'active', index: true },
  hashedToken: { type: String }
}, { timestamps: false });

oauthTokenSchema.index({ tenantId: 1, clientId: 1, status: 1 });
oauthTokenSchema.index({ tenantId: 1, type: 1, issuedAt: 1 });

export function getOAuthTokenModel(connection: Connection): Model<OAuthTokenDocument> {
  return (connection.models.OAuthToken as Model<OAuthTokenDocument>) ??
    connection.model<OAuthTokenDocument>('OAuthToken', oauthTokenSchema, 'oauth_tokens');
}

export const OAuthToken: Model<OAuthTokenDocument> =
  (mongoose.models.OAuthToken as Model<OAuthTokenDocument>) ??
  mongoose.model<OAuthTokenDocument>('OAuthToken', oauthTokenSchema, 'oauth_tokens');
