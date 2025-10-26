# Tenant Configuration Guide

Core Auth relies on tenant-scoped metadata stored in MongoDB. Enabling OAuth 2.0 for a tenant requires adding an `oauth` section to the tenant document. This guide explains the structure, recommended defaults, and validation rules enforced by the service.

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

## Operational Tips

- Keep tenant configuration changes in version control (e.g., infrastructure repo) or via migration scripts to track history.
- Rotate client secrets periodically by recomputing `secretHash` and redistributing new credentials.
- Monitor structured logs for `issued client credentials token` events to validate adoption and spot unexpected tenants/grants.

For full architecture context, review [architecture.md](architecture.md). For endpoint contracts, see [api.md](api.md).
> **Tip:** The `_id` is automatically generated as a UUID when omitted. Provide one explicitly only if you need a stable identifier determined outside the service.
