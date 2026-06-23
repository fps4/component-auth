import express from 'express';
import cors from 'cors';
import { Server } from 'http';
import { CONFIG } from './config.js';
import { getMasterConnection, disconnect, masterConnectionReadyState } from './utils/db.js';
import logger from './utils/logger.js';
import { MetricsRecorder } from './maestro/metrics.js';
import { startMaestroTelemetry } from './maestro/telemetry.js';
import sessionRoutes from './routes/session-routes.js';
import oauthRoutes from './routes/oauth-routes.js';
import adminRoutes from './routes/admin-routes.js';
import {
  refreshTenantOrigins,
  scheduleTenantCorsRefresh,
  hasTenantOrigins,
  isTenantOriginAllowed
} from './utils/tenant-cors.js';
import { listPublicKeys, ensureActiveSigningKey } from './utils/key-store.js';

async function bootstrap() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: '512kb' }));

  const isProd = CONFIG.environment === 'production';
  const staticOrigins = new Set(CONFIG.cors.staticOrigins);
  const devOrigins = isProd
    ? []
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:8080',
        'http://127.0.0.1:8080'
      ];
  const allowedOrigins = new Set([...staticOrigins, ...devOrigins]);

  const isPrivateNetworkOriginAllowed = (origin: string): boolean => {
    if (isProd) return false;
    try {
      const { hostname } = new URL(origin);
      if (!hostname) return false;
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
        return true;
      }
      if (hostname.startsWith('10.')) return true;
      if (hostname.startsWith('192.168.')) return true;
      return /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    } catch {
      return false;
    }
  };

  await refreshTenantOrigins();
  scheduleTenantCorsRefresh(CONFIG.corsRefreshIntervalMs);

  const corsOptions: cors.CorsOptions = {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin) || isTenantOriginAllowed(origin) || isPrivateNetworkOriginAllowed(origin)) {
        return callback(null, true);
      }
      if (allowedOrigins.size === 0 && !hasTenantOrigins()) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    methods: Array.from(CONFIG.cors.allowedMethods),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 204
  };

  app.use(cors(corsOptions));

  // Time every request into a rolling window for the maestro golden-signal rollup (inert by itself —
  // it only records; the telemetry loop below reads it). Window = the emit cadence.
  const metrics = new MetricsRecorder({
    windowMs: CONFIG.maestro.emitIntervalMs,
    dependencyHealthy: () => masterConnectionReadyState() === 1
  });
  app.use(metrics.middleware);

  await getMasterConnection();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/.well-known/jwks.json', async (_req, res) => {
    await ensureActiveSigningKey();
    const keys = await listPublicKeys();
    res.json({ keys });
  });

  app.use('/oauth2', oauthRoutes);
  app.use('/v1', sessionRoutes);

  // Management plane (ADR-0007): authenticated admin API. Every route is guarded by an admin-scoped
  // client-credentials token and writes an append-only audit entry. Disable per-deployment with
  // ADMIN_API_ENABLED=false; on ds1 it must be bound off the public tunnel (network-restricted).
  if (CONFIG.admin.enabled) {
    app.use(CONFIG.admin.basePath, adminRoutes);
    logger.info({ basePath: CONFIG.admin.basePath }, 'management API enabled');
  }

  let server: Server;

  server = app.listen(CONFIG.port, () => {
    logger.info({ port: CONFIG.port }, 'identity-service is running');
  });

  // Start reporting liveness + golden signals to maestro (no-op unless MAESTRO_API_URL is set).
  const telemetry = startMaestroTelemetry(metrics);

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'shutting down');
    telemetry.stop();
    server.close(async (err) => {
      if (err) {
        logger.error({ err }, 'error while closing server');
        process.exit(1);
        return;
      }
      await disconnect();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((error) => {
  logger.error({ err: error }, 'failed to start identity-service');
  process.exit(1);
});
