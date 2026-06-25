import type { BrowserContext } from '@playwright/test';

// e2e auth seed (RQ-0008). The console is gated by middleware on the session cookie and forwards the
// token as `Authorization: Bearer` to /admin/v1. For the smoke we mint an UNSIGNED fake JWT: middleware
// only decodes `exp` (no signature check) and the stubbed plane does not verify, so a dummy signature is
// fine. A real token is verified against the JWKS by the service (covered by the service test suite).

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

export const OPERATOR_EMAIL = 'operator@fps4.nl';

// exp far in the future (year 2099) so the gate always passes during the run; roles carry the operator
// role so a real plane would accept it too (ADR-0010).
export const FAKE_JWT = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
  email: OPERATOR_EMAIL,
  sub: 'operator',
  roles: ['platform_admin'],
  exp: 4070908800,
})}.sig`;

export async function seedAuth(context: BrowserContext, baseURL: string): Promise<void> {
  await context.addCookies([{ name: 'ids_console_at', value: FAKE_JWT, url: baseURL }]);
}
