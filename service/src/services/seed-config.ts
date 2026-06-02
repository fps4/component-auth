// Parse + validate a seed config (RQ-0004): a gitignored file listing tenants, their OAuth clients,
// and local users for operator-run, idempotent provisioning. Pure (no I/O) so it is unit-testable;
// the loader script (`scripts/seed.ts`) handles YAML reading and the Mongo upserts.

const GRANTS_NEEDING_AUDIENCE = new Set(['password', 'authorization_code']);

export interface SeedClient {
  id: string;
  name?: string;
  grantTypes: string[];
  audience?: string;
  redirectUris?: string[];
  scopes?: string[];
  isConfidential?: boolean;
  secret?: string;
}

export interface SeedUser {
  email: string;
  password: string;
  status?: 'active' | 'locked' | 'disabled';
  roles?: string[];
}

export interface SeedTenantOAuth {
  enabled: boolean;
  allowedGrantTypes: string[];
  allowedScopes?: string[];
  allowedRoles?: string[];
  idp?: { provider: 'google' | 'local' };
  limits?: { tokensPerMinute?: number; refreshTokens?: number; clientCap?: number };
}

export interface SeedTenant {
  id: string;
  name: string;
  status?: string;
  allowedOrigins?: string[];
  oauth: SeedTenantOAuth;
  clients?: SeedClient[];
  users?: SeedUser[];
}

export interface SeedConfig {
  tenants: SeedTenant[];
}

export class SeedConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedConfigError';
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Replace any string that is exactly `${VAR}` with `env[VAR]` (so secrets need not live in the file).
 * Throws if a referenced variable is unset. Non-`${...}` strings pass through unchanged.
 */
function interpolate(value: string, env: Record<string, string | undefined>): string {
  const match = /^\$\{([A-Z0-9_]+)\}$/.exec(value);
  if (!match) return value;
  const resolved = env[match[1]];
  if (resolved === undefined || resolved === '') {
    throw new SeedConfigError(`Seed config references env var ${match[1]} which is unset`);
  }
  return resolved;
}

/**
 * Validate raw (already YAML/JSON-parsed) seed data into a typed `SeedConfig`, resolving `${ENV}`
 * references in client secrets and user passwords. Throws `SeedConfigError` with a precise message
 * on any structural problem.
 */
export function parseSeedConfig(raw: unknown, env: Record<string, string | undefined> = {}): SeedConfig {
  if (!isObject(raw) || !Array.isArray(raw.tenants) || raw.tenants.length === 0) {
    throw new SeedConfigError('Seed config must have a non-empty `tenants` array');
  }

  const tenants: SeedTenant[] = raw.tenants.map((t, ti) => {
    const where = `tenants[${ti}]`;
    if (!isObject(t) || typeof t.id !== 'string' || !t.id) throw new SeedConfigError(`${where}.id is required`);
    if (typeof t.name !== 'string' || !t.name) throw new SeedConfigError(`${where} (${t.id}) needs a name`);
    if (!isObject(t.oauth) || typeof t.oauth.enabled !== 'boolean' || !Array.isArray(t.oauth.allowedGrantTypes)) {
      throw new SeedConfigError(`${where} (${t.id}) needs oauth.enabled and oauth.allowedGrantTypes`);
    }
    const grants = new Set(t.oauth.allowedGrantTypes as string[]);
    const idpProvider = isObject(t.oauth.idp) ? t.oauth.idp.provider : undefined;
    const allowedRoles = Array.isArray(t.oauth.allowedRoles) ? (t.oauth.allowedRoles as string[]) : [];
    const roleAllowlist = allowedRoles.length ? new Set(allowedRoles) : null;

    const clients: SeedClient[] = Array.isArray(t.clients) ? t.clients.map((c, ci) => {
      const cw = `${where}.clients[${ci}]`;
      if (!isObject(c) || typeof c.id !== 'string' || !c.id) throw new SeedConfigError(`${cw}.id is required`);
      if (!Array.isArray(c.grantTypes) || c.grantTypes.length === 0) throw new SeedConfigError(`${cw} (${c.id}) needs grantTypes`);
      const cg = c.grantTypes as string[];
      if (cg.some((g) => GRANTS_NEEDING_AUDIENCE.has(g)) && !c.audience) {
        throw new SeedConfigError(`${cw} (${c.id}) needs an audience for the ${cg.join('/')} grant(s)`);
      }
      return {
        id: c.id,
        name: typeof c.name === 'string' ? c.name : c.id,
        grantTypes: cg,
        audience: typeof c.audience === 'string' ? c.audience : undefined,
        redirectUris: Array.isArray(c.redirectUris) ? (c.redirectUris as string[]) : [],
        scopes: Array.isArray(c.scopes) ? (c.scopes as string[]) : [],
        isConfidential: typeof c.isConfidential === 'boolean' ? c.isConfidential : false,
        secret: typeof c.secret === 'string' ? interpolate(c.secret, env) : undefined
      };
    }) : [];

    const users: SeedUser[] = Array.isArray(t.users) ? t.users.map((u, ui) => {
      const uw = `${where}.users[${ui}]`;
      if (!isObject(u) || typeof u.email !== 'string' || !EMAIL_RE.test(u.email)) throw new SeedConfigError(`${uw} needs a valid email`);
      if (typeof u.password !== 'string' || !u.password) throw new SeedConfigError(`${uw} (${u.email}) needs a password`);
      const password = interpolate(u.password, env);
      if (!password) throw new SeedConfigError(`${uw} (${u.email}) resolved to an empty password`);
      const roles = Array.isArray(u.roles) ? (u.roles as unknown[]).map(String) : [];
      if (roleAllowlist) {
        for (const role of roles) {
          if (!roleAllowlist.has(role)) {
            throw new SeedConfigError(`${uw} (${u.email}) has role "${role}" not in tenant ${t.id} oauth.allowedRoles`);
          }
        }
      }
      return { email: u.email.trim().toLowerCase(), password, status: (u.status as SeedUser['status']) ?? 'active', roles };
    }) : [];

    if (users.length && (!grants.has('password') || idpProvider !== 'local')) {
      throw new SeedConfigError(`${where} (${t.id}) lists users but does not enable the local IdP (oauth.idp.provider: local + the password grant)`);
    }

    return {
      id: t.id,
      name: t.name,
      status: typeof t.status === 'string' ? t.status : 'active',
      allowedOrigins: Array.isArray(t.allowedOrigins) ? (t.allowedOrigins as string[]) : [],
      oauth: {
        enabled: t.oauth.enabled,
        allowedGrantTypes: t.oauth.allowedGrantTypes as string[],
        allowedScopes: Array.isArray(t.oauth.allowedScopes) ? (t.oauth.allowedScopes as string[]) : [],
        allowedRoles,
        idp: idpProvider ? { provider: idpProvider as 'google' | 'local' } : undefined,
        limits: isObject(t.oauth.limits) ? (t.oauth.limits as SeedTenantOAuth['limits']) : undefined
      },
      clients,
      users
    };
  });

  return { tenants };
}
