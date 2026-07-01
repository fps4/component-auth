'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface ActionResult { ok: boolean; message?: string; secret?: string; }

const run = async (fn: () => Promise<ActionResult>): Promise<ActionResult> => {
  try { return await fn(); }
  catch (e) {
    const msg = e instanceof ApiError ? e.message : 'Request failed';
    return { ok: false, message: msg };
  }
};

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const list = (fd: FormData, k: string) => s(fd, k).split(',').map((x) => x.trim()).filter(Boolean);

/** Refresh the tenant pages a mutation touches: the list, and the tenant's detail drill-down. */
const revalidateTenant = (tenantId?: string) => {
  revalidatePath('/tenants');
  if (tenantId) revalidatePath(`/tenants/${tenantId}`);
};

export async function onboardTenant(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const provider = s(fd, 'provider'); // '' | 'local' | 'google'
    const oauth = provider
      ? { enabled: true, allowedGrantTypes: provider === 'local' ? ['password'] : ['authorization_code'], idp: { provider } }
      : undefined;
    const tenant = await api.upsertTenant({ id: s(fd, 'id') || undefined, name: s(fd, 'name'), oauth });
    revalidateTenant(tenant._id);
    return { ok: true, message: 'Tenant saved' };
  });
}

/** Suspend or re-activate a tenant (soft lifecycle — we never hard-delete a tenant). */
export async function setTenantStatus(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const id = s(fd, 'id');
    const status = s(fd, 'status'); // 'active' | 'suspended'
    await api.upsertTenant({ id, name: s(fd, 'name'), status });
    revalidateTenant(id);
    return { ok: true, message: `Tenant ${status}` };
  });
}

export async function createClient(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const tenantId = s(fd, 'tenantId');
    const res = await api.createClient({
      tenantId,
      name: s(fd, 'name'),
      grantTypes: list(fd, 'grantTypes'),
      scopes: list(fd, 'scopes'),
      redirectUris: list(fd, 'redirectUris'),
      audience: s(fd, 'audience') || undefined,
      subject: s(fd, 'subject') || undefined,
      isConfidential: s(fd, 'isConfidential') !== 'false'
    });
    revalidateClient(tenantId);
    return { ok: true, message: `Client ${res.clientId} created`, secret: res.secret };
  });
}

export async function rotateClientSecret(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const res = await api.rotateClientSecret(s(fd, 'clientId'));
    revalidateClient(s(fd, 'tenantId'));
    return { ok: true, message: 'Secret rotated', secret: res.secret };
  });
}

export async function deleteClient(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await api.deleteClient(s(fd, 'clientId'));
    revalidateClient(s(fd, 'tenantId'));
    return { ok: true, message: 'Client deleted' };
  });
}

const revalidateClient = (tenantId?: string) => {
  revalidatePath('/clients');
  if (tenantId) revalidatePath(`/tenants/${tenantId}`);
};

export async function createUser(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const tenantId = s(fd, 'tenantId');
    await api.createUser({ tenantId, email: s(fd, 'email'), password: s(fd, 'password'), roles: list(fd, 'roles') });
    revalidateUser(tenantId);
    return { ok: true, message: 'User created' };
  });
}

export async function resetPassword(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await api.resetPassword({ tenantId: s(fd, 'tenantId'), email: s(fd, 'email'), password: s(fd, 'password') });
    return { ok: true, message: 'Password reset' };
  });
}

export async function setUserStatus(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const tenantId = s(fd, 'tenantId');
    await api.setUserStatus({ tenantId, email: s(fd, 'email'), status: s(fd, 'status') });
    revalidateUser(tenantId);
    return { ok: true, message: `User ${s(fd, 'status')}` };
  });
}

export async function unlockUser(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const tenantId = s(fd, 'tenantId');
    await api.unlockUser({ tenantId, email: s(fd, 'email') });
    revalidateUser(tenantId);
    return { ok: true, message: 'User unlocked' };
  });
}

export async function deleteUser(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const tenantId = s(fd, 'tenantId');
    await api.deleteUser({ tenantId, email: s(fd, 'email') });
    revalidateUser(tenantId);
    return { ok: true, message: 'User deleted' };
  });
}

/** Link a federated identity (Google) onto an existing user (RQ-0011). The operator counterpart to the
 *  automatic link-on-verified-email at login, for the ambiguous cases the system won't merge itself. */
export async function linkIdentity(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const tenantId = s(fd, 'tenantId');
    await api.linkIdentity({
      tenantId,
      email: s(fd, 'email'),
      provider: 'google',
      subject: s(fd, 'subject'),
      identityEmail: s(fd, 'identityEmail') || undefined,
    });
    revalidateUser(tenantId);
    return { ok: true, message: 'Identity linked' };
  });
}

/** Remove a linked federated identity from a user (RQ-0011). */
export async function unlinkIdentity(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const tenantId = s(fd, 'tenantId');
    await api.unlinkIdentity({ tenantId, email: s(fd, 'email'), provider: 'google', subject: s(fd, 'subject') });
    revalidateUser(tenantId);
    return { ok: true, message: 'Identity unlinked' };
  });
}

const revalidateUser = (tenantId?: string) => {
  revalidatePath('/users');
  if (tenantId) revalidatePath(`/tenants/${tenantId}`);
};

export async function rotateKey(_prev?: ActionResult, _fd?: FormData): Promise<ActionResult> {
  return run(async () => {
    const res = await api.rotateKey();
    return { ok: true, message: `Rotated — new kid ${res.kid}` };
  });
}
