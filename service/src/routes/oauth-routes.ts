import express from 'express';
import type { Request, Response } from 'express';
import { oauthServer } from '../container.js';
import {
  OAuthError,
  InvalidRequestError,
  InvalidClientError
} from '../oauth/errors.js';

const router = express.Router();

const SUPPORTED_GRANTS = new Set(['client_credentials', 'authorization_code', 'refresh_token', 'password']);

router.post('/token', async (req: Request, res: Response) => {
  const grantType = (req.body?.grant_type ?? req.query?.grant_type) as string | undefined;
  if (!grantType) {
    return handleError(res, new InvalidRequestError('grant_type is required'));
  }
  if (!SUPPORTED_GRANTS.has(grantType)) {
    return handleError(res, new InvalidRequestError(`Unsupported grant_type: ${grantType}`));
  }

  try {
    if (grantType === 'client_credentials') {
      return await handleClientCredentials(req, res);
    }
    if (grantType === 'authorization_code') {
      return await handleAuthorizationCode(req, res);
    }
    if (grantType === 'password') {
      return await handlePasswordGrant(req, res);
    }
    return await handleRefreshToken(req, res);
  } catch (error: any) {
    if (error instanceof OAuthError) {
      return handleError(res, error);
    }
    return res.status(500).json({ error: 'server_error', error_description: 'Internal Server Error' });
  }
});

// Browser entry point: redirect the user to Google to authenticate (RQ-0001).
router.get('/authorize', async (req: Request, res: Response) => {
  try {
    const scopeParam = req.query?.scope;
    const result = await oauthServer.startAuthorization({
      clientId: String(req.query?.client_id ?? ''),
      redirectUri: String(req.query?.redirect_uri ?? ''),
      codeChallenge: String(req.query?.code_challenge ?? ''),
      codeChallengeMethod: req.query?.code_challenge_method ? String(req.query.code_challenge_method) : undefined,
      state: req.query?.state ? String(req.query.state) : undefined,
      scope: parseScope(scopeParam)
    });
    return res.redirect(302, result.redirectTo);
  } catch (error: any) {
    if (error instanceof OAuthError) {
      // Cannot trust an unvalidated redirect_uri here — surface the error directly, no redirect.
      return handleError(res, error);
    }
    return res.status(500).json({ error: 'server_error', error_description: 'Internal Server Error' });
  }
});

// Google redirects back here with its authorization code.
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const result = await oauthServer.handleGoogleCallback({
      code: String(req.query?.code ?? ''),
      state: String(req.query?.state ?? '')
    });
    return res.redirect(302, result.redirectTo);
  } catch (error: any) {
    if (error instanceof OAuthError) {
      return handleError(res, error);
    }
    return res.status(500).json({ error: 'server_error', error_description: 'Internal Server Error' });
  }
});

// Revoke a refresh token (and its session). RFC 7009 — always 200, even for unknown tokens.
router.post('/revoke', async (req: Request, res: Response) => {
  try {
    await oauthServer.revokeUserToken({ token: String(req.body?.token ?? req.body?.refresh_token ?? '') });
    return res.status(200).json({ revoked: true });
  } catch (error: any) {
    if (error instanceof OAuthError) {
      return handleError(res, error);
    }
    return res.status(500).json({ error: 'server_error', error_description: 'Internal Server Error' });
  }
});

async function handleClientCredentials(req: Request, res: Response) {
  const credentials = extractClientCredentials(req);
  if (!credentials.clientId || !credentials.clientSecret) {
    return handleError(res, new InvalidClientError('Client credentials missing'));
  }
  const token = await oauthServer.issueClientCredentialsToken({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    scope: parseScope(req.body?.scope ?? req.query?.scope)
  });
  return res.status(200).json({
    access_token: token.accessToken,
    token_type: token.tokenType,
    expires_in: token.expiresIn,
    scope: token.scope.join(' ')
  });
}

async function handleAuthorizationCode(req: Request, res: Response) {
  // Public client + PKCE: the code_verifier authenticates the exchange, not a client_secret.
  const token = await oauthServer.issueAuthorizationCodeToken({
    code: String(req.body?.code ?? ''),
    codeVerifier: String(req.body?.code_verifier ?? ''),
    clientId: String(req.body?.client_id ?? ''),
    redirectUri: String(req.body?.redirect_uri ?? '')
  });
  return res.status(200).json(userTokenBody(token));
}

async function handlePasswordGrant(req: Request, res: Response) {
  const token = await oauthServer.issuePasswordToken({
    username: String(req.body?.username ?? ''),
    password: String(req.body?.password ?? ''),
    clientId: String(req.body?.client_id ?? '')
  });
  return res.status(200).json(userTokenBody(token));
}

async function handleRefreshToken(req: Request, res: Response) {
  const token = await oauthServer.refreshUserToken({
    refreshToken: String(req.body?.refresh_token ?? ''),
    clientId: String(req.body?.client_id ?? '')
  });
  return res.status(200).json(userTokenBody(token));
}

function userTokenBody(token: {
  accessToken: string; tokenType: string; expiresIn: number;
  refreshToken: string; refreshExpiresIn: number; scope: string[];
}) {
  return {
    access_token: token.accessToken,
    token_type: token.tokenType,
    expires_in: token.expiresIn,
    refresh_token: token.refreshToken,
    refresh_expires_in: token.refreshExpiresIn,
    scope: token.scope.join(' ')
  };
}

function parseScope(scopeParam: unknown): string[] {
  return typeof scopeParam === 'string' && scopeParam.trim()
    ? scopeParam.trim().split(/\s+/)
    : [];
}

function handleError(res: Response, error: OAuthError) {
  const payload: Record<string, string> = {
    error: error.error,
    error_description: error.description ?? error.message
  };
  const headers: Record<string, string> = {};
  if (error instanceof InvalidClientError) {
    headers['WWW-Authenticate'] = 'Basic realm="oauth"';
  }
  return res.status(error.status).set(headers).json(payload);
}

function extractClientCredentials(req: Request): { clientId?: string; clientSecret?: string } {
  const header = req.headers.authorization ?? req.headers.Authorization;
  if (typeof header === 'string' && header.startsWith('Basic ')) {
    const value = header.slice('Basic '.length);
    const decoded = Buffer.from(value, 'base64').toString('utf-8');
    const [clientId, clientSecret] = decoded.split(':');
    return { clientId, clientSecret };
  }

  const clientId = req.body?.client_id ?? req.query?.client_id;
  const clientSecret = req.body?.client_secret ?? req.query?.client_secret;
  return { clientId, clientSecret };
}

export default router;
