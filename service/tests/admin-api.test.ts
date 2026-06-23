import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateKeyPairSync, createPublicKey } from 'crypto';
import { SignJWT } from 'jose';

// Mock the key store so admin-auth verifies against a known test key, and rotateKey is a no-op.
const { privateKey: testPrivateKeyPem, publicKey: testPublicKeyPem } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const testJwk = createPublicKey(testPublicKeyPem).export({ format: 'jwk' }) as Record<string, string>;

vi.mock('../src/utils/key-store.js', () => ({
  listPublicKeys: vi.fn(async () => [{ kid: 'test-kid', kty: 'RSA', alg: 'RS256', use: 'sig', n: testJwk.n, e: testJwk.e }]),
  rotateSigningKey: vi.fn(async () => ({ kid: 'rotated-kid', privateKeyPem: '', publicKeyPem: '' }))
}));

import { createAdminService, AdminServiceError } from '../src/services/admin.js';
import { requireAdmin, ADMIN_SCOPES } from '../src/core/admin-auth.js';
import { CONFIG } from '../src/config.js';
import { verifySecret } from '../src/utils/hash.js';

// --- A compact in-memory mongoose-ish collection supporting the methods admin.ts uses ---

const match = (doc: any, filter: Record<string, any>): boolean =>
  Object.entries(filter ?? {}).every(([k, v]) => {
    if (v && typeof v === 'object' && '$gt' in v) return doc[k] != null && doc[k] > v.$gt;
    return doc[k] === v;
  });

function fakeCollection(items: any[]) {
  const exec = <T>(v: T) => ({ exec: async () => v, lean: function () { return this; }, select: function () { return this; } });
  return {
    _items: items,
    find: (filter: any = {}) => exec(items.filter((d) => match(d, filter))),
    findById: (id: string) => exec(items.find((d) => d._id === id) ?? null),
    findOne: (filter: any) => exec(items.find((d) => match(d, filter)) ?? null),
    countDocuments: (filter: any = {}) => ({ exec: async () => items.filter((d) => match(d, filter)).length }),
    create: async (doc: any) => { items.push({ ...doc }); return doc; },
    findByIdAndUpdate: (id: string, update: any, opts: any = {}) => {
      let doc = items.find((d) => d._id === id);
      const set = update.$set ?? {};
      const onInsert = update.$setOnInsert ?? {};
      if (!doc) {
        if (!opts.upsert) return exec(null); // mongoose returns null when not found and not upserting
        doc = { _id: id, ...onInsert, ...set }; items.push(doc);
      } else { Object.assign(doc, set); }
      return exec(doc);
    },
    updateOne: (filter: any, update: any) => ({
      exec: async () => {
        const doc = items.find((d) => match(d, filter));
        if (!doc) return { matchedCount: 0 };
        Object.assign(doc, update.$set ?? {});
        return { matchedCount: 1 };
      }
    })
  };
}

function makeState() {
  return {
    Tenant: fakeCollection([{ _id: 't1', name: 'Acme', status: 'active' }]),
    OAuthClient: fakeCollection([]),
    User: fakeCollection([]),
    OAuthToken: fakeCollection([]),
    KeyStore: fakeCollection([{ _id: 'k1', status: 'active' }])
  };
}

function makeAdmin(state: ReturnType<typeof makeState>) {
  return createAdminService({
    getMasterConnection: async () => ({}) as any,
    makeModels: () => state as any
  });
}

describe('admin service', () => {
  let state: ReturnType<typeof makeState>;
  beforeEach(() => { state = makeState(); });

  it('upserts a tenant idempotently', async () => {
    const admin = makeAdmin(state);
    const created = await admin.upsertTenant({ name: 'New Co' });
    expect((created as any).name).toBe('New Co');
    const again = await admin.upsertTenant({ id: (created as any)._id, name: 'Renamed Co' });
    expect((again as any).name).toBe('Renamed Co');
    // started with 1 tenant + 1 new = 2 (the update did not add a third)
    expect(state.Tenant._items.length).toBe(2);
  });

  it('creates a client, returns the secret once, and stores only its hash', async () => {
    const admin = makeAdmin(state);
    const { clientId, secret } = await admin.createClient({ tenantId: 't1', name: 'svc', grantTypes: ['client_credentials'], scopes: ['admin'] });
    expect(secret).toBeTruthy();
    const stored = state.OAuthClient._items.find((c) => c._id === clientId);
    expect(stored.secretHash).not.toContain(secret);
    expect(verifySecret(secret, stored.secretHash)).toBe(true);
  });

  it('rotates a client secret and 404s on an unknown client', async () => {
    const admin = makeAdmin(state);
    const { clientId } = await admin.createClient({ tenantId: 't1', name: 'svc', grantTypes: ['client_credentials'] });
    const before = state.OAuthClient._items.find((c) => c._id === clientId).secretHash;
    const { secret } = await admin.rotateClientSecret(clientId);
    const after = state.OAuthClient._items.find((c) => c._id === clientId).secretHash;
    expect(after).not.toBe(before);
    expect(verifySecret(secret, after)).toBe(true);
    await expect(admin.rotateClientSecret('nope')).rejects.toBeInstanceOf(AdminServiceError);
  });

  it('rejects creating a client for a missing tenant', async () => {
    const admin = makeAdmin(state);
    await expect(admin.createClient({ tenantId: 'ghost', name: 'x', grantTypes: ['client_credentials'] }))
      .rejects.toMatchObject({ status: 404, code: 'tenant_not_found' });
  });

  it('creates a user and rejects a duplicate email', async () => {
    const admin = makeAdmin(state);
    const u = await admin.createUser({ tenantId: 't1', email: 'A@Example.com', password: 'secret-pass' });
    expect(u.email).toBe('a@example.com'); // normalized
    await expect(admin.createUser({ tenantId: 't1', email: 'a@example.com', password: 'x' }))
      .rejects.toMatchObject({ status: 409, code: 'email_taken' });
  });

  it('reports stats in the console shape', async () => {
    const admin = makeAdmin(state);
    const stats = await admin.getStats();
    expect(stats.tenants.total).toBe(1);
    expect(stats.keys.active).toBe(1);
    expect(stats).toHaveProperty('tokens.accessLastHour');
  });
});

describe('admin-auth (requireAdmin)', () => {
  const sign = (claims: Record<string, unknown>) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' })
      .setIssuer(CONFIG.auth.jwtIssuer)
      .setAudience('identity-service-clients')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(createPrivateKeyForTest());

  function createPrivateKeyForTest() {
    // jose accepts a KeyObject; import the PEM via node crypto.
    const { createPrivateKey } = require('crypto');
    return createPrivateKey(testPrivateKeyPem);
  }

  const run = async (token: string | null, areaScope: string) => {
    const req: any = { headers: token ? { authorization: `Bearer ${token}` } : {} };
    let statusCode = 200; let body: any = null; let nexted = false;
    const res: any = { status(c: number) { statusCode = c; return this; }, json(b: any) { body = b; return this; } };
    await requireAdmin(areaScope)(req, res, () => { nexted = true; });
    return { statusCode, body, nexted, req };
  };

  it('401s without a token', async () => {
    const { statusCode, nexted } = await run(null, ADMIN_SCOPES.tenants);
    expect(statusCode).toBe(401);
    expect(nexted).toBe(false);
  });

  it('allows a token with the superscope and attaches the principal', async () => {
    const token = await sign({ cid: 'admin-client', tid: 't1', sub: 'svc', scope: 'admin' });
    const { nexted, req } = await run(token, ADMIN_SCOPES.users);
    expect(nexted).toBe(true);
    expect(req.admin.clientId).toBe('admin-client');
  });

  it('allows a token with the matching granular scope', async () => {
    const token = await sign({ cid: 'c', scope: 'admin:users other' });
    const { nexted } = await run(token, ADMIN_SCOPES.users);
    expect(nexted).toBe(true);
  });

  it('403s a valid token lacking the required scope', async () => {
    const token = await sign({ cid: 'c', scope: 'admin:tenants' });
    const { statusCode, nexted } = await run(token, ADMIN_SCOPES.users);
    expect(statusCode).toBe(403);
    expect(nexted).toBe(false);
  });

  it('403s a user token (no cid) even with an admin scope', async () => {
    const token = await sign({ sub: 'user@x.com', scope: 'admin' });
    const { statusCode, nexted } = await run(token, ADMIN_SCOPES.users);
    expect(statusCode).toBe(403);
    expect(nexted).toBe(false);
  });
});
