import type { Request, Response, NextFunction } from 'express';
import { jwtVerify, createLocalJWKSet, type JWTVerifyGetKey } from 'jose';
import { CONFIG } from '../config.js';
import { listPublicKeys } from '../utils/key-store.js';
import logger from '../utils/logger.js';

/**
 * Admin-auth layer (ADR-0007). Management principals authenticate exactly like any machine client —
 * a `client_credentials` token from this service — but their token must carry an admin scope. We
 * verify the bearer JWT against this service's OWN JWKS (the same keys `/.well-known/jwks.json`
 * publishes), confirm it is a client-credentials token (`cid` present), and require the configured
 * `admin` scope (or a granular `admin:<area>` scope for least-privilege agents). The verified
 * principal is attached to the request for the route + audit layers.
 */
export interface AdminPrincipal {
  clientId: string;       // token `cid`
  subject?: string;       // token `sub`
  tenantId?: string;      // token `tid`
  scopes: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminPrincipal;
    }
  }
}

// Cache the local JWKS; refresh on a kid-miss so a key rotation is picked up without a restart.
let cachedJwks: JWTVerifyGetKey | null = null;
let cachedAt = 0;
const JWKS_TTL_MS = 60_000;

async function getJwks(forceRefresh = false): Promise<JWTVerifyGetKey> {
  const fresh = Date.now() - cachedAt < JWKS_TTL_MS;
  if (cachedJwks && fresh && !forceRefresh) return cachedJwks;
  const keys = await listPublicKeys();
  cachedJwks = createLocalJWKSet({ keys: keys as unknown as Parameters<typeof createLocalJWKSet>[0]['keys'] });
  cachedAt = Date.now();
  return cachedJwks;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

function parseScopes(claim: unknown): string[] {
  if (typeof claim === 'string') return claim.split(' ').filter(Boolean);
  if (Array.isArray(claim)) return claim.filter((s): s is string => typeof s === 'string');
  return [];
}

/** True if the token's scopes satisfy the route — the superscope `admin`, or the specific area scope. */
export function scopesSatisfy(tokenScopes: string[], required: string): boolean {
  const set = new Set(tokenScopes);
  return set.has(CONFIG.admin.requiredScope) || set.has(required);
}

/** True if a verified principal may act on the given area scope. */
export function principalHasScope(principal: AdminPrincipal, areaScope: string): boolean {
  return scopesSatisfy(principal.scopes, areaScope);
}

export class AdminTokenError extends Error {
  constructor(message: string, public readonly reason: 'unauthorized' | 'forbidden') {
    super(message);
    this.name = 'AdminTokenError';
  }
}

/**
 * Verify a bearer admin token against this service's JWKS and return the principal. Shared by both
 * management transports — the Express middleware (HTTP API) and the MCP server — so they enforce one
 * authorization model. Throws {@link AdminTokenError} for an invalid token or a non-machine token.
 */
export async function verifyAdminToken(token: string): Promise<AdminPrincipal> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, await getJwks(), { issuer: CONFIG.auth.jwtIssuer }));
  } catch {
    // A key may have rotated since we cached the JWKS — refresh once and retry.
    try {
      ({ payload } = await jwtVerify(token, await getJwks(true), { issuer: CONFIG.auth.jwtIssuer }));
    } catch (err) {
      logger.warn({ err }, 'admin token verification failed');
      throw new AdminTokenError('Invalid or expired admin token', 'unauthorized');
    }
  }
  const cid = typeof payload.cid === 'string' ? payload.cid : undefined;
  if (!cid) {
    throw new AdminTokenError('Not a machine (client-credentials) token', 'forbidden');
  }
  return {
    clientId: cid,
    subject: typeof payload.sub === 'string' ? payload.sub : undefined,
    tenantId: typeof payload.tid === 'string' ? payload.tid : undefined,
    scopes: parseScopes((payload as Record<string, unknown>).scope)
  };
}

/**
 * Express middleware factory: require a valid admin token carrying `requiredScope` (the superscope) or
 * the supplied area scope (e.g. `admin:tenants`). Returns 401 for a missing/invalid token, 403 for a
 * valid token without sufficient scope.
 */
export function requireAdmin(areaScope: string) {
  return async function adminGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
    const token = bearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'unauthorized', error_description: 'Bearer admin token required' });
      return;
    }
    try {
      const principal = await verifyAdminToken(token);
      if (!principalHasScope(principal, areaScope)) {
        res.status(403).json({ error: 'forbidden', error_description: `Requires scope '${CONFIG.admin.requiredScope}' or '${areaScope}'` });
        return;
      }
      req.admin = principal;
      next();
    } catch (err) {
      if (err instanceof AdminTokenError) {
        const status = err.reason === 'forbidden' ? 403 : 401;
        res.status(status).json({ error: err.reason, error_description: err.message });
        return;
      }
      logger.warn({ err }, 'admin token verification failed');
      res.status(401).json({ error: 'unauthorized', error_description: 'Invalid or expired admin token' });
    }
  };
}

/** Admin scope constants for the route table. */
export const ADMIN_SCOPES = {
  tenants: 'admin:tenants',
  clients: 'admin:clients',
  users: 'admin:users',
  keys: 'admin:keys',
  stats: 'admin:stats'
} as const;
