import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { jwtVerify, importSPKI } from 'jose';
import { createOAuthServer } from '../src/oauth/server.js';
import { createUserService, UserServiceError } from '../src/services/users.js';
import { hashSecret } from '../src/utils/hash.js';
import { InvalidGrantError, UnauthorizedClientError } from '../src/oauth/errors.js';
import { CONFIG } from '../src/config.js';

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

const attachSave = <T extends object>(doc: T): T & { save: () => Promise<void> } => {
  if (typeof (doc as any).save !== 'function') {
    Object.defineProperty(doc, 'save', { value: async () => {}, enumerable: false, configurable: true });
  }
  return doc as any;
};
const matches = (item: any, query: any): boolean =>
  Object.entries(query).every(([k, v]) => (v && typeof v === 'object' && '$gte' in (v as any)) ? item[k] >= (v as any).$gte : item[k] === v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

interface Store { tenants: any[]; clients: any[]; users: any[]; tokens: any[]; sessions: any[]; }
const makeStore = (): Store => ({ tenants: [], clients: [], users: [], tokens: [], sessions: [] });

function makeDeps(store: Store, now: () => Date) {
  return {
    getMasterConnection: async () => ({}) as any,
    now,
    makeModels: () => ({
      Tenant: { findOne: (q: any) => ({ lean: () => ({ exec: async () => store.tenants.find((t) => matches(t, q)) ?? null }) }) },
      OAuthClient: { findById: (id: string) => ({ lean: () => ({ exec: async () => store.clients.find((c) => c._id === id) ?? null }) }) },
      User: {
        findOne: (q: any) => ({
          exec: async () => { const u = store.users.find((x) => matches(x, q)); return u ? attachSave(u) : null; },
          lean: () => ({ exec: async () => { const u = store.users.find((x) => matches(x, q)); return u ? clone(u) : null; } })
        }),
        countDocuments: (q: any) => ({ exec: async () => store.users.filter((u) => matches(u, q)).length }),
        create: async (doc: any) => { store.users.push({ failedAttempts: 0, lockedUntil: null, ...doc }); return doc; }
      },
      OAuthToken: {
        create: async (doc: any) => { store.tokens.push(doc); return doc; },
        findOne: (q: any) => ({ exec: async () => { const t = store.tokens.find((x) => matches(x, q)); return t ? attachSave(t) : null; } })
      },
      Session: { create: async (doc: any) => { store.sessions.push(doc); return doc; }, findById: (id: string) => ({ exec: async () => { const s = store.sessions.find((x) => x._id === id); return s ? attachSave(s) : null; } }) },
      KeyStore: {} as any
    }) as any,
    logger: { info: () => {}, error: () => {} } as any
  };
}

function seedLocalTenant(store: Store) {
  store.tenants.push({
    _id: 'tenant-local', name: 'local', status: 'active',
    oauth: { enabled: true, allowedGrantTypes: ['password'], allowedScopes: [], idp: { provider: 'local' } }
  });
  store.clients.push({
    _id: 'client-local', tenantId: 'tenant-local', name: 'local web',
    grantTypes: ['password'], redirectUris: [], scopes: [], audience: 'maestro-workspace', isConfidential: false, secretHash: ''
  });
}

describe('Local password IdP — registration (RQ-0002)', () => {
  let store: Store;
  let users: ReturnType<typeof createUserService>;
  const now = () => new Date('2026-06-01T12:00:00.000Z');

  beforeEach(() => {
    store = makeStore();
    seedLocalTenant(store);
    users = createUserService(makeDeps(store, now));
  });

  it('registers a user with a stable subject id', async () => {
    const user = await users.registerUser({ tenantId: 'tenant-local', email: 'Reviewer@FPS4.test', password: 'correct-horse-battery' });
    expect(user.email).toBe('reviewer@fps4.test'); // normalized
    expect(user.id).toBeTruthy();
    expect(store.users).toHaveLength(1);
    expect(store.users[0].passwordHash).not.toContain('correct-horse'); // hashed, not raw
  });

  it('rejects a duplicate email (409)', async () => {
    await users.registerUser({ tenantId: 'tenant-local', email: 'dup@fps4.test', password: 'correct-horse-battery' });
    await expect(users.registerUser({ tenantId: 'tenant-local', email: 'dup@fps4.test', password: 'another-strong-pass' }))
      .rejects.toMatchObject({ status: 409, code: 'email_taken' });
  });

  it('rejects a weak password (400)', async () => {
    await expect(users.registerUser({ tenantId: 'tenant-local', email: 'weak@fps4.test', password: 'short' }))
      .rejects.toMatchObject({ status: 400, code: 'weak_password' });
  });

  it('rejects an invalid email (400)', async () => {
    await expect(users.registerUser({ tenantId: 'tenant-local', email: 'not-an-email', password: 'correct-horse-battery' }))
      .rejects.toBeInstanceOf(UserServiceError);
  });

  it('refuses when the tenant has not enabled the local IdP', async () => {
    store.tenants[0].oauth.idp = { provider: 'google' };
    await expect(users.registerUser({ tenantId: 'tenant-local', email: 'x@fps4.test', password: 'correct-horse-battery' }))
      .rejects.toMatchObject({ status: 400, code: 'local_idp_disabled' });
  });
});

describe('Local password IdP — login (RQ-0002)', () => {
  let store: Store;
  let server: ReturnType<typeof createOAuthServer>;
  const fixedNow = new Date('2026-06-01T12:00:00.000Z');
  const password = 'correct-horse-battery';

  beforeEach(() => {
    store = makeStore();
    seedLocalTenant(store);
    store.users.push({
      _id: 'user-sub-1', tenantId: 'tenant-local', email: 'reviewer@fps4.test',
      passwordHash: hashSecret(password), status: 'active', failedAttempts: 0, lockedUntil: null
    });
    server = createOAuthServer(makeDeps(store, () => fixedNow));
  });

  it('issues a user JWT (email + stable sub + aud) that passes maestro-style verification', async () => {
    const token = await server.issuePasswordToken({ username: 'reviewer@fps4.test', password, clientId: 'client-local' });
    const publicKey = await importSPKI(signingPublicPem, 'RS256');
    const { payload } = await jwtVerify(token.accessToken, publicKey, {
      issuer: CONFIG.auth.jwtIssuer, audience: 'maestro-workspace', requiredClaims: ['exp'], currentDate: fixedNow
    });
    expect(payload.email).toBe('reviewer@fps4.test');
    expect(payload.sub).toBe('user-sub-1');
    expect(payload.aud).toBe('maestro-workspace');
    expect(token.refreshToken).toBeTruthy();
  });

  it('rejects a wrong password and increments the failure counter', async () => {
    await expect(server.issuePasswordToken({ username: 'reviewer@fps4.test', password: 'wrong', clientId: 'client-local' }))
      .rejects.toBeInstanceOf(InvalidGrantError);
    expect(store.users[0].failedAttempts).toBe(1);
  });

  it('returns the same generic error for an unknown email (no user enumeration)', async () => {
    await expect(server.issuePasswordToken({ username: 'nobody@fps4.test', password, clientId: 'client-local' }))
      .rejects.toBeInstanceOf(InvalidGrantError);
  });

  it('locks the account after the configured failures, then refuses even a correct password', async () => {
    store.users[0].failedAttempts = CONFIG.auth.password.maxFailedAttempts - 1;
    // The failing attempt that trips the lock.
    await expect(server.issuePasswordToken({ username: 'reviewer@fps4.test', password: 'wrong', clientId: 'client-local' }))
      .rejects.toBeInstanceOf(InvalidGrantError);
    expect(store.users[0].lockedUntil).toBeTruthy();
    // Correct password is now refused while locked (the reason rides in the OAuth error description).
    await expect(server.issuePasswordToken({ username: 'reviewer@fps4.test', password, clientId: 'client-local' }))
      .rejects.toMatchObject({ error: 'invalid_grant', description: expect.stringMatching(/locked/i) });
  });

  it('refuses a disabled account', async () => {
    store.users[0].status = 'disabled';
    await expect(server.issuePasswordToken({ username: 'reviewer@fps4.test', password, clientId: 'client-local' }))
      .rejects.toBeInstanceOf(InvalidGrantError);
  });

  it('refuses a client that does not allow the password grant', async () => {
    store.clients[0].grantTypes = ['authorization_code'];
    await expect(server.issuePasswordToken({ username: 'reviewer@fps4.test', password, clientId: 'client-local' }))
      .rejects.toBeInstanceOf(UnauthorizedClientError);
  });
});
