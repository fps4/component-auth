import mongoose, { Connection, Document, Model } from 'mongoose';
import { getTenantModel } from './tenant.js';

export interface SessionDocument extends Document<string> {
  _id: string;
  tenantId: string;
  visitorId?: string | null;
  contactId?: string | null;
  context?: Record<string, unknown> | null;
  status: 'active' | 'revoked';
  expiresAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const sessionSchema = new mongoose.Schema<SessionDocument>(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, required: true, ref: 'Tenant', index: true },
    visitorId: { type: String, default: null },
    contactId: { type: String, default: null },
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['active', 'revoked'], default: 'active', index: true },
    expiresAt: { type: Date, required: true, index: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

sessionSchema.virtual('tenant', {
  ref: 'Tenant',
  localField: 'tenantId',
  foreignField: '_id',
  justOne: true
});

export function getSessionModel(connection: Connection): Model<SessionDocument> {
  getTenantModel(connection);
  return (connection.models.Session as Model<SessionDocument>) ??
    connection.model<SessionDocument>('Session', sessionSchema);
}

export const Session: Model<SessionDocument> =
  (mongoose.models.Session as Model<SessionDocument>) ??
  mongoose.model<SessionDocument>('Session', sessionSchema);
