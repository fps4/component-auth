import { randomUUID } from 'crypto';
import mongoose, { Connection, Document, Model } from 'mongoose';

const { Schema } = mongoose;

export interface TenantOAuthLimits {
  tokensPerMinute?: number;
  refreshTokens?: number;
  clientCap?: number;
}

export interface TenantIdpConfig {
  // Identity provider(s) this tenant uses for user login. `google` federates Google SSO (RQ-0001,
  // app secrets in env); `local` is component-auth's own email + password IdP (RQ-0002). Declarative
  // marker — the effective gate is which grant types the tenant allows (authorization_code / password).
  provider: 'google' | 'local';
}

export interface TenantOAuthConfig {
  enabled?: boolean;
  allowedGrantTypes?: string[];
  allowedScopes?: string[];
  limits?: TenantOAuthLimits;
  idp?: TenantIdpConfig | null;
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

const idpConfigSchema = new Schema<TenantIdpConfig>({
  provider: { type: String, enum: ['google', 'local'], required: true }
}, { _id: false });

const oauthConfigSchema = new Schema<TenantOAuthConfig>({
  enabled: { type: Boolean, default: false },
  allowedGrantTypes: { type: [String], default: [] },
  allowedScopes: { type: [String], default: [] },
  limits: { type: oauthLimitsSchema, default: undefined },
  idp: { type: idpConfigSchema, default: undefined }
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
