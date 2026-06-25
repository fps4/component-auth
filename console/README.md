# identity-service · admin console

Operator web console for the identity-service **management plane** (ADR-0007) — the human-facing third
surface alongside the HTTP `/admin/v1` API and the MCP server. Dashboards (statistics) plus management
screens for tenants, clients, users, signing-key rotation, and the audit log.

## Stack

Reuses the `sovereign-copilot/web` stack: **Next.js 15** (App Router, `output: standalone`) + React 19 +
TypeScript, **Tailwind + shadcn/ui** tokens, **vega-embed / vega-lite** for the charts, **sonner** for
toasts, **lucide-react** icons.

## How it talks to the API

The console is a **thin server-side client** over `/admin/v1` (`import 'server-only'` in `lib/api.ts`), so
no token ever reaches the browser. Reads happen in Server Components; mutations go through Server Actions
(`app/actions.ts`). No direct database access — same auth + audit path as any other API caller.

## Operator login & per-actor identity (RQ-0007, ADR-0010)

Operators **sign in** at `/login` with their identity-service credentials (OAuth `password` grant against
the local IdP — `lib/auth.ts`, ported from maestro-web). The access token is mirrored into a
server-readable cookie; `middleware.ts` gates every route on the token's `exp` and redirects to `/login`;
the session silently refreshes via the `refresh_token` grant. `lib/api.ts` then forwards **the operator's
token** to `/admin/v1`, so the management plane attributes each action to the **human** (the audit
`principalSubject`), not a shared machine client.

For the plane to accept an operator's user token, the operator must carry an **operator role** (default
`platform_admin`, configured via `ADMIN_OPERATOR_ROLES` on the service — ADR-0010). Grant it through the
controlled provisioning paths (seed-as-code / `manage-users`), never self-registration.

**Break-glass:** if no operator is signed in, `lib/api.ts` falls back to a static `ADMIN_API_TOKEN`
(client-credentials, **not** per-actor) for bootstrap / non-interactive use. Leave it blank to require
operator login.

## Run

```bash
cp .env.example .env   # set ADMIN_API_URL + the NEXT_PUBLIC_IDENTITY_SERVICE_* login vars
npm install
npm run dev            # http://localhost:7306
```

See `.env.example` for the operator-login vars (`NEXT_PUBLIC_IDENTITY_SERVICE_BASE`,
`NEXT_PUBLIC_IDENTITY_SERVICE_CLIENT_ID`) and the break-glass `ADMIN_API_TOKEN`.

## Tests (RQ-0008)

```bash
npm test               # vitest unit/component tests (jsdom) — Server Actions, the api token-forwarding
                       # path, and the login form. Runs in the DoD CI `console` job.
npm run build && npm run test:e2e   # Playwright smoke against a stubbed /admin/v1 (e2e/) — LOCAL:
                       # needs a browser (`npx playwright install chromium`); not yet wired into CI.
```

