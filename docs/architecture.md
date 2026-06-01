# Component Auth Architecture

The **component-auth** platform separates authentication responsibilities into a configurable service and lightweight clients so that multiple products can authenticate users and devices in a consistent, tenant-aware way.

## Components

- **Service (`service/`)** – Node.js + Express API hosting OAuth 2.0 and legacy session endpoints. It validates tenants, persists sessions and token metadata in MongoDB, manages RSA signing keys, and issues JWT access tokens for downstream services.
- **SDK (`sdk/`)** – Minimal TypeScript client wrapping the HTTP surface (session helpers plus OAuth client-credentials helper).
- **Docs (`docs/`)** – Architecture, API, and configuration references to help consumers integrate quickly.

## High-Level Flow

1. A product backend requests an access token via `POST /oauth2/token` (client credentials). Legacy clients may still call `POST /v1/tenants/{tenantId}/sessions`.
2. The service validates the tenant, confirms OAuth is enabled for that tenant, checks client registration, and records token/session metadata.
3. JWT access tokens are signed with the active RSA key and embed tenant (`tid`), client (`cid`), optional session (`sid`), and scope claims.
4. Consumers attach the token to downstream API requests. Additional visitor context can be attached later via `PATCH /v1/sessions/{sessionId}`.

```
┌───────────────┐    /oauth2/token     ┌──────────────────┐
│ Client / SDK  │ ───────────────────▶ │ Component Auth Service │
└───────────────┘                      │  ├─ OAuth Server  │
         ▲                             │  ├─ Session Core  │
         │  Bearer token               │  └─ Key Manager   │
         │                             └────────┬─────────┘
         │                                      │
         │                                 MongoDB
         │                         (tenants, clients, sessions,
         │                          tokens, key_store, logs)
```

## Multi-Tenancy Model

- Each tenant document may opt into OAuth by providing an `oauth` configuration block (see [Tenant Configuration](tenant-config.md)).
- OAuth clients reference a single tenant; rate limits and scope policies are evaluated per tenant on every token issuance.
- Session metadata remains available for use cases that rely on `/v1/sessions`, and session IDs continue to flow through access tokens as `sid` when present.
- Allowed CORS origins are seeded from tenant documents and refreshed periodically (configurable interval).

## Deployment

- The service runs as a stateless container driven entirely by environment variables (`service/.env.example` documents all knobs).
- MongoDB is the only persistent dependency. `docker/compose.yaml` paired with the dev/prod overlays (`docker/compose.dev.yaml`, `docker/compose.prod.yaml`) provisions Mongo and the service for local development and the deployment workflow.
- RSA signing keys are stored in the `key_store` collection. Key rotation utilities mint new keys, demote the previous key to `inactive`, and expose the public JWKS at `/.well-known/jwks.json` for verifiers.

## OAuth 2.0 Architecture Highlights

- **Token Endpoint** (`/oauth2/token`) supports the client-credentials grant (machine tokens) and, for user login, the authorization-code (Google SSO via OIDC + PKCE — RQ-0001), refresh-token, and password (local email/password IdP — RQ-0002) grants. The browser legs are `/oauth2/authorize` and `/oauth2/callback`; `/oauth2/revoke` revokes a refresh token and its session; `/v1/tenants/:id/register` is local self-service registration. All user grants issue the same `email`+`sub` token. Additional grants plug into the OAuth server module.
- **Key Management** – Active keys are generated automatically; optional AES-256-GCM encryption at rest is available when `OAUTH_KEY_PASSPHRASE` is configured.
- **Data Collections**
  - `oauth_clients` – Registered clients per tenant (client secret hashes, grant types, redirect URIs, scopes).
  - `oauth_tokens` – Issued access and refresh token metadata (refresh tokens stored hashed) with rate-limit friendly indexes.
  - `oauth_authorizations` – Short-lived, TTL-swept user-login records (PKCE challenge + state + nonce, then the single-use code and captured identity) for the Google SSO flow.
  - `users` – Local-credential users (RQ-0002): per-tenant email, scrypt password hash, stable subject id, status, and brute-force lockout counters.
  - `key_store` – RSA key material with status flags for rotation and JWKS publishing.
- **Rate Limiting** – Tenants may override default token throughput (`tokensPerMinute`) and refresh-token budgets via their OAuth config.

## Extensibility

- Plug additional grant flows into `service/src/oauth/server.ts` and expose them via new routes under `/oauth2`.
- Add custom tenant validation or logging in `service/src/container.ts` by injecting decorators around the OAuth/session cores.
- Extend the SDK (or wrap it internally) to provide product-specific helpers for registration, consent management, etc.
- Review [Tenant Configuration](tenant-config.md) when onboarding new tenants; adjustments there ripple automatically to all grant flows.
