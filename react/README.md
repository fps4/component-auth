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

- `<Login baseUrl clientId onSuccess [onError title submitLabel emailLabel passwordLabel className classNames unstyled fetchImpl] />`
- `requestPasswordToken({ baseUrl, clientId, username, password, fetchImpl? })` — the underlying call, for custom UIs.
- `LoginError` — thrown on a rejected login (carries `status`).
