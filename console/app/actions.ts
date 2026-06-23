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

export async function onboardTenant(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const provider = s(fd, 'provider'); // '' | 'local' | 'google'
    const oauth = provider
      ? { enabled: true, allowedGrantTypes: provider === 'local' ? ['password'] : ['authorization_code'], idp: { provider } }
      : undefined;
    await api.upsertTenant({ id: s(fd, 'id') || undefined, name: s(fd, 'name'), oauth });
    revalidatePath('/tenants');
    return { ok: true, message: 'Tenant saved' };
  });
}

export async function createClient(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const grantTypes = s(fd, 'grantTypes').split(',').map((x) => x.trim()).filter(Boolean);
    const scopes = s(fd, 'scopes').split(',').map((x) => x.trim()).filter(Boolean);
    const res = await api.createClient({ tenantId: s(fd, 'tenantId'), name: s(fd, 'name'), grantTypes, scopes, audience: s(fd, 'audience') || undefined });
    revalidatePath('/clients');
    return { ok: true, message: `Client ${res.clientId} created`, secret: res.secret };
  });
}

export async function rotateClientSecret(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const res = await api.rotateClientSecret(s(fd, 'clientId'));
    revalidatePath('/clients');
    return { ok: true, message: 'Secret rotated', secret: res.secret };
  });
}

export async function createUser(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await api.createUser({ tenantId: s(fd, 'tenantId'), email: s(fd, 'email'), password: s(fd, 'password') });
    revalidatePath('/users');
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
    await api.setUserStatus({ tenantId: s(fd, 'tenantId'), email: s(fd, 'email'), status: s(fd, 'status') });
    return { ok: true, message: `User ${s(fd, 'status')}` };
  });
}

export async function unlockUser(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await api.unlockUser({ tenantId: s(fd, 'tenantId'), email: s(fd, 'email') });
    return { ok: true, message: 'User unlocked' };
  });
}

export async function rotateKey(_prev?: ActionResult, _fd?: FormData): Promise<ActionResult> {
  return run(async () => {
    const res = await api.rotateKey();
    return { ok: true, message: `Rotated — new kid ${res.kid}` };
  });
}
