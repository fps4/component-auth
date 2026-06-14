import { describe, it, expect } from 'vitest';
import { MetricsRecorder } from '../src/maestro/metrics.js';

// A controllable clock so window pruning + rates are deterministic.
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('MetricsRecorder', () => {
  it('reports an all-clear snapshot for an empty window', () => {
    const r = new MetricsRecorder({ windowMs: 60_000, now: () => 1, uptimeSeconds: () => 42 });
    const snap = r.snapshot();
    expect(snap.status).toBe('ok');
    expect(snap.telemetry.request_rate).toBe(0);
    expect(snap.telemetry.error_rate).toBe(0);
    expect(snap.telemetry.errors).toBeUndefined();
    expect(snap.telemetry.p95_latency_ms).toBeUndefined();
    expect(snap.heartbeat.uptime_seconds).toBe(42);
  });

  it('rolls up rate, latency percentiles, and an enum-keyed error map', () => {
    const c = clock();
    const r = new MetricsRecorder({ windowMs: 60_000, now: c.now, uptimeSeconds: () => 100 });
    // 10 requests: durations 10..100; two 5xx, one 4xx, rest 200.
    const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const statuses = [200, 200, 200, 200, 200, 200, 200, 404, 500, 503];
    durations.forEach((d, i) => r.record(d, statuses[i]));

    const snap = r.snapshot();
    expect(snap.telemetry.request_rate).toBe(0.1667); // count / windowSeconds, rounded to 4dp
    expect(snap.telemetry.p50_latency_ms).toBe(50); // nearest-rank: ceil(.5*10)=5 -> idx4
    expect(snap.telemetry.p95_latency_ms).toBe(100); // ceil(.95*10)=10 -> idx9
    expect(snap.telemetry.p99_latency_ms).toBe(100);
    expect(snap.telemetry.error_rate).toBe(0.2); // 2 of 10 are 5xx
    expect(snap.telemetry.errors).toEqual({ '4xx': 1, '5xx': 2 });
    expect(snap.telemetry.window_seconds).toBe(60);
  });

  it('drops samples older than the window', () => {
    const c = clock();
    const r = new MetricsRecorder({ windowMs: 10_000, now: c.now });
    r.record(5, 200);
    r.record(5, 200);
    c.advance(11_000); // both now outside the 10s window
    r.record(5, 200); // one fresh sample
    const snap = r.snapshot();
    expect(snap.telemetry.request_rate).toBe(1 / 10); // only the fresh sample counts
  });

  it('self-reports down when the dependency is unhealthy', () => {
    const r = new MetricsRecorder({ dependencyHealthy: () => false });
    expect(r.snapshot().status).toBe('down');
  });

  it('self-reports degraded under a sustained high error rate', () => {
    const c = clock();
    const r = new MetricsRecorder({ windowMs: 60_000, now: c.now });
    for (let i = 0; i < 8; i += 1) r.record(5, 500); // all errors, enough samples
    expect(r.snapshot().status).toBe('degraded');
  });
});
