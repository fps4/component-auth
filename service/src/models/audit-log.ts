import { randomUUID } from 'crypto';
import mongoose, { Connection, Document, Model } from 'mongoose';

/**
 * An append-only record of a management-plane action (ADR-0007). Every authenticated /admin call is
 * logged with the acting principal (the client-credentials `cid`/`sub`), the action, the target, and
 * the resulting HTTP status — the per-actor accountability ADR-0003 said a static shared secret could
 * not provide. Never updated or deleted in normal operation.
 */
export interface AuditLogDocument extends Document {
  _id: string;
  at: Date;
  principalClientId?: string;  // token `cid`
  principalSubject?: string;   // token `sub`
  principalTenantId?: string;  // token `tid`
  action: string;              // e.g. 'tenant.upsert', 'client.rotateSecret', 'user.create'
  method: string;
  path: string;
  targetType?: string;         // 'tenant' | 'client' | 'user' | 'key'
  targetId?: string;
  status: number;              // HTTP status the request resolved to
  meta?: Record<string, unknown>;
}

const auditLogSchema = new mongoose.Schema<AuditLogDocument>({
  _id: { type: String, required: true, default: () => randomUUID() },
  at: { type: Date, default: Date.now, index: true },
  principalClientId: { type: String, index: true },
  principalSubject: { type: String },
  principalTenantId: { type: String },
  action: { type: String, required: true },
  method: { type: String, required: true },
  path: { type: String, required: true },
  targetType: { type: String },
  targetId: { type: String },
  status: { type: Number, required: true },
  meta: { type: mongoose.Schema.Types.Mixed }
});

export function getAuditLogModel(connection: Connection): Model<AuditLogDocument> {
  return (connection.models.AuditLog as Model<AuditLogDocument>) ??
    connection.model<AuditLogDocument>('AuditLog', auditLogSchema, 'audit_logs');
}

export const AuditLog: Model<AuditLogDocument> =
  (mongoose.models.AuditLog as Model<AuditLogDocument>) ??
  mongoose.model<AuditLogDocument>('AuditLog', auditLogSchema, 'audit_logs');
