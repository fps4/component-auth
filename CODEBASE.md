# Codebase overview

**identity-service** is a multi-tenant authentication building block shared across products. It is
onboarded as a managed product (`kind: component`, `product_type: technical`) under the shared
documentation standard. It is a standalone TypeScript service plus a lightweight SDK. It owns
**authentication** (who you are) only — consuming products keep their own **authorization** (what
you may do).

It is a standalone TypeScript service, a headless SDK, and an optional React UI package
(`@fps4/identity-service-react`) with a drop-in `<Login/>`.

It issues two kinds of JWT, both RS256-signed and verifiable via a published JWKS:

- **Machine tokens** — `client_credentials` grant; claims `tid` / `cid` / `sid` / `scope`.
- **User identity tokens** — Google SSO via OIDC Authorization Code + PKCE (RQ-0001) **or** a local
  email/password IdP (RQ-0002); claims `email` + a stable `sub` + `iss` + a consumer-bound `aud` +
  `exp`/`iat`, plus an optional coarse **`roles`** array (RQ-0005) that consumers map to permissions
  (identity-service asserts roles but does not enforce them — ADR-0005). Both IdPs issue the same token;
  the IdP is a per-tenant choice.

## Directory map

| Path | Purpose |
|------|---------|
| `service/` | The Express API + Docker assets. Stateless container; MongoDB is the only persistent dependency. |
| `service/src/oauth/` | OAuth server core: `server.ts` (grant logic — extension point for new grants), `google.ts` (upstream Google OIDC adapter), `pkce.ts`, `errors.ts`, `types.ts`. |
| `service/src/routes/` | HTTP surface: `oauth-routes.ts` (`/oauth2/*`), `session-routes.ts` (legacy `/v1/*`), `admin-routes.ts` (`/admin/v1/*` management plane — ADR-0007). |
| `service/src/mcp/` | `server.ts` — MCP management server (stdio JSON-RPC, `npm run mcp`) exposing the admin operations as agent tools, over the same service layer + admin-auth + audit (ADR-0007). |
| `service/src/core/` | JWT signing helpers, the session authorizer, and `admin-auth.ts` (verifies admin client-credentials tokens + scopes — ADR-0007). |
| `service/src/models/` | Mongoose models: tenant, oauth-client, oauth-token, oauth-authorization, user, session, key-store, audit-log (ADR-0007). |
| `service/src/services/` | `users.ts` — local-credential registration (RQ-0002); `admin.ts` — management operations for tenants/clients/users/keys + stats (ADR-0007). |
| `service/scripts/` | Operator CLIs: `manage-users.ts` (create/reset/lock/unlock/disable users) and `seed.ts` (idempotent `npm run seed` loader — RQ-0004). |
| `config/` | `seed.example.yaml` (committed template) → `config/seed.yaml` (gitignored): tenants + clients + users for seed provisioning. |
| `service/src/utils/` | Key store (RSA generate/rotate + JWKS), db, hashing, CORS, logging. |
| `service/tests/` | Vitest suites (dependency-injected, no network/DB). |
| `sdk/` | Headless TypeScript client: `requestClientCredentialsToken` + the Google login helpers (`beginGoogleLogin` / `completeGoogleLogin` / `refreshUserToken` / `revokeUserToken`) + `registerWithPassword` / `loginWithPassword`. No UI; safe server-side. |
| `react/` | **Optional** React UI package `@fps4/identity-service-react` — a drop-in `<Login/>` (password) for consumer apps (RQ-0003 / ADR-0002). Separate package so server-side consumers never pull in React. |
| `console/` | **Operator** admin console (Next.js, `@fps4/identity-service-console` — ADR-0007). Thin server-side client over `/admin/v1`: dashboards + tenant/client/user management. Distinct from the consumer `<Login/>` widget. |
| `docker/` | Compose base + dev/prod overlays; `backup.sh` (nightly encrypted backups) + `migrate-rename-ds1.sh`. Deploys are manual over SSH to a Docker host (see `docs/guides/deployment.md`). |
| `docs/` | Two-plane docs: `design/` (architecture + ADRs), `reference/` (API), `guides/` (tenant-config, deployment), `product/` (RQ specs). Index: `docs/README.md`. |

## Entry points

- **Machine token (in):** `POST /oauth2/token` (`grant_type=client_credentials`) → `oauthServer.issueClientCredentialsToken`.
- **User login — Google (in):** `GET /oauth2/authorize` → Google → `GET /oauth2/callback` → consumer redirect with a code → `POST /oauth2/token` (`grant_type=authorization_code` + PKCE) → user JWT + refresh token.
- **User login — local (in):** `POST /v1/tenants/:id/register` then `POST /oauth2/token` (`grant_type=password`) → the same user JWT + refresh token (RQ-0002).
- **Token refresh / revoke (in):** `POST /oauth2/token` (`grant_type=refresh_token`); `POST /oauth2/revoke`.
- **Verification (out):** consumers fetch `GET /.well-known/jwks.json` and verify tokens by `kid` (e.g. maestro's JWT verifier at its authenticated edge).
- **Boot:** `service/src/server.ts` → `bootstrap()`.

## Naming notes

- **tenant** — a product/org that opts into OAuth; owns clients, scopes, rate limits, and (for user login) the Google IdP marker.
- **client** — a registered consumer of a tenant; carries `grantTypes`, `redirectUris`, `scopes`, and (for user tokens) an `audience`.
- **audience (`aud`)** — the consumer/workspace a user token is bound to; a token minted for one is not valid for another.

## Out of scope

- **Authorization / roles** — owned by the consuming product, never mirrored here.
- **Non-Google IdPs / magic-link** — deferred (RQ-0001 out of scope).
- **The consumer's login UI** — the SDK helper is shipped here; the UI lands in the consumer.
