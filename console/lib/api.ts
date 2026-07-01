import 'server-only';
import { callerToken } from '@/lib/identity';

/**
 * Server-only client for the identity-service management API (ADR-0007, ADR-0010). The console is a thin
 * server-side proxy over /admin/v1 — no token ever reaches the browser.
 *
 * Per-actor (ADR-0010): each request forwards the signed-in OPERATOR's token (read from the session
 * cookie via lib/identity), so the management plane attributes the action to the human. Break-glass: if
 * there is no operator session, fall back to the static `ADMIN_API_TOKEN` (bootstrap / non-interactive),
 * which authenticates as a machine client and is NOT per-actor.
 */
const BASE = process.env.ADMIN_API_URL ?? 'http://localhost:7305/admin/v1';
const BREAK_GLASS_TOKEN = process.env.ADMIN_API_TOKEN ?? '';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = (await callerToken()) ?? BREAK_GLASS_TOKEN;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    cache: 'no-store'
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(body?.error_description ?? `Request failed (${res.status})`, res.status, body?.error);
  }
  return body as T;
}

export interface Stats {
  tenants: { total: number; active: number };
  clients: { total: number };
  users: { total: number; locked: number; disabled: number };
  tokens: { accessLastHour: number; accessLastDay: number; activeRefresh: number };
  keys: { active: number };
  at: string;
}
export interface Tenant { _id: string; name: string; status: string; region?: string; oauth?: TenantOAuth }
export interface TenantOAuth { enabled?: boolean; allowedGrantTypes?: string[]; allowedScopes?: string[]; idp?: { provider?: string } }
export interface Client { _id: string; tenantId: string; name: string; grantTypes: string[]; scopes: string[]; audience?: string; isConfidential?: boolean; redirectUris?: string[] }
export interface FederatedIdentity { provider: string; subject: string; email?: string; emailVerified?: boolean; linkedAt?: string }
export interface User { _id: string; tenantId: string; email: string; status: string; roles?: string[]; emailVerified?: boolean; lockedUntil?: string | null; failedAttempts?: number; identities?: FederatedIdentity[] }
export interface AuditEntry { _id: string; at: string; action: string; principalClientId?: string; targetId?: string; status: number }

export const api = {
  getStats: () => request<Stats>('/stats'),
  listTenants: () => request<{ tenants: Tenant[] }>('/tenants').then((r) => r.tenants),
  getTenant: (tenantId: string) => request<Tenant>(`/tenants/${tenantId}`),
  listClients: (tenantId: string) => request<{ clients: Client[] }>(`/tenants/${tenantId}/clients`).then((r) => r.clients),
  listUsers: (tenantId: string) => request<{ users: User[] }>(`/tenants/${tenantId}/users`).then((r) => r.users),
  recentAudit: (limit = 25) => request<{ entries: AuditEntry[] }>(`/audit?limit=${limit}`).then((r) => r.entries),

  upsertTenant: (body: Record<string, unknown>) => request<Tenant>('/tenants', { method: 'POST', body: JSON.stringify(body) }),
  createClient: (body: Record<string, unknown>) => request<{ clientId: string; secret: string }>('/clients', { method: 'POST', body: JSON.stringify(body) }),
  rotateClientSecret: (clientId: string) => request<{ clientId: string; secret: string }>(`/clients/${clientId}/rotate-secret`, { method: 'POST' }),
  deleteClient: (clientId: string) => request<{ clientId: string; deleted: true }>(`/clients/${clientId}`, { method: 'DELETE' }),
  createUser: (body: Record<string, unknown>) => request<{ id: string; email: string }>('/users', { method: 'POST', body: JSON.stringify(body) }),
  resetPassword: (body: Record<string, unknown>) => request<{ ok: boolean }>('/users/reset-password', { method: 'POST', body: JSON.stringify(body) }),
  setUserStatus: (body: Record<string, unknown>) => request<{ ok: boolean }>('/users/status', { method: 'POST', body: JSON.stringify(body) }),
  unlockUser: (body: Record<string, unknown>) => request<{ ok: boolean }>('/users/unlock', { method: 'POST', body: JSON.stringify(body) }),
  deleteUser: (body: Record<string, unknown>) => request<{ email: string; deleted: true }>('/users/delete', { method: 'POST', body: JSON.stringify(body) }),
  linkIdentity: (body: Record<string, unknown>) => request<{ email: string; provider: string; subject: string; linked: true }>('/users/link-identity', { method: 'POST', body: JSON.stringify(body) }),
  unlinkIdentity: (body: Record<string, unknown>) => request<{ email: string; provider: string; subject: string; unlinked: true }>('/users/unlink-identity', { method: 'POST', body: JSON.stringify(body) }),
  rotateKey: () => request<{ kid: string }>('/keys/rotate', { method: 'POST' })
};
