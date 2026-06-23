import { randomUUID } from 'crypto';
import mongoose, { Connection, Document, Model } from 'mongoose';

/**
 * A local-credential user (RQ-0002) — identity-service's own email + password IdP, an alternative to
 * Google SSO for tenants that opt into `idp.provider: 'local'`. Authentication issues the same RS256
 * user token (email + stable `sub`) that the Google flow does.
 *
 * `sub` is a stable, immutable id minted at creation (NOT the email), so the token subject survives
 * an email change — matching the identity contract maestro verifies. `passwordHash` uses the salted
 * scrypt scheme in `utils/hash.ts`; the raw password is never stored.
 */
export interface UserDocument extends Document {
  _id: string;              // stable subject id (becomes the token `sub`)
  tenantId: string;
  email: string;            // unique per tenant (stored lowercased)
  passwordHash: string;
  emailVerified: boolean;   // no verification channel yet (RQ-0002); informational
  status: 'active' | 'locked' | 'disabled';
  roles: string[];          // coarse, tenant-scoped roles stamped into the token `roles` claim (RQ-0005)
  failedAttempts: number;
  lockedUntil?: Date | null;
  passwordUpdatedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const userSchema = new mongoose.Schema<UserDocument>({
  _id: { type: String, required: true, default: () => randomUUID() },
  tenantId: { type: String, required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  emailVerified: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'locked', 'disabled'], default: 'active', index: true },
  roles: { type: [String], default: [] },
  failedAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  passwordUpdatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// One account per email within a tenant; the same email may exist under different tenants.
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });

export function getUserModel(connection: Connection): Model<UserDocument> {
  return (connection.models.User as Model<UserDocument>) ??
    connection.model<UserDocument>('User', userSchema, 'users');
}

export const User: Model<UserDocument> =
  (mongoose.models.User as Model<UserDocument>) ??
  mongoose.model<UserDocument>('User', userSchema, 'users');
