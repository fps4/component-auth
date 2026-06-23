// Wires the maestro managed-product SDK into this service: a self-minted runtime token + a periodic
// emit loop that ships the heartbeat (US-0070) and golden-signal telemetry (US-0076) rollup.
//
// identity-service is itself the IdP, so the runtime JWT is obtained by a `client_credentials` exchange
// against this service's OWN token endpoint (loopback) — no external bootstrap. The principal
// (`components-ds1`, aud=maestro-workspace, role=product_runtime, email=runtime@components.fps4.nl) is
// seeded from config/seed.yaml; maestro resolves that identity to the `components/ds1` deployment.
//
// The SDK degrades safely (queues + flush) when maestro is unreachable, and the whole loop stays INERT
// when MAESTRO_API_URL (or the runtime secret) is unset — so local dev, tests, and the CI build never
// phone home. We import the framework-agnostic core only (not the `/next` helper) and run a tiny timer.

import { MaestroProductClient } from '@fps4/maestro-sdk';
import { CONFIG } from '../config.js';
import logger from '../utils/logger.js';
import type { MetricsRecorder } from './metrics.js';

export interface TokenProviderOptions {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  /** Injectable fetch (tests). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable clock (tests). Defaults to `Date.now`. */
  now?: () => number;
  /** Re-mint this long before the token actually expires. Defaults to 60s. */
  skewMs?: number;
}

/**
 * A cached `client_credentials` token source. Returns the current access token, minting a fresh one
 * only when none is cached or the cached one is within `skewMs` of expiry. Throws if the mint fails so
 * the caller (the emit tick) logs and retries next interval.
 */
export function createRuntimeTokenProvider(opts: TokenProviderOptions): () => Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const skewMs = opts.skewMs ?? 60_000;
  let cached: { token: string; expiresAt: number } | null = null;

  return async () => {
    if (cached && now() < cached.expiresAt - skewMs) return cached.token;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: opts.clientId,
      client_secret: opts.clientSecret
    });
    const res = await doFetch(opts.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!res.ok) {
      throw new Error(`maestro runtime token mint failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    const ttlMs = (json.expires_in ?? 900) * 1000;
    cached = { token: json.access_token, expiresAt: now() + ttlMs };
    return cached.token;
  };
}

export interface MaestroTelemetryHandle {
  stop: () => void;
}

const INITIAL_DELAY_MS = 10_000;

/** Spread the fleet's emits: the interval ±10%. */
function nextDelay(intervalMs: number): number {
  const jitter = intervalMs * 0.1;
  return intervalMs - jitter + Math.random() * 2 * jitter;
}

/**
 * Start the heartbeat + telemetry emit loop against maestro. No-op (returns an inert handle) when the
 * channel is not configured. Call the returned `stop()` on shutdown. The loop never throws out — a bad
 * tick is logged and the next one is scheduled regardless.
 */
export function startMaestroTelemetry(recorder: MetricsRecorder): MaestroTelemetryHandle {
  const cfg = CONFIG.maestro;
  if (!cfg.apiUrl) {
    logger.info('maestro telemetry dormant — MAESTRO_API_URL unset');
    return { stop: () => {} };
  }
  if (!cfg.runtimeClientSecret) {
    logger.warn('maestro telemetry dormant — MAESTRO_RUNTIME_CLIENT_SECRET unset');
    return { stop: () => {} };
  }

  const tokenProvider = createRuntimeTokenProvider({
    tokenEndpoint: `http://127.0.0.1:${CONFIG.port}/oauth2/token`,
    clientId: cfg.runtimeClientId,
    clientSecret: cfg.runtimeClientSecret
  });

  const client = new MaestroProductClient({
    productId: cfg.productId,
    deploymentId: cfg.deploymentId,
    tokenProvider,
    baseUrl: cfg.apiUrl,
    contentBoundary: 'reference_only'
  });

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const snap = recorder.snapshot();
      await client.submitHeartbeat(snap.status, snap.heartbeat);
      await client.submitTelemetry(snap.status, snap.telemetry);
      await client.flush();
    } catch (err) {
      logger.warn({ err }, 'maestro telemetry tick failed');
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), nextDelay(cfg.emitIntervalMs));
    }
  };

  logger.info(
    { productId: cfg.productId, deploymentId: cfg.deploymentId, baseUrl: cfg.apiUrl },
    'maestro telemetry active'
  );
  timer = setTimeout(() => void tick(), Math.min(cfg.emitIntervalMs, INITIAL_DELAY_MS));

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}
