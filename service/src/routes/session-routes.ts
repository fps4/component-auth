import express from 'express';
import type { Request, Response } from 'express';
import {
  InvalidInputError,
  MissingJwtSecretError,
  TenantNotFoundError,
  SessionNotFoundError,
  NoSessionUpdatesProvidedError
} from '../core/errors.js';
import { authorizer, userService } from '../container.js';
import { UserServiceError } from '../services/users.js';
import { extractClientMeta } from '../utils/request-metadata.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Self-service local-credential registration (RQ-0002). Login is the separate `password` grant.
router.post('/tenants/:tenantId/register', async (req: Request, res: Response) => {
  const tenantId = req.params?.tenantId;
  if (!tenantId) {
    return res.status(400).json({ message: 'tenantId parameter is required' });
  }
  try {
    const user = await userService.registerUser({
      tenantId,
      email: typeof req.body?.email === 'string' ? req.body.email : '',
      password: typeof req.body?.password === 'string' ? req.body.password : ''
    });
    return res.status(201).json({ id: user.id, email: user.email, tenantId: user.tenantId });
  } catch (error: any) {
    if (error instanceof UserServiceError) {
      return res.status(error.status).json({ error: error.code, message: error.message });
    }
    logger.error({ err: error, tenantId }, 'register user failed');
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

router.post('/tenants/:tenantId/sessions', async (req: Request, res: Response) => {
  const tenantId = req.params?.tenantId;
  if (!tenantId) {
    return res.status(400).json({ message: 'tenantId parameter is required' });
  }

  const visitorId = typeof req.body?.visitorId === 'string' ? req.body.visitorId : undefined;
  const subject = typeof req.body?.subject === 'string' ? req.body.subject : undefined;
  const metaFromHeaders = extractClientMeta(req);
  const metaFromBody = req.body?.clientMeta && typeof req.body.clientMeta === 'object' && !Array.isArray(req.body.clientMeta)
    ? req.body.clientMeta as Record<string, unknown>
    : undefined;
  const clientMeta = metaFromBody
    ? { ...metaFromHeaders, ...metaFromBody }
    : metaFromHeaders;

  try {
    const result = await authorizer.createSession({
      tenantId,
      visitorId,
      subject,
      clientMeta
    });

    return res.status(201).json({
      sessionId: result.sessionId,
      token: result.token,
      expiresIn: result.expiresIn,
      expiresAt: result.expiresAt.toISOString(),
      visitorId: result.visitorId
    });
  } catch (error: any) {
    logger.error({ err: error, tenantId }, 'create session failed');

    if (error instanceof TenantNotFoundError) {
      return res.status(404).json({ message: 'Tenant not found' });
    }
    if (error instanceof MissingJwtSecretError) {
      return res.status(500).json({ message: 'Server configuration error: missing AUTH_JWT_SECRET' });
    }
    if (error instanceof InvalidInputError) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

router.patch('/sessions/:sessionId', async (req: Request, res: Response) => {
  const sessionId = req.params?.sessionId ?? req.body?.sessionId;
  if (!sessionId) {
    return res.status(400).json({ message: 'sessionId parameter is required' });
  }

  const contactId = typeof req.body?.contactId === 'string' ? req.body.contactId : undefined;
  const cookies = req.body?.cookies && typeof req.body.cookies === 'object' ? req.body.cookies : undefined;

  try {
    const result = await authorizer.updateSession({
      sessionId,
      contactId,
      cookies
    });

    return res.status(200).json({
      sessionId: result.sessionId,
      updated: {
        ...result.updated,
        updatedAt: result.updated.updatedAt.toISOString()
      }
    });
  } catch (error: any) {
    logger.error({ err: error, sessionId }, 'update session failed');

    if (error instanceof SessionNotFoundError) {
      return res.status(404).json({ message: 'Session not found' });
    }
    if (error instanceof NoSessionUpdatesProvidedError || error instanceof InvalidInputError) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

export default router;
