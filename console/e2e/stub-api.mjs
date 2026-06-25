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
const TENANTS = [{ _id: 't1', name: 'Acme', status: 'active' }];
const AUDIT = [
  { _id: 'a1', at: new Date(0).toISOString(), action: 'tenant.upsert', principalSubject: 'operator@fps4.nl', targetId: 't1', status: 200 },
];

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  // The console must forward a Bearer token (the seeded operator JWT). Reject if missing.
  const auth = req.headers['authorization'] ?? '';
  if (!auth.startsWith('Bearer ')) return send(res, 401, { error: 'unauthorized' });

  const url = new URL(req.url, `http://localhost:${port}`);
  const path = url.pathname.replace(/^\/admin\/v1/, '');

  if (path === '/stats') return send(res, 200, STATS);
  if (path === '/tenants') return send(res, 200, { tenants: TENANTS });
  if (path === '/audit') return send(res, 200, { entries: AUDIT });
  return send(res, 404, { error: 'not_found' });
});

server.listen(port, () => console.log(`stub /admin/v1 on :${port}`));
