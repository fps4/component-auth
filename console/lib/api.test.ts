import { describe, it, expect, vi, beforeEach } from 'vitest';

// Per-actor token forwarding is the RQ-0007 / ADR-0010 keystone on the console side: api.ts must send
// the signed-in OPERATOR's token to /admin/v1, falling back to the static break-glass token only when
// there is no operator session.

const { callerTokenMock } = vi.hoisted(() => ({ callerTokenMock: vi.fn() }));
vi.mock('@/lib/identity', () => ({ callerToken: callerTokenMock }));

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    text: async () => JSON.stringify(body),
  }));
  // @ts-expect-error - assigning a test double to the global fetch
  global.fetch = fetchMock;
  return fetchMock;
}

async function loadApi() {
  vi.resetModules();
  process.env.ADMIN_API_URL = 'http://admin.test/admin/v1';
  process.env.ADMIN_API_TOKEN = 'break-glass-token';
  return import('@/lib/api');
}

function authHeaderFrom(fetchMock: ReturnType<typeof mockFetchOnce>): string {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return (init.headers as Record<string, string>).Authorization;
}

describe('console api client — token forwarding (ADR-0010)', () => {
  beforeEach(() => {
    callerTokenMock.mockReset();
  });

  it('forwards the operator token when an operator is signed in', async () => {
    callerTokenMock.mockResolvedValue('operator-jwt');
    const fetchMock = mockFetchOnce({ tenants: [] });
    const { api } = await loadApi();

    await api.listTenants();

    expect(fetchMock).toHaveBeenCalledWith('http://admin.test/admin/v1/tenants', expect.anything());
    expect(authHeaderFrom(fetchMock)).toBe('Bearer operator-jwt');
  });

  it('falls back to the break-glass token when there is no operator session', async () => {
    callerTokenMock.mockResolvedValue(undefined);
    const fetchMock = mockFetchOnce({ tenants: [] });
    const { api } = await loadApi();

    await api.listTenants();

    expect(authHeaderFrom(fetchMock)).toBe('Bearer break-glass-token');
  });

  it('maps an API error body to ApiError (status + code preserved)', async () => {
    callerTokenMock.mockResolvedValue('operator-jwt');
    mockFetchOnce({ error: 'forbidden', error_description: 'nope' }, false, 403);
    const { api, ApiError } = await loadApi();

    await expect(api.getStats()).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'forbidden',
      message: 'nope',
    });
    await expect(api.getStats()).rejects.toBeInstanceOf(ApiError);
  });
});
