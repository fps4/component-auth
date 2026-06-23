import { CONFIG } from './config.js';
import { createAuthorizer, createSessionJwtSigner } from './core/index.js';
import { createOAuthServer } from './oauth/server.js';
import { createUserService } from './services/users.js';
import { createAdminService } from './services/admin.js';
import { getMasterConnection } from './utils/db.js';
import { makeModels } from './models/index.js';
import logger from './utils/logger.js';

const sessionJwtSigner = createSessionJwtSigner(() => ({
  secret: CONFIG.auth.jwtSecret,
  issuer: CONFIG.auth.jwtIssuer,
  audience: CONFIG.auth.jwtAudience
}));

export const authorizer = createAuthorizer({
  getMasterConnection,
  makeModels,
  signJwt: sessionJwtSigner,
  sessionTtlMinutes: CONFIG.auth.sessionTtlMinutes,
  logger
});

export const oauthServer = createOAuthServer({
  getMasterConnection,
  makeModels,
  logger
});

export const userService = createUserService({
  getMasterConnection,
  makeModels,
  logger
});

export const adminService = createAdminService({
  getMasterConnection,
  makeModels,
  logger
});
