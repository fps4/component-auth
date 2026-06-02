import { describe, it, expect } from 'vitest';
import { parseSeedConfig, SeedConfigError } from '../src/services/seed-config.js';

const base = {
  tenants: [{
    id: 'demo', name: 'Demo Tenant', status: 'active',
    oauth: { enabled: true, allowedGrantTypes: ['password'], idp: { provider: 'local' } },
    clients: [{ id: 'demo-web', grantTypes: ['password'], audience: 'demo-workspace' }],
    users: [{ email: 'Demo@FPS4.nl', password: '${SEED_DEMO_PASSWORD}' }]
  }]
};

describe('parseSeedConfig (RQ-0004)', () => {
  it('parses a valid config, interpolates env, and normalizes the email', () => {
    const cfg = parseSeedConfig(base, { SEED_DEMO_PASSWORD: 'correct-horse-battery' });
    const t = cfg.tenants[0];
    expect(t.id).toBe('demo');
    expect(t.clients[0].audience).toBe('demo-workspace');
    expect(t.users[0].email).toBe('demo@fps4.nl');           // lowercased
    expect(t.users[0].password).toBe('correct-horse-battery'); // ${ENV} resolved
  });

  it('throws when a referenced env var is unset', () => {
    expect(() => parseSeedConfig(base, {})).toThrowError(/SEED_DEMO_PASSWORD/);
  });

  it('requires an audience for the password grant', () => {
    const bad = { tenants: [{ id: 't', name: 'T', oauth: { enabled: true, allowedGrantTypes: ['password'] },
      clients: [{ id: 'c', grantTypes: ['password'] }] }] };
    expect(() => parseSeedConfig(bad, {})).toThrowError(/audience/);
  });

  it('rejects users on a tenant that has not enabled the local IdP', () => {
    const bad = { tenants: [{ id: 't', name: 'T',
      oauth: { enabled: true, allowedGrantTypes: ['password'] }, // no idp: local
      users: [{ email: 'u@x.test', password: 'correct-horse-battery' }] }] };
    expect(() => parseSeedConfig(bad, {})).toThrowError(/local IdP/);
  });

  it('rejects an empty tenants array', () => {
    expect(() => parseSeedConfig({ tenants: [] })).toBeInstanceOf;
    expect(() => parseSeedConfig({ tenants: [] })).toThrow(SeedConfigError);
  });

  it('rejects an invalid user email', () => {
    const bad = { tenants: [{ id: 't', name: 'T',
      oauth: { enabled: true, allowedGrantTypes: ['password'], idp: { provider: 'local' } },
      users: [{ email: 'not-an-email', password: 'correct-horse-battery' }] }] };
    expect(() => parseSeedConfig(bad, {})).toThrowError(/valid email/);
  });

  // RQ-0005 — user roles
  it('parses user roles and the tenant allowedRoles vocabulary', () => {
    const cfg = parseSeedConfig({ tenants: [{ id: 't', name: 'T',
      oauth: { enabled: true, allowedGrantTypes: ['password'], idp: { provider: 'local' }, allowedRoles: ['tenant_admin', 'member'] },
      users: [{ email: 'a@x.test', password: 'correct-horse-battery', roles: ['tenant_admin'] }] }] }, {});
    expect(cfg.tenants[0].oauth.allowedRoles).toEqual(['tenant_admin', 'member']);
    expect(cfg.tenants[0].users[0].roles).toEqual(['tenant_admin']);
  });

  it('defaults roles to an empty array when omitted', () => {
    const cfg = parseSeedConfig({ tenants: [{ id: 't', name: 'T',
      oauth: { enabled: true, allowedGrantTypes: ['password'], idp: { provider: 'local' } },
      users: [{ email: 'a@x.test', password: 'correct-horse-battery' }] }] }, {});
    expect(cfg.tenants[0].users[0].roles).toEqual([]);
  });

  it('rejects a user role not in a non-empty tenant allowedRoles list', () => {
    const bad = { tenants: [{ id: 't', name: 'T',
      oauth: { enabled: true, allowedGrantTypes: ['password'], idp: { provider: 'local' }, allowedRoles: ['member'] },
      users: [{ email: 'a@x.test', password: 'correct-horse-battery', roles: ['superuser'] }] }] };
    expect(() => parseSeedConfig(bad, {})).toThrowError(/superuser/);
  });

  it('accepts any role when allowedRoles is empty or absent', () => {
    const cfg = parseSeedConfig({ tenants: [{ id: 't', name: 'T',
      oauth: { enabled: true, allowedGrantTypes: ['password'], idp: { provider: 'local' } },
      users: [{ email: 'a@x.test', password: 'correct-horse-battery', roles: ['anything-goes'] }] }] }, {});
    expect(cfg.tenants[0].users[0].roles).toEqual(['anything-goes']);
  });
});
