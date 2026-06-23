---
title: Tenant Configuration Guide
summary: How to enable and configure OAuth 2.0 for a tenant in identity-service — the oauth block, defaults, and validation rules.
status: current
last_updated: 2026-06-23
owners: [architect]
related:
  - docs/reference/api.md
  - docs/design/architecture.md
  - docs/product/RQ-0001-workspace-user-identity-google-sso.md
---

# Tenant Configuration Guide

identity-service relies on tenant-scoped metadata stored in MongoDB. Enabling OAuth 2.0 for a tenant requires adding an `oauth` section to the tenant document. This guide explains the structure, recommended defaults, and validation rules enforced by the service.

## Minimal Tenant Document

```json
{
  "_id": "tenant-123",
  "name": "Telemetry Platform",
  "status": "active",
  "allowedOrigins": ["https://app.example.com"],
  "oauth": {
    "enabled": true,
    "allowedGrantTypes": ["client_credentials"],
    "allowedScopes": ["telemetry:read", "telemetry:write"],
    "limits": {
      "tokensPerMinute": 200,
      "refreshTokens": 10000,
      "clientCap": 50
    }
  }
}
```

### Fields

| Field | Description |
| --- | --- |
| `enabled` | Turns OAuth support on/off for the tenant. Tokens are refused when `false` or absent. |
| `allowedGrantTypes` | List of grants the tenant permits. Must include `client_credentials` for current flows. |
| `allowedScopes` | Optional allow-list of scopes. Requested scopes must belong to both the client and this list. Omit or set empty array to defer to client definitions. |
| `limits.tokensPerMinute` | Overrides the default access-token rate limit (default 200/min from environment). |
| `limits.refreshTokens` | Future use for refresh-token budgets (defaults from environment). |
| `limits.clientCap` | Optional cap on registered clients for the tenant (enforced by admin tooling). |

## Provisioning Steps

1. **Insert/Update Tenant Document**

   ```js
   db.tenants.updateOne(
     { _id: "tenant-123" },
     {
       $set: {
         name: "Telemetry Platform",
         status: "active",
         allowedOrigins: ["https://app.example.com"],
         oauth: {
           enabled: true,
           allowedGrantTypes: ["client_credentials"],
           allowedScopes: ["telemetry:read", "telemetry:write"],
           limits: { tokensPerMinute: 200, refreshTokens: 10000, clientCap: 50 }
         }
       }
     },
     { upsert: true }
   );
   ```

2. **Register OAuth Clients** – Insert records into `oauth_clients` with:
   - `_id` (omit to auto-generate a UUID client id, or provide your own)
   - `tenantId` (matching the tenant)
   - `secretHash` (use `hashSecret(plainSecret)` from `service/src/utils/hash.ts`)
   - `grantTypes` (subset of tenant `allowedGrantTypes`)
   - `scopes` (subset of tenant `allowedScopes`)

   ```js
   db.oauth_clients.insertOne({
     tenantId: "tenant-123",
     name: "Test Client",
     secretHash: "<hash of plain secret>",
     grantTypes: ["client_credentials"],
     scopes: ["telemetry:read"],
     isConfidential: true
   });
   ```

3. **Distribute Credentials** – Share the generated `client_id` (look up `_id` after insertion if you omitted it) and the plain secret with the product team. Encourage storing secrets in the product’s own secrets manager.

4. **Verify Token Issuance** – Run `POST /oauth2/token` with the registered credentials. Tokens are rejected unless all tenant validation checks pass.

## Validation Rules Enforced by the Service

- Tenant must exist with `status: "active"`.
- `oauth.enabled` must be `true`.
- `client_credentials` must be present in both the tenant’s `allowedGrantTypes` and the client’s `grantTypes`.
- Requested scopes must be allowed by both the tenant and client. If no scopes are requested, the service uses the client’s scopes (filtered by the tenant’s allow list).
- Rate limiting uses `limits.tokensPerMinute` when provided, otherwise the global default `OAUTH_TENANT_MAX_TOKENS_PER_MINUTE`.

Tenants without the `oauth` section continue to support legacy session issuance, but OAuth token requests will fail with `unauthorized_client`.

## User login via Google SSO (RQ-0001)

To let a consumer (e.g. the maestro workspace) authenticate humans through Google and receive a user
identity JWT, configure three things.

### 1. Service-level Google app (env)

A single Google OIDC app per deployment federates user login. Its credentials live in the service
environment, **never** in tenant documents:

```
GOOGLE_CLIENT_ID=...           # from Google Cloud Console
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://auth-dev.example.com/oauth2/callback   # register this on the Google app
AUTH_JWT_ISSUER=https://auth-dev.example.com                        # HTTPS issuer; becomes the token `iss`
```

### 2. Tenant opts into the grant

Add `authorization_code` to the tenant's `allowedGrantTypes` and mark the upstream IdP:

```js
db.tenants.updateOne(
  { _id: "tenant-maestro" },
  { $set: {
      status: "active",
      "oauth.enabled": true,
      "oauth.allowedGrantTypes": ["authorization_code"],
      "oauth.idp": { provider: "google" }   // declarative marker; secrets stay in env
  } },
  { upsert: true }
);
```

### 3. Register the consumer client with an audience + redirect URI

The client's **`audience`** is the load-bearing `aud` value stamped on every user token it mints —
it binds the token to one workspace. A user-login client is **public** (PKCE), so `isConfidential`
may be `false` and no secret is needed for the `authorization_code` exchange.

```js
db.oauth_clients.insertOne({
  _id: "client-maestro",
  tenantId: "tenant-maestro",
  name: "maestro web",
  grantTypes: ["authorization_code"],
  redirectUris: ["https://app.maestro.example.com/auth/callback"],  // exact-match validated
  audience: "maestro-workspace",                                    // → the token `aud`
  scopes: [],
  isConfidential: false,
  secretHash: ""                                                    // unused by PKCE
});
```

### Values to give the consumer

The consumer's JWT verifier must be configured to match what this service mints. maestro, for example,
sets these (`IDENTITY_SERVICE_*`) — a consuming product picks its own variable names:

| consumer env var | Value | Source |
| --- | --- | --- |
| `IDENTITY_SERVICE_JWKS_URL` | `https://auth-dev.example.com/.well-known/jwks.json` | this service's JWKS endpoint |
| `IDENTITY_SERVICE_ISSUER` | `https://auth-dev.example.com` | `AUTH_JWT_ISSUER` above |
| `IDENTITY_SERVICE_AUDIENCE` | `maestro-workspace` | the client's `audience` field |

If `iss` / `aud` / the JWKS URL do not line up exactly, maestro rejects the token as unauthenticated
(401) — there is no fallback.

## Local username/password login (RQ-0002)

For tenants that want identity-service's own email + password IdP instead of (or alongside) Google,
enable the `password` grant and mark the `local` IdP:

```js
db.tenants.updateOne(
  { _id: "tenant-local" },
  { $set: {
      status: "active",
      "oauth.enabled": true,
      "oauth.allowedGrantTypes": ["password"],
      "oauth.idp": { provider: "local" }
  } },
  { upsert: true }
);
```

Register a client allowing the `password` grant with an `audience` (binds the issued token's `aud`):

```js
db.oauth_clients.insertOne({
  _id: "client-local", tenantId: "tenant-local", name: "local web",
  grantTypes: ["password"], audience: "maestro-workspace",
  redirectUris: [], scopes: [], isConfidential: false, secretHash: ""
});
```

Then users **self-register** (`POST /v1/tenants/:tenantId/register`) and **log in** via the
`password` grant. The issued token is identical in shape to the Google-SSO token (`email` + stable
`sub` + `iss` + `aud` + `exp`), so a consumer like maestro verifies it the same way.

Operators manage credentials with the CLI (no email channel yet):

```bash
cd service
npm run manage-users -- create       --tenant=tenant-local --email=u@x.test --password=...
npm run manage-users -- set-password  --tenant=tenant-local --email=u@x.test --password=...
npm run manage-users -- lock|unlock|disable|enable|delete --tenant=tenant-local --email=u@x.test
```

## User roles (RQ-0005)

A local user can carry a list of **coarse, tenant-scoped roles** that are stamped into the user
token's **`roles`** claim (a JSON array of strings). identity-service **asserts** roles but does **not**
enforce them — each consuming product maps roles to its own permissions
([ADR-0005](../design/decisions/0005-decentralized-authorization.md)). The claim is omitted when a user has no
roles, and is re-read on every token issuance (including refresh), so a change applies on next refresh.

Optionally declare a per-tenant **`allowedRoles`** vocabulary (mirrors `allowedScopes`). When non-empty
it is validated at seed time — a user role outside the list is rejected; when empty/absent, any role
string is accepted.

```js
db.tenants.updateOne(
  { _id: "tenant-local" },
  { $set: { "oauth.allowedRoles": ["tenant_admin", "member"] } }   // optional vocabulary
);
```

Roles are provisioned by the operator (no HTTP API, [ADR-0003](../design/decisions/0003-seed-config-not-admin-api.md)):

- **Seed config:** add `roles: [..]` under a user in `config/seed.yaml` (applies to **newly created**
  users; re-running the seed leaves existing users untouched).
- **CLI (existing users):**

  ```bash
  cd service
  npm run manage-users -- set-roles --tenant=tenant-local --email=u@x.test --roles=tenant_admin,member
  npm run manage-users -- set-roles --tenant=tenant-local --email=u@x.test --roles=   # clears all roles
  ```

A consumer reads `roles` from the verified token and authorizes accordingly; it never calls back to
identity-service to check a permission.

## Bulk provisioning via seed config (RQ-0004)

For more than a one-off tenant, use the **seed config** instead of hand-running DB inserts. Copy the
committed template to a gitignored real file, fill it in, and run the idempotent loader:

```bash
cp config/seed.example.yaml config/seed.yaml     # gitignored; never committed
# set referenced secrets in the environment / .env, e.g. SEED_DEMO_PASSWORD, SEED_ADMIN_PASSWORD
cd service
npm run seed                                      # validates, then upserts tenants/clients + adds users
```

The file lists tenants, their OAuth clients (with `audience`), and local users; passwords/secrets are
`${ENV_VAR}` references resolved at run time and stored scrypt-hashed. Re-running upserts tenants and
clients and **leaves existing users untouched** (use `npm run manage-users set-password` to change a
password). The loader is operator-run against the database — there is **no HTTP seeding endpoint**
([ADR-0003](../design/decisions/0003-seed-config-not-admin-api.md)). The loader reads `MONGO_URI`, so run it
where it can reach the target Mongo (locally against the published port, or inside the docker network).

## Operational Tips

- Keep tenant configuration changes in version control (e.g., infrastructure repo) or via migration scripts to track history.
- Rotate client secrets periodically by recomputing `secretHash` and redistributing new credentials.
- Monitor structured logs for `issued client credentials token` events to validate adoption and spot unexpected tenants/grants.

For full architecture context, review [architecture.md](../design/architecture.md). For endpoint contracts, see [api.md](../reference/api.md).
> **Tip:** The `_id` is automatically generated as a UUID when omitted. Provide one explicitly only if you need a stable identifier determined outside the service.
