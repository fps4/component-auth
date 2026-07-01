# @fps4/identity-service-react

Optional React UI for [identity-service](../README.md) — a drop-in `<Login/>` for consumer apps
(RQ-0003 / [ADR-0002](../docs/design/decisions/0002-optional-react-ui-package.md)).

This package is **separate from the headless `@fps4/identity-service-sdk` SDK** on purpose: server-side
consumers (e.g. the client-credentials grant) never pull in React. It depends only on React (peer);
it talks to identity-service's HTTP API directly.

## Install

```bash
npm install @fps4/identity-service-react react
```

## Usage

```tsx
import { Login } from '@fps4/identity-service-react';

export function LoginPage() {
  return (
    <Login
      baseUrl="https://auth-dev.example.com"
      clientId="client-local"            // an OAuth client allowing the `password` grant + an audience
      onSuccess={(token) => {
        // Store + use the token; route guarding is the host app's concern.
        sessionStorage.setItem('access_token', token.accessToken);
        sessionStorage.setItem('refresh_token', token.refreshToken);
      }}
      onError={(err) => console.error(err)}
    />
  );
}
```

The component renders a minimal email/password form, performs the `password` grant, and hands the
issued token (`accessToken` + `refreshToken` + …) to `onSuccess`. **Token storage, route guarding,
and refresh are intentionally the host app's responsibility** — this is a login form, not a session
manager.

> Requires a tenant with the **local IdP** enabled (`oauth.idp.provider: 'local'` + the `password`
> grant) and a client with an `audience`. See [tenant-config](../docs/guides/tenant-config.md).

## Continue with Google (RQ-0012)

Pass `google` to render a "Continue with Google" button alongside (or instead of) the password form.
Google is a **redirect** flow, so the host app owns one callback route; the button stashes the PKCE
verifier and the callback completes the exchange:

```tsx
// login page
<Login
  baseUrl={baseUrl}
  clientId="coach-web"                         // client allowing `authorization_code` + an audience
  google={{ redirectUri: 'https://app.example.com/auth/callback' }}
  hidePasswordForm                             // optional: Google-only
  onSuccess={onSuccess}
/>

// app/auth/callback/page.tsx (the registered redirect_uri)
import { completeGoogleLoginFromRedirect } from '@fps4/identity-service-react';
const token = await completeGoogleLoginFromRedirect({
  baseUrl, clientId: 'coach-web', redirectUri: 'https://app.example.com/auth/callback',
});
// store token.accessToken, then navigate into the app
```

> Requires the client to allow the **`authorization_code`** grant with the `redirectUri` registered,
> the tenant's Google IdP configured, and the deployment's Google app env set. See
> [tenant-config](../docs/guides/tenant-config.md) and [RQ-0012](../docs/product/RQ-0012-react-google-login.md).

## Styling

Works unstyled-but-usable out of the box (neutral inline styles). For Tailwind / shadcn / any design
system, pass `classNames` per element and `unstyled` to drop the inline defaults:

```tsx
<Login
  baseUrl={baseUrl}
  clientId="client-local"
  unstyled
  classNames={{ form: 'space-y-4', input: 'input', button: 'btn btn-primary', error: 'text-red-600' }}
  onSuccess={onSuccess}
/>
```

## API

- `<Login baseUrl clientId onSuccess [onError title submitLabel emailLabel passwordLabel className classNames unstyled fetchImpl google hidePasswordForm] />`
- `requestPasswordToken({ baseUrl, clientId, username, password, fetchImpl? })` — the underlying call, for custom UIs.
- `beginGoogleLogin(req)` / `completeGoogleLogin(req)` — pure helpers (build authorize URL + PKCE / exchange code).
- `startGoogleLoginRedirect(req)` / `completeGoogleLoginFromRedirect(req)` — turnkey redirect helpers (stash + navigate / read URL + validate state + exchange), used by the `<Login/>` button.
- `LoginError` — thrown on a rejected login (carries `status`).
