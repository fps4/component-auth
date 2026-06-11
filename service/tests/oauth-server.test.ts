import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createOAuthServer } from '../src/oauth/server.js';
import { hashSecret } from '../src/utils/hash.js';
import {
  InvalidScopeError,
  UnauthorizedClientError,
  RateLimitExceededError
} from '../src/oauth/errors.js';
import { decodeJwt } from 'jose';
import { generateKeyPairSync } from 'crypto';
import type { OAuthServerDependencies } from '../src/oauth/types.js';
import type { TenantDocument, TenantOAuthConfig } from '../src/models/tenant.js';

const { privateKey: testPrivateKeyPem, publicKey: testPublicKeyPem } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

vi.mock('../src/utils/key-store.js', () => ({
  getActiveKeyPair: vi.fn(async () => ({
    kid: 'test-kid',
    privateKeyPem: testPrivateKeyPem,
    publicKeyPem: testPublicKeyPem
  })),
  ensureActiveSigningKey: vi.fn(async () => ({
    kid: 'test-kid',
    privateKeyPem: testPrivateKeyPem,
    publicKeyPem: testPublicKeyPem
  })),
  listPublicKeys: vi.fn(async () => []),
  rotateSigningKey: vi.fn()
}));

type TokenDoc = {
  _id: string;
  tenantId: string;
  clientId: string;
  subject?: string;
  sessionId?: string;
  type: 'access' | 'refresh';
  scope: string[];
  issuedAt: Date;
  expiresAt: Date;
  status: 'active' | 'revoked' | 'expired';
};

interface MockState {
  tenants: Array<TenantDocument & { oauth?: TenantOAuthConfig }>;
  clients: Array<{
    _id: string;
    tenantId: string;
    name: string;
    secretHash: string;
    grantTypes: string[];
    redirectUris?: string[];
    scopes: string[];
    isConfidential: boolean;
  }>;
  tokens: TokenDoc[];
  keyStore: Array<{
    kid: string;
    privateKey: string;
    publicKey: string;
    status: 'active' | 'inactive' | 'retired';
    algorithm: 'RS256';
    createdAt?: Date;
    rotatedAt?: Date | null;
  }>;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function createMockDeps(state: MockState): OAuthServerDependencies {
  return {
    getMasterConnection: async () => ({
      startSession: () => ({
        withTransaction: async (fn: () => Promise<void>) => { await fn(); },
        endSession: () => {}
      })
    }) as any,
    makeModels: () => ({
      Tenant: {
        findOne: (query: any) => ({
          lean: () => ({
            exec: async () => {
              return state.tenants.find((tenant) => {
                const idMatches = query._id ? tenant._id === query._id : true;
                const statusMatches = query.status ? tenant.status === query.status : true;
                return idMatches && statusMatches;
              }) ?? null;
            }
          })
        })
      },
      OAuthClient: {
        findById: (id: string) => ({
          lean: () => ({
            exec: async () => clone(state.clients.find((client) => client._id === id) ?? null)
          })
        })
      },
      OAuthToken: {
        countDocuments: (query: any) => ({
          exec: async () => state.tokens.filter((token) => {
            const tenantMatches = token.tenantId === query.tenantId;
            const typeMatches = query.type ? token.type === query.type : true;
            const issuedAfter = query.issuedAt?.$gte ? token.issuedAt >= query.issuedAt.$gte : true;
            return tenantMatches && typeMatches && issuedAfter;
          }).length
        }),
        create: async (payload: any) => {
          const docs = Array.isArray(payload) ? payload : [payload];
          docs.forEach((doc) => state.tokens.push({ ...doc }));
          return Array.isArray(payload) ? docs : docs[0];
        }
      },
      KeyStore: {
        findOne: (query: any) => ({
          sort: () => ({
            lean: () => ({
              exec: async () => {
                const candidates = state.keyStore
                  .filter((key) => (query.status ? key.status === query.status : true))
                  .sort((a, b) => ((b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)));
                return candidates.length ? { ...candidates[0] } : null;
              }
            })
          })
        }),
        find: (query: any) => ({
          lean: () => ({
            exec: async () => state.keyStore
              .filter((key) => (query.status?.$in ? query.status.$in.includes(key.status) : true))
              .map((key) => ({ ...key }))
          })
        }),
        create: async (payload: any) => {
          const docs = Array.isArray(payload) ? payload : [payload];
          docs.forEach((doc) => state.keyStore.push({
            ...doc,
            createdAt: doc.createdAt ?? new Date(),
            rotatedAt: doc.rotatedAt ?? null
          }));
          return Array.isArray(payload) ? docs : docs[0];
        },
        updateMany: async (filter: any, update: any) => {
          state.keyStore.forEach((key) => {
            const matches = Object.entries(filter).every(([prop, value]) => (key as any)[prop] === value);
            if (matches) {
              Object.assign(key, update.$set ?? {});
            }
          });
        }
      },
      Session: {
        findById: () => ({ exec: async () => null })
      }
    }),
    logger: {
      info: () => {},
      error: () => {}
    }
  };
}

function createInitialState(): MockState {
  return {
    tenants: [],
    clients: [],
    tokens: [],
    keyStore: []
  };
}

describe('OAuth server – client credentials grant', () => {
  let state: MockState;
  let oauthServer: ReturnType<typeof createOAuthServer>;

  beforeEach(() => {
    state = createInitialState();
    oauthServer = createOAuthServer(createMockDeps(state));
  });

  it('issues an access token when tenant and client are properly configured', async () => {
    state.tenants.push({
      _id: 'tenant-123',
      name: 'Test Tenant',
      status: 'active',
      oauth: {
        enabled: true,
        allowedGrantTypes: ['client_credentials'],
        allowedScopes: ['telemetry:read']
      }
    } as any);

    state.clients.push({
      _id: 'client-1',
      tenantId: 'tenant-123',
      name: 'CI client',
      secretHash: hashSecret('top-secret'),
      grantTypes: ['client_credentials'],
      scopes: ['telemetry:read'],
      redirectUris: [],
      isConfidential: true
    });

    const result = await oauthServer.issueClientCredentialsToken({
      clientId: 'client-1',
      clientSecret: 'top-secret',
      scope: ['telemetry:read']
    });

    expect(result.tokenType).toBe('Bearer');
    expect(result.expiresIn).toBeGreaterThan(0);
    expect(result.scope).toEqual(['telemetry:read']);
    expect(state.tokens).toHaveLength(1);
    expect(state.tokens[0].tenantId).toBe('tenant-123');

    const claims = decodeJwt(result.accessToken);
    expect(claims.tid).toBe('tenant-123');
    expect(claims.cid).toBe('client-1');
    expect(claims.scope).toBe('telemetry:read');
  });

  it('mints a product_runtime credential with per-client audience, subject and additive claims (US-0086)', () => {
    state.tenants.push({
      _id: 'tenant-rt',
      name: 'Runtime Tenant',
      status: 'active',
      oauth: { enabled: true, allowedGrantTypes: ['client_credentials'], allowedScopes: [] }
    } as any);
    state.clients.push({
      _id: 'gateway-ds1',
      tenantId: 'tenant-rt',
      name: 'sovereign-llm-gateway@ds1 runtime',
      secretHash: hashSecret('rt-secret'),
      grantTypes: ['client_credentials'],
      scopes: [],
      redirectUris: [],
      isConfidential: true,
      // Audience-bind the machine principal to the maestro workspace and carry the claims maestro
      // resolves its product_runtime on (its register matches by email; role is defence-in-depth).
      audience: 'maestro-workspace',
      subject: 'runtime@sovereign-llm-gateway.fps4.nl',
      claims: { role: 'product_runtime', email: 'runtime@sovereign-llm-gateway.fps4.nl' }
    } as any);

    return oauthServer.issueClientCredentialsToken({
      clientId: 'gateway-ds1',
      clientSecret: 'rt-secret'
    }).then((result) => {
      const claims = decodeJwt(result.accessToken);
      expect(claims.aud).toBe('maestro-workspace');                 // not the service-wide default
      expect(claims.sub).toBe('runtime@sovereign-llm-gateway.fps4.nl');
      expect(claims.role).toBe('product_runtime');
      expect(claims.email).toBe('runtime@sovereign-llm-gateway.fps4.nl');
      expect(claims.iss).toBeDefined();
      expect(claims.exp).toBeGreaterThan(0);
    });
  });

  it('never lets a stored claim override a registered/identity claim (US-0086)', () => {
    state.tenants.push({
      _id: 'tenant-rt2',
      name: 'Runtime Tenant 2',
      status: 'active',
      oauth: { enabled: true, allowedGrantTypes: ['client_credentials'], allowedScopes: [] }
    } as any);
    state.clients.push({
      _id: 'sneaky',
      tenantId: 'tenant-rt2',
      name: 'sneaky client',
      secretHash: hashSecret('s'),
      grantTypes: ['client_credentials'],
      scopes: [],
      redirectUris: [],
      isConfidential: true,
      audience: 'maestro-workspace',
      subject: 'runtime@x',
      // Reserved claims smuggled into the additive map must lose to the controlled/signed values.
      claims: { aud: 'someone-else', sub: 'impersonated', iss: 'evil' }
    } as any);

    return oauthServer.issueClientCredentialsToken({
      clientId: 'sneaky',
      clientSecret: 's'
    }).then((result) => {
      const claims = decodeJwt(result.accessToken);
      expect(claims.aud).toBe('maestro-workspace');
      expect(claims.sub).toBe('runtime@x');
      expect(claims.iss).not.toBe('evil');
    });
  });

  it('rejects tokens when tenant OAuth is disabled', async () => {
    state.tenants.push({
      _id: 'tenant-off',
      name: 'Off Tenant',
      status: 'active',
      oauth: { enabled: false }
    } as any);

    state.clients.push({
      _id: 'client-2',
      tenantId: 'tenant-off',
      name: 'Disabled Client',
      secretHash: hashSecret('secret'),
      grantTypes: ['client_credentials'],
      scopes: ['telemetry:read'],
      isConfidential: true
    });

    await expect(oauthServer.issueClientCredentialsToken({
      clientId: 'client-2',
      clientSecret: 'secret',
      scope: ['telemetry:read']
    })).rejects.toBeInstanceOf(UnauthorizedClientError);
  });

  it('rejects tokens when requested scope is not allowed for tenant', async () => {
    state.tenants.push({
      _id: 'tenant-scope',
      name: 'Scope Tenant',
      status: 'active',
      oauth: {
        enabled: true,
        allowedGrantTypes: ['client_credentials'],
        allowedScopes: ['telemetry:read']
      }
    } as any);

    state.clients.push({
      _id: 'client-3',
      tenantId: 'tenant-scope',
      name: 'Scope Client',
      secretHash: hashSecret('secret'),
      grantTypes: ['client_credentials'],
      scopes: ['telemetry:read', 'telemetry:write'],
      isConfidential: true
    });

    await expect(oauthServer.issueClientCredentialsToken({
      clientId: 'client-3',
      clientSecret: 'secret',
      scope: ['telemetry:write']
    })).rejects.toBeInstanceOf(InvalidScopeError);
  });

  it('enforces per-tenant rate limits', async () => {
    const issuedAt = new Date();
    state.tenants.push({
      _id: 'tenant-rate',
      name: 'Rate Tenant',
      status: 'active',
      oauth: {
        enabled: true,
        allowedGrantTypes: ['client_credentials'],
        allowedScopes: ['telemetry:read'],
        limits: { tokensPerMinute: 1 }
      }
    } as any);

    state.clients.push({
      _id: 'client-4',
      tenantId: 'tenant-rate',
      name: 'Rate Client',
      secretHash: hashSecret('secret'),
      grantTypes: ['client_credentials'],
      scopes: ['telemetry:read'],
      isConfidential: true
    });

    state.tokens.push({
      _id: 'token-existing',
      tenantId: 'tenant-rate',
      clientId: 'client-4',
      type: 'access',
      scope: ['telemetry:read'],
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 1000),
      status: 'active'
    });

    await expect(oauthServer.issueClientCredentialsToken({
      clientId: 'client-4',
      clientSecret: 'secret',
      scope: ['telemetry:read']
    })).rejects.toBeInstanceOf(RateLimitExceededError);
  });
});
