/**
 * MCP management server (ADR-0007). A thin Model Context Protocol adapter that exposes the SAME
 * management operations as the HTTP admin API — over the SAME service layer (`adminService`), the SAME
 * admin-auth model (a client-credentials token carrying an `admin`/`admin:<area>` scope), and the SAME
 * append-only audit trail. One authorization model, two transports (HTTP for humans/automation, MCP for
 * agents).
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdio (the MCP stdio transport). The agent that runs
 * this process must hold an admin credential and pass its access token as IDENTITY_SERVICE_ADMIN_TOKEN;
 * the token is verified at startup and its scopes gate each tool call exactly like the HTTP routes.
 *
 * Run: `IDENTITY_SERVICE_ADMIN_TOKEN=<access-token> npm run mcp`
 */
import { createInterface } from 'readline';
import { adminService } from '../container.js';
import { verifyAdminToken, principalHasScope, ADMIN_SCOPES, type AdminPrincipal } from '../core/admin-auth.js';
import { getMasterConnection, disconnect } from '../utils/db.js';
import { makeModels } from '../models/index.js';
import logger from '../utils/logger.js';

const SERVER_INFO = { name: 'identity-service-admin', version: '0.1.0' };
const DEFAULT_PROTOCOL = '2024-11-05';

interface ToolDef {
  name: string;
  description: string;
  areaScope: string;
  inputSchema: Record<string, unknown>;
  handler: (args: any) => Promise<unknown>;
}

const obj = (props: Record<string, unknown>, required: string[] = []) =>
  ({ type: 'object', properties: props, required, additionalProperties: true });
const str = { type: 'string' };
const strArr = { type: 'array', items: { type: 'string' } };

const TOOLS: ToolDef[] = [
  {
    name: 'list_tenants',
    description: 'List all tenants.',
    areaScope: ADMIN_SCOPES.tenants,
    inputSchema: obj({}),
    handler: () => adminService.listTenants()
  },
  {
    name: 'onboard_tenant',
    description: 'Create or update a tenant (idempotent upsert). Pass `id` to update an existing one.',
    areaScope: ADMIN_SCOPES.tenants,
    inputSchema: obj({ id: str, name: str, status: str, oauth: { type: 'object' } }, ['name']),
    handler: (a) => adminService.upsertTenant(a)
  },
  {
    name: 'create_client',
    description: 'Register an OAuth client under a tenant. Returns the generated client secret ONCE.',
    areaScope: ADMIN_SCOPES.clients,
    inputSchema: obj({ tenantId: str, name: str, grantTypes: strArr, scopes: strArr, redirectUris: strArr, audience: str }, ['tenantId', 'name', 'grantTypes']),
    handler: (a) => adminService.createClient(a)
  },
  {
    name: 'rotate_client_secret',
    description: 'Rotate a client secret. Returns the new secret ONCE.',
    areaScope: ADMIN_SCOPES.clients,
    inputSchema: obj({ clientId: str }, ['clientId']),
    handler: (a) => adminService.rotateClientSecret(a.clientId)
  },
  {
    name: 'create_user',
    description: 'Create a local-credential user under a tenant.',
    areaScope: ADMIN_SCOPES.users,
    inputSchema: obj({ tenantId: str, email: str, password: str, roles: strArr }, ['tenantId', 'email', 'password']),
    handler: (a) => adminService.createUser(a)
  },
  {
    name: 'reset_user_password',
    description: "Reset a user's password (also clears any brute-force lockout).",
    areaScope: ADMIN_SCOPES.users,
    inputSchema: obj({ tenantId: str, email: str, password: str }, ['tenantId', 'email', 'password']),
    handler: async (a) => { await adminService.resetUserPassword(a.tenantId, a.email, a.password); return { ok: true }; }
  },
  {
    name: 'set_user_status',
    description: "Set a user's status to 'active' or 'disabled'.",
    areaScope: ADMIN_SCOPES.users,
    inputSchema: obj({ tenantId: str, email: str, status: { type: 'string', enum: ['active', 'disabled'] } }, ['tenantId', 'email', 'status']),
    handler: async (a) => { await adminService.setUserStatus(a.tenantId, a.email, a.status); return { ok: true }; }
  },
  {
    name: 'unlock_user',
    description: 'Clear a brute-force lockout and reactivate a user.',
    areaScope: ADMIN_SCOPES.users,
    inputSchema: obj({ tenantId: str, email: str }, ['tenantId', 'email']),
    handler: async (a) => { await adminService.unlockUser(a.tenantId, a.email); return { ok: true }; }
  },
  {
    name: 'rotate_signing_key',
    description: 'Rotate the active RS256 signing key (the previous key stays published in the JWKS).',
    areaScope: ADMIN_SCOPES.keys,
    inputSchema: obj({}),
    handler: () => adminService.rotateKey()
  },
  {
    name: 'get_stats',
    description: 'Aggregate counts for tenants, clients, users, tokens, and keys.',
    areaScope: ADMIN_SCOPES.stats,
    inputSchema: obj({}),
    handler: () => adminService.getStats()
  }
];

async function writeAudit(principal: AdminPrincipal, action: string, ok: boolean, meta?: Record<string, unknown>): Promise<void> {
  try {
    const models = makeModels(await getMasterConnection());
    await models.AuditLog.create({
      at: new Date(),
      principalClientId: principal.clientId,
      principalSubject: principal.subject,
      principalTenantId: principal.tenantId,
      action: `mcp:${action}`,
      method: 'MCP',
      path: action,
      status: ok ? 200 : 500,
      meta
    });
  } catch (err) {
    logger.error({ err, action }, 'failed to write MCP audit log');
  }
}

// --- JSON-RPC over stdio ---

function send(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
function reply(id: unknown, result: unknown): void { send({ jsonrpc: '2.0', id, result }); }
function replyError(id: unknown, code: number, message: string): void { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handleToolCall(id: unknown, principal: AdminPrincipal, params: any): Promise<void> {
  const tool = TOOLS.find((t) => t.name === params?.name);
  if (!tool) return replyError(id, -32602, `Unknown tool: ${params?.name}`);

  // Same scope gate as the HTTP route — least-privilege agents only reach their granted areas.
  if (!principalHasScope(principal, tool.areaScope)) {
    void writeAudit(principal, tool.name, false, { denied: 'insufficient_scope' });
    return reply(id, { content: [{ type: 'text', text: `Forbidden: requires scope for ${tool.areaScope}` }], isError: true });
  }

  try {
    const result = await tool.handler(params?.arguments ?? {});
    void writeAudit(principal, tool.name, true);
    reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? 'tool failed';
    void writeAudit(principal, tool.name, false, { error: message });
    reply(id, { content: [{ type: 'text', text: `Error: ${message}` }], isError: true });
  }
}

async function main(): Promise<void> {
  const token = process.env.IDENTITY_SERVICE_ADMIN_TOKEN ?? '';
  if (!token) {
    logger.error('IDENTITY_SERVICE_ADMIN_TOKEN is required to run the MCP management server');
    process.exit(1);
  }
  let principal: AdminPrincipal;
  try {
    principal = await verifyAdminToken(token);
  } catch (err) {
    logger.error({ err }, 'admin token rejected — cannot start MCP server');
    process.exit(1);
    return;
  }
  logger.info({ clientId: principal.clientId, scopes: principal.scopes }, 'MCP management server ready');

  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: any;
    try { msg = JSON.parse(trimmed); } catch { return; }

    const { id, method, params } = msg;
    switch (method) {
      case 'initialize':
        reply(id, {
          protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO
        });
        break;
      case 'notifications/initialized':
        break; // notification, no response
      case 'tools/list':
        reply(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
        break;
      case 'tools/call':
        await handleToolCall(id, principal, params);
        break;
      case 'ping':
        reply(id, {});
        break;
      default:
        if (id !== undefined) replyError(id, -32601, `Method not found: ${method}`);
    }
  });

  const shutdown = async () => { await disconnect().catch(() => {}); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'MCP server crashed');
  process.exit(1);
});
