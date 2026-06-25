import type cors from 'cors';
import type { Request, Response, NextFunction } from 'express';
import { isTenantOriginAllowed, hasTenantOrigins } from './tenant-cors.js';

/** Marker on the Error a rejected CORS origin produces, so the error handler can map it to a 403. */
export const CORS_FORBIDDEN = 'cors_forbidden';

/** Dev-only: allow loopback / RFC-1918 private origins so local consumers work without per-tenant config. */
function isPrivateNetworkOriginAllowed(origin: string, isProd: boolean): boolean {
  if (isProd) return false;
  try {
    const { hostname } = new URL(origin);
    if (!hostname) return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return true;
    if (hostname.startsWith('10.')) return true;
    if (hostname.startsWith('192.168.')) return true;
    return /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  } catch {
    return false;
  }
}

/**
 * Build the CORS options for the service. A disallowed Origin is rejected via a TAGGED error
 * ({@link CORS_FORBIDDEN}); pair this with {@link corsErrorHandler} so the rejection becomes a clean
 * 403 JSON instead of Express's default 500 HTML. A request with no Origin (non-browser callers) is
 * always allowed — CORS is browser-enforced, not an auth gate.
 */
export function buildCorsOptions(opts: {
  allowedOrigins: Set<string>;
  isProd: boolean;
  methods: string[];
}): cors.CorsOptions {
  const { allowedOrigins, isProd, methods } = opts;
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin) || isTenantOriginAllowed(origin) || isPrivateNetworkOriginAllowed(origin, isProd)) {
        return callback(null, true);
      }
      // No allow-list configured at all → permissive (single-tenant / bootstrap).
      if (allowedOrigins.size === 0 && !hasTenantOrigins()) {
        return callback(null, true);
      }
      return callback(Object.assign(new Error('Origin not allowed by CORS'), { code: CORS_FORBIDDEN }));
    },
    methods,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 204
  };
}

/**
 * Express error handler that turns a {@link CORS_FORBIDDEN} rejection into a 403 JSON (OAuth-style),
 * rather than letting it fall through to Express's default 500 HTML. Other errors pass through.
 * Register it AFTER the routes.
 */
export function corsErrorHandler(
  err: (Error & { code?: string }) | undefined,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err && err.code === CORS_FORBIDDEN) {
    if (res.headersSent) return next(err);
    res.status(403).json({ error: 'origin_not_allowed', error_description: 'Origin not allowed' });
    return;
  }
  next(err);
}
