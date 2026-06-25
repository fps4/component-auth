import 'server-only';

// Server-side operator token for outbound /admin/v1 requests (RQ-0007, ADR-0010).
//
// The browser obtains an identity-service JWT (lib/auth, password grant) and mirrors
// its access token into the session cookie. Server Components / Server Actions read it
// here and forward it as `Authorization: Bearer`; the management plane verifies it via
// JWKS and accepts it as an operator principal when its `roles` claim carries a
// configured operator role (ADR-0010). middleware.ts already redirected an
// unauthenticated request to /login, so a rendered page normally has a token.
//
// SERVER-ONLY. Don't import from a `'use client'` module.

import { cookies } from 'next/headers';

export const TOKEN_COOKIE = 'ids_console_at';

/** The operator's identity-service access token to forward to /admin/v1, if present. */
export async function callerToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(TOKEN_COOKIE)?.value?.trim() || undefined;
}
