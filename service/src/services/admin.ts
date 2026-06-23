import { randomUUID, randomBytes } from 'crypto';
import type { Connection } from 'mongoose';
import { hashSecret } from '../utils/hash.js';
import { rotateSigningKey, listPublicKeys } from '../utils/key-store.js';
import type { ModelsBucket } from '../oauth/types.js';
import type { Logger } from '../utils/logger.js';
import type { TenantOAuthConfig } from '../models/tenant.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A management failure with an HTTP status + machine code (mapped by the route / MCP adapter). */
export class AdminServiceError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = new.target.name;
  }
}

export interface AdminServiceDependencies {
  getMasterConnection: () => Promise<Connection>;
  makeModels: (connection: Connection) => ModelsBucket;
  now?: () => Date;
  logger?: Logger;
}

export interface UpsertTenantInput {
  id?: string;
  name: string;
  status?: 'active' | 'suspended' | 'trial' | 'deleted';
  oauth?: TenantOAuthConfig;
  allowedOrigins?: string[];
}

export interface CreateClientInput {
  tenantId: string;
  name: string;
  grantTypes: string[];
  scopes?: string[];
  redirectUris?: string[];
  audience?: string;
  subject?: string;
  isConfidential?: boolean;
}

export interface CreateUserInput {
  tenantId: string;
  email: string;
  password: string;
  roles?: string[];
}

function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function createAdminService(deps: AdminServiceDependencies) {
  const nowFn = deps.now ?? (() => new Date());
  const models = async (): Promise<ModelsBucket> => deps.makeModels(await deps.getMasterConnection());

  // --- Tenants ---

  async function listTenants() {
    const m = await models();
    return m.Tenant.find().lean().exec();
  }

  async function getTenant(id: string) {
    const m = await models();
    const tenant = await m.Tenant.findById(id).lean().exec();
    if (!tenant) throw new AdminServiceError('Tenant not found', 404, 'tenant_not_found');
    return tenant;
  }

  /** Onboard or update a tenant (idempotent upsert — same convergence the seed loader uses). */
  async function upsertTenant(input: UpsertTenantInput) {
    if (!input.name?.trim()) throw new AdminServiceError('name is required', 400, 'invalid_input');
    const m = await models();
    const id = input.id ?? randomUUID();
    const set: Record<string, unknown> = { name: input.name, updatedAt: nowFn() };
    if (input.status) set.status = input.status;
    if (input.oauth) set.oauth = input.oauth;
    if (input.allowedOrigins) set.allowedOrigins = input.allowedOrigins;
    const tenant = await m.Tenant.findByIdAndUpdate(
      id,
      { $set: set, $setOnInsert: { _id: id, createdAt: nowFn() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean().exec();
    deps.logger?.info?.({ tenantId: id }, 'admin upserted tenant');
    return tenant;
  }

  // --- Clients ---

  async function listClients(tenantId: string) {
    const m = await models();
    // Never expose secretHash.
    return m.OAuthClient.find({ tenantId }).select('-secretHash').lean().exec();
  }

  /** Register a client. Returns the generated secret ONCE (only its hash is stored). */
  async function createClient(input: CreateClientInput): Promise<{ clientId: string; secret: string }> {
    if (!input.tenantId) throw new AdminServiceError('tenantId is required', 400, 'invalid_input');
    if (!input.name?.trim()) throw new AdminServiceError('name is required', 400, 'invalid_input');
    if (!Array.isArray(input.grantTypes) || input.grantTypes.length === 0) {
      throw new AdminServiceError('grantTypes must be a non-empty array', 400, 'invalid_input');
    }
    const m = await models();
    const tenant = await m.Tenant.findById(input.tenantId).lean().exec();
    if (!tenant) throw new AdminServiceError('Tenant not found', 404, 'tenant_not_found');

    const clientId = randomUUID();
    const secret = newSecret();
    await m.OAuthClient.create({
      _id: clientId,
      tenantId: input.tenantId,
      name: input.name,
      secretHash: hashSecret(secret),
      grantTypes: input.grantTypes,
      scopes: input.scopes ?? [],
      redirectUris: input.redirectUris ?? [],
      audience: input.audience,
      subject: input.subject,
      isConfidential: input.isConfidential ?? true
    });
    deps.logger?.info?.({ tenantId: input.tenantId, clientId }, 'admin created client');
    return { clientId, secret };
  }

  /** Rotate a client secret. Returns the new secret ONCE. */
  async function rotateClientSecret(clientId: string): Promise<{ clientId: string; secret: string }> {
    const m = await models();
    const secret = newSecret();
    const updated = await m.OAuthClient.findByIdAndUpdate(
      clientId,
      { $set: { secretHash: hashSecret(secret), updatedAt: nowFn() } },
      { new: true }
    ).lean().exec();
    if (!updated) throw new AdminServiceError('Client not found', 404, 'client_not_found');
    deps.logger?.info?.({ clientId }, 'admin rotated client secret');
    return { clientId, secret };
  }

  // --- Users (local-credential IdP) ---

  async function createUser(input: CreateUserInput): Promise<{ id: string; email: string; tenantId: string }> {
    const email = (input.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AdminServiceError('A valid email is required', 400, 'invalid_email');
    if (!input.password || input.password.length < 1) throw new AdminServiceError('password is required', 400, 'invalid_input');
    const m = await models();
    const tenant = await m.Tenant.findById(input.tenantId).lean().exec();
    if (!tenant) throw new AdminServiceError('Tenant not found', 404, 'tenant_not_found');

    const existing = await m.User.findOne({ tenantId: input.tenantId, email }).lean().exec();
    if (existing) throw new AdminServiceError('An account with this email already exists', 409, 'email_taken');

    const id = randomUUID();
    await m.User.create({
      _id: id,
      tenantId: input.tenantId,
      email,
      passwordHash: hashSecret(input.password),
      status: 'active',
      emailVerified: false,
      roles: input.roles ?? [],
      passwordUpdatedAt: nowFn()
    });
    deps.logger?.info?.({ tenantId: input.tenantId, userId: id }, 'admin created user');
    return { id, email, tenantId: input.tenantId };
  }

  async function resetUserPassword(tenantId: string, email: string, password: string): Promise<void> {
    if (!password) throw new AdminServiceError('password is required', 400, 'invalid_input');
    const m = await models();
    const result = await m.User.updateOne(
      { tenantId, email: email.trim().toLowerCase() },
      { $set: { passwordHash: hashSecret(password), passwordUpdatedAt: nowFn(), failedAttempts: 0, lockedUntil: null, updatedAt: nowFn() } }
    ).exec();
    if (result.matchedCount === 0) throw new AdminServiceError('User not found', 404, 'user_not_found');
    deps.logger?.info?.({ tenantId, email }, 'admin reset user password');
  }

  async function setUserStatus(tenantId: string, email: string, status: 'active' | 'disabled'): Promise<void> {
    const m = await models();
    const result = await m.User.updateOne(
      { tenantId, email: email.trim().toLowerCase() },
      { $set: { status, updatedAt: nowFn() } }
    ).exec();
    if (result.matchedCount === 0) throw new AdminServiceError('User not found', 404, 'user_not_found');
    deps.logger?.info?.({ tenantId, email, status }, 'admin set user status');
  }

  /** Clear a brute-force lockout (and reactivate if locked). */
  async function unlockUser(tenantId: string, email: string): Promise<void> {
    const m = await models();
    const result = await m.User.updateOne(
      { tenantId, email: email.trim().toLowerCase() },
      { $set: { failedAttempts: 0, lockedUntil: null, status: 'active', updatedAt: nowFn() } }
    ).exec();
    if (result.matchedCount === 0) throw new AdminServiceError('User not found', 404, 'user_not_found');
    deps.logger?.info?.({ tenantId, email }, 'admin unlocked user');
  }

  // --- Signing keys ---

  async function rotateKey() {
    const key = await rotateSigningKey();
    deps.logger?.info?.({ kid: key.kid }, 'admin rotated signing key');
    return { kid: key.kid };
  }

  async function keyStatus() {
    return listPublicKeys();
  }

  // --- Statistics (feeds the console dashboards) ---

  async function getStats() {
    const m = await models();
    const now = nowFn();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      tenants, activeTenants, clients, users, lockedUsers, disabledUsers,
      tokensLastHour, tokensLastDay, activeRefresh, activeKeys
    ] = await Promise.all([
      m.Tenant.countDocuments({}).exec(),
      m.Tenant.countDocuments({ status: 'active' }).exec(),
      m.OAuthClient.countDocuments({}).exec(),
      m.User.countDocuments({}).exec(),
      m.User.countDocuments({ lockedUntil: { $gt: now } }).exec(),
      m.User.countDocuments({ status: 'disabled' }).exec(),
      m.OAuthToken.countDocuments({ type: 'access', issuedAt: { $gte: hourAgo } }).exec(),
      m.OAuthToken.countDocuments({ type: 'access', issuedAt: { $gte: dayAgo } }).exec(),
      m.OAuthToken.countDocuments({ type: 'refresh', status: 'active' }).exec(),
      m.KeyStore.countDocuments({ status: 'active' }).exec()
    ]);

    return {
      tenants: { total: tenants, active: activeTenants },
      clients: { total: clients },
      users: { total: users, locked: lockedUsers, disabled: disabledUsers },
      tokens: { accessLastHour: tokensLastHour, accessLastDay: tokensLastDay, activeRefresh },
      keys: { active: activeKeys },
      at: now.toISOString()
    };
  }

  return {
    listTenants, getTenant, upsertTenant,
    listClients, createClient, rotateClientSecret,
    createUser, resetUserPassword, setUserStatus, unlockUser,
    rotateKey, keyStatus, getStats
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
