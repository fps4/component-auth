import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash, generateKeyPairSync } from 'crypto';
import { SignJWT, jwtVerify, importSPKI, importPKCS8 } from 'jose';
import { createOAuthServer } from '../src/oauth/server.js';
import { createGoogleIdp } from '../src/oauth/google.js';
import { InvalidRequestError, UnauthorizedClientError, InvalidGrantError, AccessDeniedError } from '../src/oauth/errors.js';
import { CONFIG } from '../src/config.js';
import type { OAuthServerDependencies } from '../src/oauth/types.js';
import type { GoogleIdp } from '../src/oauth/google.js';

// A single RSA key pair stands in for the service's active signing key throughout the suite.
const { privateKey: signingPrivatePem, publicKey: signingPublicPem } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

vi.mock('../src/utils/key-store.js', () => ({
  getActiveKeyPair: vi.fn(async () => ({ kid: 'test-kid', privateKeyPem: signingPrivatePem, publicKeyPem: signingPublicPem })),
  ensureActiveSigningKey: vi.fn(async () => ({ kid: 'test-kid', privateKeyPem: signingPrivatePem, publicKeyPem: signingPublicPem })),
  listPublicKeys: vi.fn(async () => []),
  rotateSigningKey: vi.fn()
}));

// --- A minimal in-memory mongoose-ish model layer ---------------------------------------------

const attachSave = <T extends object>(doc: T): T & { save: () => Promise<void> } => {
  if (typeof (doc as any).save !== 'function') {
    Object.defineProperty(doc, 'save', { value: async () => {}, enumerable: false, configurable: true });
  }
  return doc as any;
};

const matches = (item: any, query: any): boolean =>
  Object.entries(query).every(([key, value]) => item[key] === value);

interface Store {
  tenants: any[];
  clients: any[];
  authorizations: any[];
  tokens: any[];
  sessions: any[];
}

function makeStore(): Store {
  return { tenants: [], clients: [], authorizations: [], tokens: [], sessions: [] };
}

function makeDeps(store: Store, googleIdp: GoogleIdp, now: () => Date): OAuthServerDependencies {
  return {
    getMasterConnection: async () => ({}) as any,
    googleIdp,
    now,
    makeModels: () => ({
      Tenant: {
        findOne: (query: any) => ({ lean: () => ({ exec: async () => store.tenants.find((t) => matches(t, query)) ?? null }) })
      },
      OAuthClient: {
        findById: (id: string) => ({ lean: () => ({ exec: async () => store.clients.find((c) => c._id === id) ?? null }) })
      },
      OAuthAuthorization: {
        create: async (doc: any) => { store.authorizations.push(doc); return doc; },
        findOne: (query: any) => ({ exec: async () => { const found = store.authorizations.find((a) => matches(a, query)); return found ? attachSave(found) : null; } })
      },
      OAuthToken: {
        create: async (doc: any) => { store.tokens.push(doc); return doc; },
        findOne: (query: any) => ({ exec: async () => { const found = store.tokens.find((t) => matches(t, query)); return found ? attachSave(found) : null; } })
      },
      Session: {
        create: async (doc: any) => { store.sessions.push(doc); return doc; },
        findById: (id: string) => ({ exec: async () => { const found = store.sessions.find((s) => s._id === id); return found ? attachSave(found) : null; } }),
        updateOne: (filter: any, update: any) => ({ exec: async () => { const found = store.sessions.find((s) => matches(s, filter)); if (found) Object.assign(found, update.$set ?? {}); } })
      },
      KeyStore: {} as any
    }) as any,
    logger: { info: () => {}, error: () => {} } as any
  };
}

// --- A stub Google IdP: deterministic, no network ---------------------------------------------

function makeStubIdp(overrides: Partial<GoogleIdp> = {}): GoogleIdp {
  return {
    buildAuthorizationUrl: ({ state, nonce }) => `https://accounts.google.test/auth?state=${state}&nonce=${nonce}`,
    exchangeCode: async () => ({ idToken: 'stub-id-token' }),
    verifyIdToken: async () => ({ email: 'reviewer@fps4.test', sub: 'google-sub-123', emailVerified: true }),
    ...overrides
  };
}

const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

function seedTenantAndClient(store: Store) {
  store.tenants.push({
    _id: 'tenant-maestro',
    name: 'maestro',
    status: 'active',
    oauth: { enabled: true, allowedGrantTypes: ['authorization_code'], allowedScopes: [], idp: { provider: 'google' } }
  });
  store.clients.push({
    _id: 'client-maestro',
    tenantId: 'tenant-maestro',
    name: 'maestro web',
    secretHash: 'unused',
    grantTypes: ['authorization_code'],
    redirectUris: ['https://maestro.test/callback'],
    scopes: [],
    audience: 'maestro-workspace',
    isConfidential: false
  });
}

// Drive authorize -> callback -> token and return the issued token response.
async function runHappyPath(server: ReturnType<typeof createOAuthServer>, store: Store, verifier: string) {
  await server.startAuthorization({
    clientId: 'client-maestro',
    redirectUri: 'https://maestro.test/callback',
    codeChallenge: pkceChallenge(verifier),
    state: 'consumer-state-xyz'
  });
  const authRecord = store.authorizations[store.authorizations.length - 1];
  await server.handleGoogleCallback({ code: 'google-code', state: authRecord.googleState });
  const code = authRecord.code as string; // capture before it is consumed
  const token = await server.issueAuthorizationCodeToken({
    code,
    codeVerifier: verifier,
    clientId: 'client-maestro',
    redirectUri: 'https://maestro.test/callback'
  });
  return { token, code };
}

describe('OAuth server – Google SSO user flow (RQ-0001)', () => {
  let store: Store;
  let server: ReturnType<typeof createOAuthServer>;
  const fixedNow = new Date('2026-06-01T12:00:00.000Z');
  const verifier = 'test-code-verifier-0123456789-abcdefghijklmnop';

  beforeEach(() => {
    store = makeStore();
    seedTenantAndClient(store);
    server = createOAuthServer(makeDeps(store, makeStubIdp(), () => fixedNow));
  });

  it('issues a user JWT that passes maestro-style verification (email, sub, iss, aud, exp via JWKS)', async () => {
    const { token } = await runHappyPath(server, store, verifier);

    expect(token.tokenType).toBe('Bearer');
    expect(token.expiresIn).toBe(CONFIG.oauth.accessTokenTtlSec);
    expect(token.refreshToken).toBeTruthy();

    // Verify exactly as a consumer's authenticated edge does: RS256 via the published key, iss + aud + exp enforced.
    // `currentDate` pins jose's clock to the issuance time (the suite issues at a fixed `now`).
    const publicKey = await importSPKI(signingPublicPem, 'RS256');
    const { payload } = await jwtVerify(token.accessToken, publicKey, {
      issuer: CONFIG.auth.jwtIssuer,
      audience: 'maestro-workspace',
      requiredClaims: ['exp'],
      currentDate: fixedNow
    });
    expect(payload.email).toBe('reviewer@fps4.test');
    expect(payload.sub).toBe('google-sub-123'); // the stable Google subject, not the email
    expect(payload.aud).toBe('maestro-workspace');
    expect(payload.iss).toBe(CONFIG.auth.jwtIssuer);
    expect(typeof payload.exp).toBe('number');
  });

  it('binds aud to the initiating client (a token is not valid for another workspace)', async () => {
    const { token } = await runHappyPath(server, store, verifier);
    const publicKey = await importSPKI(signingPublicPem, 'RS256');
    await expect(
      jwtVerify(token.accessToken, publicKey, { audience: 'some-other-workspace', currentDate: fixedNow })
    ).rejects.toThrow();
  });

  it('persists an active session and a hashed refresh token', async () => {
    await runHappyPath(server, store, verifier);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].status).toBe('active');
    const refresh = store.tokens.find((t) => t.type === 'refresh');
    expect(refresh).toBeTruthy();
    expect(refresh.hashedToken).toBeTruthy();
    expect(refresh.hashedToken).not.toContain(' '); // hashed, never the raw value
  });

  it('rejects an unregistered redirect_uri at authorize time', async () => {
    await expect(server.startAuthorization({
      clientId: 'client-maestro',
      redirectUri: 'https://evil.test/callback',
      codeChallenge: pkceChallenge(verifier)
    })).rejects.toBeInstanceOf(InvalidRequestError);
  });

  it('rejects a client without an audience configured', async () => {
    store.clients[0].audience = undefined;
    await expect(server.startAuthorization({
      clientId: 'client-maestro',
      redirectUri: 'https://maestro.test/callback',
      codeChallenge: pkceChallenge(verifier)
    })).rejects.toBeInstanceOf(UnauthorizedClientError);
  });

  it('denies the callback on an unknown/invalid state', async () => {
    await expect(server.handleGoogleCallback({ code: 'x', state: 'never-issued' }))
      .rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('redirects back with an OAuth error (and mints no token) when the Google id_token is rejected', async () => {
    const failingIdp = makeStubIdp({
      verifyIdToken: async () => { throw new AccessDeniedError('expired Google id_token'); }
    });
    server = createOAuthServer(makeDeps(store, failingIdp, () => fixedNow));

    await server.startAuthorization({
      clientId: 'client-maestro',
      redirectUri: 'https://maestro.test/callback',
      codeChallenge: pkceChallenge(verifier),
      state: 'consumer-state'
    });
    const authRecord = store.authorizations[store.authorizations.length - 1];
    const result = await server.handleGoogleCallback({ code: 'google-code', state: authRecord.googleState });

    expect(result.redirectTo).toContain('error=access_denied');
    expect(authRecord.code).toBeUndefined();       // no auth code minted
    expect(store.tokens).toHaveLength(0);           // no token issued
  });

  it('rejects the token exchange when the PKCE verifier is wrong', async () => {
    await server.startAuthorization({
      clientId: 'client-maestro',
      redirectUri: 'https://maestro.test/callback',
      codeChallenge: pkceChallenge(verifier),
      state: 's'
    });
    const authRecord = store.authorizations[store.authorizations.length - 1];
    await server.handleGoogleCallback({ code: 'google-code', state: authRecord.googleState });

    await expect(server.issueAuthorizationCodeToken({
      code: authRecord.code,
      codeVerifier: 'the-wrong-verifier',
      clientId: 'client-maestro',
      redirectUri: 'https://maestro.test/callback'
    })).rejects.toBeInstanceOf(InvalidGrantError);
  });

  it('makes the authorization code single-use', async () => {
    const { code } = await runHappyPath(server, store, verifier);
    // Replaying the same (now consumed) code must not mint a second token.
    await expect(server.issueAuthorizationCodeToken({
      code,
      codeVerifier: verifier,
      clientId: 'client-maestro',
      redirectUri: 'https://maestro.test/callback'
    })).rejects.toBeInstanceOf(InvalidGrantError);
  });

  it('rotates the refresh token and invalidates the old one', async () => {
    const { token: first } = await runHappyPath(server, store, verifier);
    const rotated = await server.refreshUserToken({ refreshToken: first.refreshToken, clientId: 'client-maestro' });

    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect(rotated.accessToken).toBeTruthy();

    // The original refresh token is now revoked.
    await expect(server.refreshUserToken({ refreshToken: first.refreshToken, clientId: 'client-maestro' }))
      .rejects.toBeInstanceOf(InvalidGrantError);
  });

  it('refresh cannot outlive a revoked session (AC6)', async () => {
    const { token } = await runHappyPath(server, store, verifier);
    // Revoke the session directly — simulating an admin/logout revocation.
    store.sessions[0].status = 'revoked';
    await expect(server.refreshUserToken({ refreshToken: token.refreshToken, clientId: 'client-maestro' }))
      .rejects.toBeInstanceOf(InvalidGrantError);
  });

  it('revoking a refresh token cascades to its session', async () => {
    const { token } = await runHappyPath(server, store, verifier);
    await server.revokeUserToken({ token: token.refreshToken });
    expect(store.sessions[0].status).toBe('revoked');
    await expect(server.refreshUserToken({ refreshToken: token.refreshToken, clientId: 'client-maestro' }))
      .rejects.toBeInstanceOf(InvalidGrantError);
  });
});

// --- The real Google id_token verifier (signature / iss / aud / exp / nonce) ------------------

describe('createGoogleIdp.verifyIdToken', () => {
  const { privateKey: gPriv, publicKey: gPub } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const googleConfig = {
    clientId: 'google-client-id',
    clientSecret: 'google-secret',
    issuer: 'https://accounts.google.test',
    authorizationEndpoint: 'https://accounts.google.test/auth',
    tokenEndpoint: 'https://accounts.google.test/token',
    jwksUri: 'https://accounts.google.test/certs',
    redirectUri: 'https://auth.test/oauth2/callback'
  };

  async function makeIdp() {
    const keyResolver = await importSPKI(gPub, 'RS256');
    return createGoogleIdp(googleConfig, { keyResolver });
  }

  async function signGoogleIdToken(claims: Record<string, unknown>, expSecondsFromNow = 300) {
    const key = await importPKCS8(gPriv, 'RS256');
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'g-kid', typ: 'JWT' })
      .setIssuer(googleConfig.issuer)
      .setAudience(googleConfig.clientId)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + expSecondsFromNow)
      .sign(key);
  }

  it('accepts a valid id_token and returns the identity', async () => {
    const idp = await makeIdp();
    const token = await signGoogleIdToken({ email: 'u@x.test', email_verified: true, sub: 'g-sub-1', nonce: 'N1' });
    const identity = await idp.verifyIdToken(token, { nonce: 'N1' });
    expect(identity).toEqual({ email: 'u@x.test', sub: 'g-sub-1', emailVerified: true });
  });

  it('rejects an expired id_token', async () => {
    const idp = await makeIdp();
    const token = await signGoogleIdToken({ email: 'u@x.test', sub: 'g-sub-1', nonce: 'N1' }, -10);
    await expect(idp.verifyIdToken(token, { nonce: 'N1' })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('rejects a nonce mismatch', async () => {
    const idp = await makeIdp();
    const token = await signGoogleIdToken({ email: 'u@x.test', sub: 'g-sub-1', nonce: 'N1' });
    await expect(idp.verifyIdToken(token, { nonce: 'DIFFERENT' })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('rejects a token minted for a different audience', async () => {
    const idp = await makeIdp();
    const key = await importPKCS8(gPriv, 'RS256');
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ email: 'u@x.test', sub: 'g-sub-1', nonce: 'N1' })
      .setProtectedHeader({ alg: 'RS256', kid: 'g-kid', typ: 'JWT' })
      .setIssuer(googleConfig.issuer)
      .setAudience('some-other-client')
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 300)
      .sign(key);
    await expect(idp.verifyIdToken(token, { nonce: 'N1' })).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
