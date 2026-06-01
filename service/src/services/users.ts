import { randomUUID } from 'crypto';
import type { Connection } from 'mongoose';
import { CONFIG } from '../config.js';
import { hashSecret } from '../utils/hash.js';
import type { ModelsBucket } from '../oauth/types.js';
import type { Logger } from '../utils/logger.js';
import type { TenantOAuthConfig } from '../models/tenant.js';

const GRANT_PASSWORD = 'password';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A user/registration failure with an HTTP status + machine code (mapped by the route). */
export class UserServiceError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = new.target.name;
  }
}

export interface UserServiceDependencies {
  getMasterConnection: () => Promise<Connection>;
  makeModels: (connection: Connection) => ModelsBucket;
  now?: () => Date;
  logger?: Logger;
}

export interface RegisterUserInput {
  tenantId: string;
  email: string;
  password: string;
}

export interface RegisteredUser {
  id: string;     // the stable subject id (token `sub`)
  email: string;
  tenantId: string;
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Validate a password against the configured policy. Throws `UserServiceError` (400) on failure. */
export function assertPasswordPolicy(password: string): void {
  const min = CONFIG.auth.password.minLength;
  if (typeof password !== 'string' || password.length < min) {
    throw new UserServiceError(`Password must be at least ${min} characters`, 400, 'weak_password');
  }
}

/**
 * Confirm a tenant permits local-credential user login (RQ-0002): active, OAuth enabled, the
 * `password` grant allowed, and the `local` IdP marked. Returns the tenant's OAuth config.
 */
export async function assertLocalIdpTenant(models: ModelsBucket, tenantId: string): Promise<TenantOAuthConfig> {
  const tenant = await models.Tenant.findOne({ _id: tenantId, status: 'active' }).lean().exec();
  if (!tenant) {
    throw new UserServiceError('Tenant inactive or missing', 404, 'tenant_not_found');
  }
  const oauthConfig = ((tenant as unknown as { oauth?: TenantOAuthConfig })?.oauth) ?? undefined;
  if (!oauthConfig?.enabled || !(oauthConfig.allowedGrantTypes ?? []).includes(GRANT_PASSWORD) || oauthConfig.idp?.provider !== 'local') {
    throw new UserServiceError('Local password login is not enabled for this tenant', 400, 'local_idp_disabled');
  }
  return oauthConfig;
}

export function createUserService(deps: UserServiceDependencies) {
  const nowFn = deps.now ?? (() => new Date());

  async function registerUser(input: RegisterUserInput): Promise<RegisteredUser> {
    const email = normalizeEmail(input.email ?? '');
    if (!EMAIL_RE.test(email)) {
      throw new UserServiceError('A valid email is required', 400, 'invalid_email');
    }
    assertPasswordPolicy(input.password);

    const connection = await deps.getMasterConnection();
    const models = deps.makeModels(connection);
    await assertLocalIdpTenant(models, input.tenantId);

    // Abuse guard on the public endpoint: cap registrations per tenant per minute.
    const windowStart = new Date(nowFn().getTime() - 60 * 1000);
    const recent = await models.User.countDocuments({ tenantId: input.tenantId, createdAt: { $gte: windowStart } }).exec();
    if (recent >= CONFIG.auth.password.registrationsPerMinute) {
      throw new UserServiceError('Too many registrations, retry shortly', 429, 'slow_down');
    }

    const existing = await models.User.findOne({ tenantId: input.tenantId, email }).lean().exec();
    if (existing) {
      throw new UserServiceError('An account with this email already exists', 409, 'email_taken');
    }

    const id = randomUUID();
    await models.User.create({
      _id: id,
      tenantId: input.tenantId,
      email,
      passwordHash: hashSecret(input.password),
      status: 'active',
      emailVerified: false,
      passwordUpdatedAt: nowFn()
    });

    deps.logger?.info?.({ tenantId: input.tenantId, userId: id }, 'registered local user');
    return { id, email, tenantId: input.tenantId };
  }

  return { registerUser };
}
