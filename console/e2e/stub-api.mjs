// A tiny stub of the /admin/v1 management plane for the Playwright smoke (RQ-0008). It serves just
// enough for the dashboard, tenants, and audit screens to render — and it asserts the request arrived
// with the operator's Bearer token (proving the console forwards it — ADR-0010). No persistence.
// Started by playwright.config.ts as a webServer.

import { createServer } from 'node:http';

const port = Number(process.argv[2] || 7399);

const STATS = {
  tenants: { total: 2, active: 2 },
  clients: { total: 3 },
  users: { total: 5, locked: 0, disabled: 1 },
  tokens: { accessLastHour: 4, accessLastDay: 42, activeRefresh: 7 },
  keys: { active: 1 },
  at: new Date(0).toISOString(),
};
const TENANTS = [
  { _id: 't1', name: 'Acme', status: 'active', oauth: { enabled: true, allowedGrantTypes: ['client_credentials'], allowedScopes: ['admin'] } },
];
const AUDIT = [
  { _id: 'a1', at: new Date(0).toISOString(), action: 'tenant.upsert', principalSubject: 'operator@fps4.nl', targetId: 't1', status: 200 },
];
// In-memory per-tenant stores so the detail page (and create flows) have something to render.
const CLIENTS = { t1: [{ _id: 'c1', tenantId: 't1', name: 'existing-svc', grantTypes: ['client_credentials'], scopes: ['admin'] }] };
const USERS = { t1: [{ _id: 'u1', tenantId: 't1', email: 'user@acme.com', status: 'active', roles: ['member'], identities: [{ provider: 'google', subject: 'g-seed-1', email: 'user@acme.com', emailVerified: true }] }] };

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

const server = createServer(async (req, res) => {
  // The console must forward a Bearer token (the seeded operator JWT). Reject if missing.
  const auth = req.headers['authorization'] ?? '';
  if (!auth.startsWith('Bearer ')) return send(res, 401, { error: 'unauthorized' });

  const url = new URL(req.url, `http://localhost:${port}`);
  const path = url.pathname.replace(/^\/admin\/v1/, '');
  const method = req.method ?? 'GET';

  if (method === 'GET' && path === '/stats') return send(res, 200, STATS);
  if (method === 'GET' && path === '/tenants') return send(res, 200, { tenants: TENANTS });
  if (method === 'GET' && path === '/audit') return send(res, 200, { entries: AUDIT });

  // --- Tenant detail drill-down ---
  let m;
  if (method === 'GET' && (m = path.match(/^\/tenants\/([^/]+)$/))) {
    // 'boom' simulates a transient backend failure so the graceful error path can be tested.
    if (m[1] === 'boom') return send(res, 500, { error: 'server_error', error_description: 'simulated backend failure' });
    const t = TENANTS.find((x) => x._id === m[1]);
    return t ? send(res, 200, t) : send(res, 404, { error: 'tenant_not_found' });
  }
  if (method === 'GET' && (m = path.match(/^\/tenants\/([^/]+)\/clients$/))) {
    return send(res, 200, { clients: CLIENTS[m[1]] ?? [] });
  }
  if (method === 'GET' && (m = path.match(/^\/tenants\/([^/]+)\/users$/))) {
    return send(res, 200, { users: USERS[m[1]] ?? [] });
  }

  // --- Mutations ---
  if (method === 'POST' && path === '/clients') {
    const body = await readBody(req);
    const id = `new-${(CLIENTS[body.tenantId]?.length ?? 0) + 1}`;
    (CLIENTS[body.tenantId] ??= []).push({ _id: id, tenantId: body.tenantId, name: body.name, grantTypes: body.grantTypes ?? [], scopes: body.scopes ?? [] });
    return send(res, 201, { clientId: id, secret: 'stub-secret-shown-once-deadbeef' });
  }
  if (method === 'POST' && (m = path.match(/^\/clients\/([^/]+)\/rotate-secret$/))) {
    return send(res, 200, { clientId: m[1], secret: 'stub-secret-rotated-00000000' });
  }
  if (method === 'DELETE' && (m = path.match(/^\/clients\/([^/]+)$/))) {
    return send(res, 200, { clientId: m[1], deleted: true });
  }
  if (method === 'POST' && path === '/users') {
    const body = await readBody(req);
    (USERS[body.tenantId] ??= []).push({ _id: 'nu', tenantId: body.tenantId, email: body.email, status: 'active', roles: body.roles ?? [], identities: [] });
    return send(res, 201, { id: 'nu', email: body.email, tenantId: body.tenantId });
  }
  if (method === 'POST' && path === '/users/link-identity') {
    const body = await readBody(req);
    const u = (USERS[body.tenantId] ?? []).find((x) => x.email === body.email);
    if (!u) return send(res, 404, { error: 'user_not_found', error_description: 'User not found' });
    (u.identities ??= []).push({ provider: 'google', subject: body.subject, email: body.identityEmail, emailVerified: !!body.emailVerified });
    return send(res, 200, { email: body.email, provider: 'google', subject: body.subject, linked: true });
  }
  if (method === 'POST' && path === '/users/unlink-identity') {
    const body = await readBody(req);
    const u = (USERS[body.tenantId] ?? []).find((x) => x.email === body.email);
    if (!u) return send(res, 404, { error: 'user_not_found', error_description: 'User not found' });
    u.identities = (u.identities ?? []).filter((i) => !(i.provider === 'google' && i.subject === body.subject));
    return send(res, 200, { email: body.email, provider: 'google', subject: body.subject, unlinked: true });
  }

  return send(res, 404, { error: 'not_found' });
});

server.listen(port, () => console.log(`stub /admin/v1 on :${port}`));
