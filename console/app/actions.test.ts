import { describe, it, expect, vi, beforeEach } from 'vitest';

// Server Actions are the console's mutation path (each rides the operator token via lib/api). These
// cover the success and the ApiError-failure branch of the shared `run()` wrapper (RQ-0008).

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    upsertTenant: vi.fn(),
    createClient: vi.fn(),
    rotateClientSecret: vi.fn(),
    createUser: vi.fn(),
  },
}));

class FakeApiError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

vi.mock('@/lib/api', () => ({ api: apiMock, ApiError: FakeApiError }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe('console server actions', () => {
  beforeEach(() => {
    Object.values(apiMock).forEach((m) => m.mockReset());
  });

  it('onboardTenant maps a local provider to a password OAuth config and reports success', async () => {
    apiMock.upsertTenant.mockResolvedValue({ _id: 't1' });
    const { onboardTenant } = await import('@/app/actions');

    const res = await onboardTenant({ ok: false }, form({ name: 'Acme', provider: 'local' }));

    expect(res.ok).toBe(true);
    expect(apiMock.upsertTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Acme',
        oauth: expect.objectContaining({ enabled: true, idp: { provider: 'local' } }),
      }),
    );
  });

  it('createClient returns the one-time secret on success', async () => {
    apiMock.createClient.mockResolvedValue({ clientId: 'c-1', secret: 's3cr3t' });
    const { createClient } = await import('@/app/actions');

    const res = await createClient(
      { ok: false },
      form({ tenantId: 't1', name: 'svc', grantTypes: 'client_credentials', scopes: 'admin' }),
    );

    expect(res.ok).toBe(true);
    expect(res.secret).toBe('s3cr3t');
  });

  it('returns ok:false with the ApiError message on failure', async () => {
    apiMock.createUser.mockRejectedValue(new FakeApiError('email already exists', 409, 'duplicate'));
    const { createUser } = await import('@/app/actions');

    const res = await createUser({ ok: false }, form({ tenantId: 't1', email: 'a@b.com', password: 'pw' }));

    expect(res.ok).toBe(false);
    expect(res.message).toBe('email already exists');
  });
});
