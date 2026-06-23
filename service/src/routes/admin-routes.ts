import express from 'express';
import type { Request, Response } from 'express';
import { adminService } from '../container.js';
import { requireAdmin, ADMIN_SCOPES } from '../core/admin-auth.js';
import { AdminServiceError } from '../services/admin.js';
import { getMasterConnection } from '../utils/db.js';
import { makeModels } from '../models/index.js';
import logger from '../utils/logger.js';

const router = express.Router();

/** Append-only audit write (ADR-0007). Fire-and-forget after the response so it never blocks a call. */
function audit(req: Request, res: Response, action: string, target?: { type?: string; id?: string }, meta?: Record<string, unknown>): void {
  res.on('finish', () => {
    void (async () => {
      try {
        const models = makeModels(await getMasterConnection());
        await models.AuditLog.create({
          at: new Date(),
          principalClientId: req.admin?.clientId,
          principalSubject: req.admin?.subject,
          principalTenantId: req.admin?.tenantId,
          action,
          method: req.method,
          path: req.originalUrl,
          targetType: target?.type,
          targetId: target?.id,
          status: res.statusCode,
          meta
        });
      } catch (err) {
        logger.error({ err, action }, 'failed to write audit log');
      }
    })();
  });
}

function handleError(res: Response, error: unknown): Response {
  if (error instanceof AdminServiceError) {
    return res.status(error.status).json({ error: error.code, error_description: error.message });
  }
  logger.error({ err: error }, 'admin route error');
  return res.status(500).json({ error: 'server_error', error_description: 'Internal Server Error' });
}

// --- Tenants ---

router.get('/tenants', requireAdmin(ADMIN_SCOPES.tenants), async (_req, res) => {
  try {
    res.json({ tenants: await adminService.listTenants() });
  } catch (e) { handleError(res, e); }
});

router.get('/tenants/:id', requireAdmin(ADMIN_SCOPES.tenants), async (req, res) => {
  try {
    res.json(await adminService.getTenant(req.params.id));
  } catch (e) { handleError(res, e); }
});

router.post('/tenants', requireAdmin(ADMIN_SCOPES.tenants), async (req, res) => {
  try {
    const tenant = await adminService.upsertTenant(req.body ?? {});
    audit(req, res, 'tenant.upsert', { type: 'tenant', id: (tenant as { _id?: string })?._id });
    res.status(200).json(tenant);
  } catch (e) { handleError(res, e); }
});

router.get('/tenants/:tenantId/clients', requireAdmin(ADMIN_SCOPES.clients), async (req, res) => {
  try {
    res.json({ clients: await adminService.listClients(req.params.tenantId) });
  } catch (e) { handleError(res, e); }
});

// --- Clients ---

router.post('/clients', requireAdmin(ADMIN_SCOPES.clients), async (req, res) => {
  try {
    const result = await adminService.createClient(req.body ?? {});
    audit(req, res, 'client.create', { type: 'client', id: result.clientId }, { tenantId: req.body?.tenantId });
    // The secret is returned ONCE — only its hash is persisted.
    res.status(201).json(result);
  } catch (e) { handleError(res, e); }
});

router.post('/clients/:id/rotate-secret', requireAdmin(ADMIN_SCOPES.clients), async (req, res) => {
  try {
    const result = await adminService.rotateClientSecret(req.params.id);
    audit(req, res, 'client.rotateSecret', { type: 'client', id: req.params.id });
    res.json(result);
  } catch (e) { handleError(res, e); }
});

// --- Users ---

router.post('/users', requireAdmin(ADMIN_SCOPES.users), async (req, res) => {
  try {
    const result = await adminService.createUser(req.body ?? {});
    audit(req, res, 'user.create', { type: 'user', id: result.id }, { tenantId: req.body?.tenantId });
    res.status(201).json(result);
  } catch (e) { handleError(res, e); }
});

router.post('/users/reset-password', requireAdmin(ADMIN_SCOPES.users), async (req, res) => {
  try {
    const { tenantId, email, password } = req.body ?? {};
    await adminService.resetUserPassword(tenantId, email, password);
    audit(req, res, 'user.resetPassword', { type: 'user', id: email }, { tenantId });
    res.json({ ok: true });
  } catch (e) { handleError(res, e); }
});

router.post('/users/status', requireAdmin(ADMIN_SCOPES.users), async (req, res) => {
  try {
    const { tenantId, email, status } = req.body ?? {};
    if (status !== 'active' && status !== 'disabled') {
      return res.status(400).json({ error: 'invalid_input', error_description: "status must be 'active' or 'disabled'" });
    }
    await adminService.setUserStatus(tenantId, email, status);
    audit(req, res, 'user.setStatus', { type: 'user', id: email }, { tenantId, status });
    res.json({ ok: true });
  } catch (e) { handleError(res, e); }
});

router.post('/users/unlock', requireAdmin(ADMIN_SCOPES.users), async (req, res) => {
  try {
    const { tenantId, email } = req.body ?? {};
    await adminService.unlockUser(tenantId, email);
    audit(req, res, 'user.unlock', { type: 'user', id: email }, { tenantId });
    res.json({ ok: true });
  } catch (e) { handleError(res, e); }
});

// --- Signing keys ---

router.post('/keys/rotate', requireAdmin(ADMIN_SCOPES.keys), async (req, res) => {
  try {
    const result = await adminService.rotateKey();
    audit(req, res, 'key.rotate', { type: 'key', id: result.kid });
    res.json(result);
  } catch (e) { handleError(res, e); }
});

router.get('/keys', requireAdmin(ADMIN_SCOPES.keys), async (_req, res) => {
  try {
    res.json({ keys: await adminService.keyStatus() });
  } catch (e) { handleError(res, e); }
});

// --- Statistics + audit log (console dashboards) ---

router.get('/stats', requireAdmin(ADMIN_SCOPES.stats), async (_req, res) => {
  try {
    res.json(await adminService.getStats());
  } catch (e) { handleError(res, e); }
});

router.get('/audit', requireAdmin(ADMIN_SCOPES.stats), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const models = makeModels(await getMasterConnection());
    const entries = await models.AuditLog.find().sort({ at: -1 }).limit(limit).lean().exec();
    res.json({ entries });
  } catch (e) { handleError(res, e); }
});

export default router;
