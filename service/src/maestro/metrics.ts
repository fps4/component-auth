// Golden-signal collection for the maestro managed-product telemetry channel (US-0076). A tiny in-
// process recorder: an Express middleware times every request into a rolling window, and `snapshot()`
// rolls that window up into the floor-safe numbers the SDK sends (request_rate, error_rate, latency
// percentiles, an enum-keyed error map) plus liveness derived from the Mongo connection. No content,
// no per-request retention beyond the window — just bounded counters and durations.

import type { RequestHandler } from 'express';
import type { HeartbeatStats, ProductStatus, TelemetrySignals } from '@fps4/maestro-sdk';
import os from 'os';

interface Sample {
  t: number;
  durationMs: number;
  status: number;
}

export interface MetricsRecorderOptions {
  /** Rolling window the rollup covers, in ms. Defaults to 60s (the emit cadence). */
  windowMs?: number;
  /** Hard cap on retained samples so a traffic spike cannot grow memory unbounded. */
  maxSamples?: number;
  /** Injectable clock (tests). Defaults to `Date.now`. */
  now?: () => number;
  /** Whether the critical dependency (Mongo) is currently usable. Drives `down` status. */
  dependencyHealthy?: () => boolean;
  /** Injectable process-uptime seconds (tests). Defaults to `process.uptime`. */
  uptimeSeconds?: () => number;
}

/** What one emit tick reports: a self-assessed status plus the bounded heartbeat + telemetry numbers. */
export interface TelemetrySnapshot {
  status: ProductStatus;
  heartbeat: HeartbeatStats;
  telemetry: TelemetrySignals & { errors?: Record<string, number> };
}

/** error_rate at/above which we self-report `degraded` (with enough samples to be meaningful). */
const DEGRADED_ERROR_RATE = 0.5;
const MIN_SAMPLES_FOR_DEGRADED = 5;

export class MetricsRecorder {
  private readonly windowMs: number;
  private readonly maxSamples: number;
  private readonly now: () => number;
  private readonly dependencyHealthy: () => boolean;
  private readonly uptimeSeconds: () => number;
  private samples: Sample[] = [];

  constructor(opts: MetricsRecorderOptions = {}) {
    this.windowMs = opts.windowMs ?? 60_000;
    this.maxSamples = opts.maxSamples ?? 10_000;
    this.now = opts.now ?? Date.now;
    this.dependencyHealthy = opts.dependencyHealthy ?? (() => true);
    this.uptimeSeconds = opts.uptimeSeconds ?? (() => process.uptime());
  }

  /** Record one completed request. Public for tests; the middleware calls it on `res.finish`. */
  record(durationMs: number, status: number): void {
    this.samples.push({ t: this.now(), durationMs, status });
    this.prune();
  }

  /** Express middleware: stopwatch each request, recording its duration + final status code. */
  get middleware(): RequestHandler {
    return (_req, res, next) => {
      const start = this.now();
      res.on('finish', () => this.record(this.now() - start, res.statusCode));
      next();
    };
  }

  /** Drop samples older than the window and enforce the hard cap (oldest-first). */
  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    if (this.samples.length > 0 && this.samples[0].t < cutoff) {
      this.samples = this.samples.filter((s) => s.t >= cutoff);
    }
    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples.slice(this.samples.length - this.maxSamples);
    }
  }

  /** Roll the current window up into a status + heartbeat + telemetry snapshot for one emit tick. */
  snapshot(): TelemetrySnapshot {
    this.prune();
    const window = this.samples;
    const count = window.length;
    const windowSeconds = this.windowMs / 1000;

    let n4xx = 0;
    let n5xx = 0;
    for (const s of window) {
      if (s.status >= 500) n5xx += 1;
      else if (s.status >= 400) n4xx += 1;
    }

    const durations = window.map((s) => s.durationMs).sort((a, b) => a - b);
    const requestRate = round(count / windowSeconds, 4);
    const errorRate = count > 0 ? round(n5xx / count, 4) : 0;
    const uptime = Math.round(this.uptimeSeconds());
    const memoryPct = round((process.memoryUsage().rss / os.totalmem()) * 100, 2);

    const errors: Record<string, number> = {};
    if (n4xx > 0) errors['4xx'] = n4xx;
    if (n5xx > 0) errors['5xx'] = n5xx;

    const status = this.status(count, errorRate);

    const heartbeat: HeartbeatStats = {
      uptime_seconds: uptime,
      request_rate: requestRate,
      error_rate: errorRate,
      p95_latency_ms: percentile(durations, 0.95)
    };

    const telemetry: TelemetrySnapshot['telemetry'] = {
      window_seconds: windowSeconds,
      request_rate: requestRate,
      error_rate: errorRate,
      p50_latency_ms: percentile(durations, 0.5),
      p95_latency_ms: percentile(durations, 0.95),
      p99_latency_ms: percentile(durations, 0.99),
      memory_pct: memoryPct,
      uptime_seconds: uptime,
      ...(Object.keys(errors).length > 0 ? { errors } : {})
    };

    return { status, heartbeat, telemetry };
  }

  private status(count: number, errorRate: number): ProductStatus {
    if (!this.dependencyHealthy()) return 'down';
    if (count >= MIN_SAMPLES_FOR_DEGRADED && errorRate >= DEGRADED_ERROR_RATE) return 'degraded';
    return 'ok';
  }
}

/** Nearest-rank percentile of an ascending-sorted array. `undefined` for an empty window (omit it). */
function percentile(sortedAsc: number[], q: number): number | undefined {
  const n = sortedAsc.length;
  if (n === 0) return undefined;
  const rank = Math.ceil(q * n);
  const idx = Math.min(n - 1, Math.max(0, rank - 1));
  return sortedAsc[idx];
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
