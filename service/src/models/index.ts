import type { Connection, Model } from 'mongoose';
import { getTenantModel, Tenant, type TenantDocument } from './tenant.js';
import { getSessionModel, Session, type SessionDocument } from './session.js';
import { getOAuthClientModel, OAuthClient, type OAuthClientDocument } from './oauth-client.js';
import { getOAuthTokenModel, OAuthToken, type OAuthTokenDocument } from './oauth-token.js';
import { getOAuthAuthorizationModel, OAuthAuthorization, type OAuthAuthorizationDocument } from './oauth-authorization.js';
import { getUserModel, User, type UserDocument } from './user.js';
import { getKeyStoreModel, KeyStore, type KeyStoreDocument } from './key-store.js';
import { getAuditLogModel, AuditLog, type AuditLogDocument } from './audit-log.js';

export const makeModels = (connection: Connection) => ({
  Tenant: getTenantModel(connection) as Model<TenantDocument>,
  Session: getSessionModel(connection) as Model<SessionDocument>,
  OAuthClient: getOAuthClientModel(connection) as Model<OAuthClientDocument>,
  OAuthToken: getOAuthTokenModel(connection) as Model<OAuthTokenDocument>,
  OAuthAuthorization: getOAuthAuthorizationModel(connection) as Model<OAuthAuthorizationDocument>,
  User: getUserModel(connection) as Model<UserDocument>,
  KeyStore: getKeyStoreModel(connection) as Model<KeyStoreDocument>,
  AuditLog: getAuditLogModel(connection) as Model<AuditLogDocument>
});

export { Tenant, type TenantDocument } from './tenant.js';
export { Session, type SessionDocument } from './session.js';
export { OAuthClient, type OAuthClientDocument } from './oauth-client.js';
export { OAuthToken, type OAuthTokenDocument } from './oauth-token.js';
export { OAuthAuthorization, type OAuthAuthorizationDocument } from './oauth-authorization.js';
export { User, type UserDocument } from './user.js';
export { KeyStore, type KeyStoreDocument } from './key-store.js';
export { AuditLog, type AuditLogDocument } from './audit-log.js';
