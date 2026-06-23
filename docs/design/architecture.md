---
title: Architecture
summary: How identity-service is built — the service, SDK, React widget, and admin console; the token-issuance flow; multi-tenancy; and the authenticated management plane.
status: current
last_updated: 2026-06-23
owners: [architect]
related:
  - docs/reference/api.md
  - docs/guides/tenant-config.md
  - docs/overview.md
  - docs/design/decisions/0007-management-api-mcp-and-standalone-identity-service.md
---

# Architecture

The **identity-service** platform separates authentication responsibilities into a configurable service and lightweight clients so that multiple products can authenticate users and devices in a consistent, tenant-aware way.

## Components

- **Service (`service/`)** – Node.js + Express API hosting OAuth 2.0, legacy session endpoints, and the authenticated `/admin/v1` management plane. It validates tenants, persists sessions and token metadata in MongoDB, manages RSA signing keys, issues JWT access tokens for downstream services, and records every management mutation to an append-only audit log.
- **MCP server (`service/src/mcp/`)** – A stdio JSON-RPC server (`npm run mcp`) exposing the management operations as agent tools. A thin protocol adapter over the **same** service layer and the **same** admin-auth + audit path as the HTTP admin API — one authorization model, one audit trail, two transports (ADR-0007).
- **SDK (`sdk/`)** – Headless TypeScript client wrapping the HTTP surface: the OAuth client-credentials helper, the Google login helpers, and the local register/login helpers. No UI; safe server-side.
- **React (`react/`)** – Optional, opt-in package (`@fps4/identity-service-react`) shipping a drop-in `<Login/>` for the local IdP. Separate package so server-side consumers never pull in React.
- **Console (`console/`)** – Optional operator admin console (`@fps4/identity-service-console`, Next.js). A thin **server-side** client over `/admin/v1` — dashboards plus tenant/client/user/key management. Holds no DB credentials and never exposes the admin token to the browser (ADR-0007). Distinct from the consumer-facing `<Login/>`.
- **Docs (`docs/`)** – Architecture, API, and configuration references to help consumers integrate quickly.

## High-Level Flow

1. A product backend requests an access token via `POST /oauth2/token` (client credentials). Legacy clients may still call `POST /v1/tenants/{tenantId}/sessions`.
2. The service validates the tenant, confirms OAuth is enabled for that tenant, checks client registration, and records token/session metadata.
3. JWT access tokens are signed with the active RSA key and embed tenant (`tid`), client (`cid`), optional session (`sid`), and scope claims.
4. Consumers attach the token to downstream API requests. Additional visitor context can be attached later via `PATCH /v1/sessions/{sessionId}`.

```mermaid
flowchart LR
    client["Client / SDK"]
    subgraph svc["identity-service"]
        oauth["OAuth Server"]
        session["Session Core"]
        keys["Key Manager"]
    end
    db[("MongoDB<br/>tenants · clients · users · sessions<br/>tokens · authorizations · key_store · audit_logs")]
    admin["Operator / Agent"]
    subgraph mgmt["Management plane (ADR-0007)"]
        api["/admin/v1 (HTTP)"]
        mcp["MCP server"]
        console["Admin console (Next.js)"]
    end

    client -->|"POST /oauth2/token"| svc
    svc -->|"Bearer token"| client
    svc --> db
    admin -->|"admin-scoped token"| api
    admin -->|"MCP tools"| mcp
    console -->|"server-side"| api
    mgmt --> svc
```

## Multi-Tenancy Model

- Each tenant document may opt into OAuth by providing an `oauth` configuration block (see [Tenant Configuration](../guides/tenant-config.md)).
- OAuth clients reference a single tenant; rate limits and scope policies are evaluated per tenant on every token issuance.
- Session metadata remains available for use cases that rely on `/v1/sessions`, and session IDs continue to flow through access tokens as `sid` when present.
- Allowed CORS origins are seeded from tenant documents and refreshed periodically (configurable interval).

## Deployment

- The service runs as a stateless container driven entirely by environment variables (`service/.env.example` documents all knobs).
- MongoDB is the only persistent dependency. `docker/compose.yaml` paired with the dev/prod overlays (`docker/compose.dev.yaml`, `docker/compose.prod.yaml`) provisions Mongo and the service for local development and the deployment workflow.
- RSA signing keys are stored in the `key_store` collection. Key rotation utilities mint new keys, demote the previous key to `inactive`, and expose the public JWKS at `/.well-known/jwks.json` for verifiers.
- A scheduled nightly `mongodump` ships an **encrypted** snapshot off-host for point-in-time recovery (`docker/backup.sh`); seed-as-code (ADR-0006) remains the from-git definition floor. See the [deployment guide](../guides/deployment.md).

## OAuth 2.0 Architecture Highlights

- **Token Endpoint** (`/oauth2/token`) supports the client-credentials grant (machine tokens) and, for user login, the authorization-code (Google SSO via OIDC + PKCE — RQ-0001), refresh-token, and password (local email/password IdP — RQ-0002) grants. The browser legs are `/oauth2/authorize` and `/oauth2/callback`; `/oauth2/revoke` revokes a refresh token and its session; `/v1/tenants/:id/register` is local self-service registration. All user grants issue the same `email`+`sub` token. Additional grants plug into the OAuth server module.
- **Key Management** – Active keys are generated automatically; optional AES-256-GCM encryption at rest is available when `OAUTH_KEY_PASSPHRASE` is configured.
- **Data Collections**
  - `oauth_clients` – Registered clients per tenant (client secret hashes, grant types, redirect URIs, scopes).
  - `oauth_tokens` – Issued access and refresh token metadata (refresh tokens stored hashed) with rate-limit friendly indexes.
  - `oauth_authorizations` – Short-lived, TTL-swept user-login records (PKCE challenge + state + nonce, then the single-use code and captured identity) for the Google SSO flow.
  - `users` – Local-credential users (RQ-0002): per-tenant email, scrypt password hash, stable subject id, status, and brute-force lockout counters.
  - `key_store` – RSA key material with status flags for rotation and JWKS publishing.
  - `audit_logs` – Append-only record of every management-plane mutation (who/what/when/which tenant) — the per-actor accountability the admin plane provides (ADR-0007).
- **Rate Limiting** – Tenants may override default token throughput (`tokensPerMinute`) and refresh-token budgets via their OAuth config.

## Management plane (ADR-0007)

Day-2 operations — onboarding a tenant, registering or rotating a client, creating/locking a user,
rotating a signing key — run on an authenticated management plane mounted at `/admin/v1` (toggleable;
network-restricted, kept off the public token-issuance surface by default). Three faces sit on **one**
service layer (`service/src/services/admin.ts`):

- **HTTP admin API** (`service/src/routes/admin-routes.ts`) — idempotent, audited endpoints for tenants, clients, users, keys, plus aggregate `stats` and an `audit` query (feeds the console dashboards).
- **MCP server** (`service/src/mcp/server.ts`) — the same operations as agent tools over stdio JSON-RPC.
- **Admin console** (`console/`) — a thin server-side Next.js client over the HTTP API.

The plane reuses the **idempotent service layer** the seed loader already uses, so an API call and a
re-seed converge on the same state. Admin principals authenticate as ordinary `client_credentials`
clients whose token carries an `admin` scope (or a granular `admin:<area>` scope for least-privilege
agents), verified against this service's **own** JWKS (`service/src/core/admin-auth.ts`). Every mutation
is written to the `audit_logs` collection. This is the admin-auth layer whose **absence** ADR-0003 cited
as the reason to keep provisioning off the wire — built first, then the management surface exposed over it.

Seed-as-code (ADR-0003/0006) is retained but **demoted** to the bootstrap and disaster-recovery floor;
nightly encrypted off-host `mongodump` backups provide point-in-time recovery of runtime state (issued
tokens, authorizations, lockouts, key history, audit) that re-seeding from git cannot restore — see the
[deployment guide](../guides/deployment.md).

## Extensibility

- Plug additional grant flows into `service/src/oauth/server.ts` and expose them via new routes under `/oauth2`.
- Add custom tenant validation or logging in `service/src/container.ts` by injecting decorators around the OAuth/session cores.
- Extend the SDK (or wrap it internally) to provide product-specific helpers for registration, consent management, etc.
- Review [Tenant Configuration](../guides/tenant-config.md) when onboarding new tenants; adjustments there ripple automatically to all grant flows.
