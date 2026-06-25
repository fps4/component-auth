// Auth gate for the server-rendered console (RQ-0007, ADR-0010).
//
// The console renders pages on the Next server, which forwards the operator's token to
// /admin/v1 (lib/identity.ts). An unauthenticated request would therefore 401 *during
// SSR* — so we redirect to /login BEFORE the page renders. The token rides the session
// cookie (set by lib/auth on login); here we cheaply decode its `exp` (no signature
// check — the management plane verifies via JWKS) to treat an expired token as
// unauthenticated. /login then performs a silent refresh from the localStorage refresh
// token, or shows the password form.
//
// Ported from maestro-web's middleware (ADR-0019).

import { NextResponse, type NextRequest } from 'next/server';

const TOKEN_COOKIE = 'ids_console_at';
const LOGIN_PATH = '/login';

/** True when the JWT is present and not past `exp` (with a little leeway). */
function tokenIsFresh(jwt: string | undefined): boolean {
  if (!jwt) return false;
  const parts = jwt.split('.');
  if (parts.length < 2) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { exp?: number };
    if (!payload.exp) return false;
    return payload.exp * 1000 > Date.now() - 30_000;
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest): NextResponse {
  const fresh = tokenIsFresh(req.cookies.get(TOKEN_COOKIE)?.value);
  const onLogin = req.nextUrl.pathname === LOGIN_PATH;

  if (fresh) {
    // Already authenticated — keep operators out of the login screen.
    if (onLogin) {
      const next = req.nextUrl.searchParams.get('next') || '/';
      // Guard against open redirects: same-origin paths only.
      const dest = next.startsWith('/') && !next.startsWith('//') ? next : '/';
      return NextResponse.redirect(new URL(dest, req.url));
    }
    return NextResponse.next();
  }

  // Not authenticated. /login is public (it runs the silent refresh / password form).
  if (onLogin) return NextResponse.next();

  const loginUrl = new URL(LOGIN_PATH, req.url);
  loginUrl.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

// Gate everything except Next internals and static assets; the matcher keeps the
// middleware off `/_next/*`, the favicon, and files with an extension.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.[^/]+$).*)'],
};
