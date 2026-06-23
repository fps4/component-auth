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
function scopesSatisfy(tokenScopes: string[], required: string): boolean {
  const set = new Set(tokenScopes);
  return set.has(CONFIG.admin.requiredScope) || set.has(required);
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
      let payload;
      try {
        ({ payload } = await jwtVerify(token, await getJwks(), { issuer: CONFIG.auth.jwtIssuer }));
      } catch (err) {
        // Possibly a key rotated since we cached the JWKS — refresh once and retry before failing.
        ({ payload } = await jwtVerify(token, await getJwks(true), { issuer: CONFIG.auth.jwtIssuer }));
      }

      const cid = typeof payload.cid === 'string' ? payload.cid : undefined;
      if (!cid) {
        // A user token (no `cid`) must never reach the management plane.
        res.status(403).json({ error: 'forbidden', error_description: 'Not a machine (client-credentials) token' });
        return;
      }

      const scopes = parseScopes((payload as Record<string, unknown>).scope);
      if (!scopesSatisfy(scopes, areaScope)) {
        res.status(403).json({ error: 'forbidden', error_description: `Requires scope '${CONFIG.admin.requiredScope}' or '${areaScope}'` });
        return;
      }

      req.admin = {
        clientId: cid,
        subject: typeof payload.sub === 'string' ? payload.sub : undefined,
        tenantId: typeof payload.tid === 'string' ? payload.tid : undefined,
        scopes
      };
      next();
    } catch (err) {
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
