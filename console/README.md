# identity-service · admin console

Operator web console for the identity-service **management plane** (ADR-0007) — the human-facing third
surface alongside the HTTP `/admin/v1` API and the MCP server. Dashboards (statistics) plus management
screens for tenants, clients, users, signing-key rotation, and the audit log.

## Stack

Reuses the `sovereign-copilot/web` stack: **Next.js 15** (App Router, `output: standalone`) + React 19 +
TypeScript, **Tailwind + shadcn/ui** tokens, **vega-embed / vega-lite** for the charts, **sonner** for
toasts, **lucide-react** icons.

## How it talks to the API

The console is a **thin server-side client** over `/admin/v1`. The admin bearer token lives only in
server env (`ADMIN_API_TOKEN`) and is attached in `lib/api.ts` (`import 'server-only'`), so it **never
reaches the browser**. Reads happen in Server Components; mutations go through Server Actions
(`app/actions.ts`). No direct database access — same auth + audit path as any other API caller.

## Run

```bash
cp .env.example .env   # set ADMIN_API_URL + ADMIN_API_TOKEN (an admin-scoped client-credentials token)
npm install
npm run dev            # http://localhost:7306
```

`ADMIN_API_TOKEN` must carry the `admin` scope (or the granular `admin:*` scopes). Mint it from an admin
OAuth client via `client_credentials` — see `.env.example`.
