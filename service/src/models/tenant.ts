import { randomUUID } from 'crypto';
import mongoose, { Connection, Document, Model } from 'mongoose';

const { Schema } = mongoose;

export interface TenantOAuthLimits {
  tokensPerMinute?: number;
  refreshTokens?: number;
  clientCap?: number;
}

export interface TenantOAuthConfig {
  enabled?: boolean;
  allowedGrantTypes?: string[];
  allowedScopes?: string[];
  limits?: TenantOAuthLimits;
}

export interface TenantDocument extends Document {
  _id: string;
  name: string;
  status: 'active' | 'suspended' | 'trial' | 'deleted';
  planId?: string;
  region?: string;
  allowedOrigins?: string[];
  cookieDomain?: string;
  jwtAudience?: string;
  jwtIssuer?: string;
  oauth?: TenantOAuthConfig | null;
  settings?: Record<string, unknown> | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const oauthLimitsSchema = new Schema<TenantOAuthLimits>({
  tokensPerMinute: { type: Number },
  refreshTokens: { type: Number },
  clientCap: { type: Number }
}, { _id: false });

const oauthConfigSchema = new Schema<TenantOAuthConfig>({
  enabled: { type: Boolean, default: false },
  allowedGrantTypes: { type: [String], default: [] },
  allowedScopes: { type: [String], default: [] },
  limits: { type: oauthLimitsSchema, default: undefined }
}, { _id: false });

const tenantSchema = new Schema<TenantDocument>({
  _id: { type: String, required: true, default: () => randomUUID() },
  name: { type: String, required: true, maxlength: 256 },
  status: { type: String, enum: ['active', 'suspended', 'trial', 'deleted'], default: 'active' },
  planId: { type: String },
  region: { type: String, default: 'eu' },
  allowedOrigins: { type: [String], default: [] },
  cookieDomain: { type: String },
  jwtAudience: { type: String },
  jwtIssuer: { type: String },
  oauth: { type: oauthConfigSchema, default: undefined },
  settings: { type: Schema.Types.Mixed, default: undefined },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

tenantSchema.index({ status: 1 });

export function getTenantModel(connection: Connection): Model<TenantDocument> {
  return (connection.models.Tenant as Model<TenantDocument>) ??
    connection.model<TenantDocument>('Tenant', tenantSchema);
}

export const Tenant: Model<TenantDocument> =
  (mongoose.models.Tenant as Model<TenantDocument>) ??
  mongoose.model<TenantDocument>('Tenant', tenantSchema);
