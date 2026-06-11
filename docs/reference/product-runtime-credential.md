---
title: Product-runtime credential (client_credentials)
status: current
last_updated: 2026-06-11
owners: [architect]
related:
  - docs/reference/api.md
  - docs/guides/tenant-config.md
  - docs/product/RQ-0004-seed-config-provisioning.md
---

# Product-runtime credential (`client_credentials`)

A **managed product's runtime** authenticates to maestro's runtime-intake endpoints (heartbeat,
telemetry, RCA) as a `product_runtime` principal. It obtains that credential from component-auth's
existing OAuth2 `client_credentials` grant — one registered client per deployment — so a deployment
configures a `client_id` + `client_secret` and exchanges them for a short-lived, signed JWT that
maestro verifies against this service's JWKS (maestro US-0086).

This is the same grant CI clients use; the only additions (US-0086) are **per-client audience**,
**`subject`**, and **additive `claims`**, so the minted token carries exactly what the resource
server (maestro) matches on.

## What the token carries

For a deployment registered as the client below, `POST /oauth2/token` with
`grant_type=client_credentials` mints an RS256 JWT with:

| Claim   | Source                              | Example                                  |
| ------- | ----------------------------------- | ---------------------------------------- |
| `aud`   | client `audience`                   | `maestro-workspace`                      |
| `sub`   | client `subject` (← else client id) | `runtime@sovereign-llm-gateway.fps4.nl`  |
| `role`  | client `claims.role`                | `product_runtime`                        |
| `email` | client `claims.email`               | `runtime@sovereign-llm-gateway.fps4.nl`  |
| `iss`   | service `AUTH_JWT_ISSUER`           | `https://auth.fps4.nl`                   |
| `exp`   | `accessTokenTtlSec`                 | short-lived                              |

maestro resolves the deployment by `email`/`sub` against its register and checks `aud` +
`role` (the register is authoritative; `role` is defence-in-depth). Registered claims
(`iss`/`aud`/`exp`/`sub`) are always set by the signer — a value smuggled into `claims` can never
override them.

## Registering a runtime client (seed config)

Add a confidential `client_credentials` client to the tenant in the gitignored seed config
(RQ-0004). The `client_secret` is the **only** operator-chosen secret; reference it via `${ENV}` so
it never lives in the file:

```yaml
tenants:
  - id: fps4
    name: FPS4
    oauth:
      enabled: true
      allowedGrantTypes: [client_credentials]
    clients:
      - id: sovereign-llm-gateway-ds1          # one client per (product, deployment)
        name: sovereign-llm-gateway@ds1 runtime
        grantTypes: [client_credentials]
        isConfidential: true
        secret: ${GATEWAY_DS1_RUNTIME_SECRET}  # operator-held; resolved from the environment
        audience: maestro-workspace            # must equal maestro's COMPONENT_AUTH_AUDIENCE
        subject: runtime@sovereign-llm-gateway.fps4.nl
        claims:
          role: product_runtime
          email: runtime@sovereign-llm-gateway.fps4.nl
```

Then run the seeder (idempotent; upserts clients):

```bash
GATEWAY_DS1_RUNTIME_SECRET=… npm run seed
```

## Exchanging the credential

```bash
curl -s -X POST https://auth.fps4.nl/oauth2/token \
  -d grant_type=client_credentials \
  -d client_id=sovereign-llm-gateway-ds1 \
  -d client_secret="$GATEWAY_DS1_RUNTIME_SECRET"
# → { "access_token": "<jwt>", "token_type": "Bearer", "expires_in": …, "scope": "" }
```

The managed-product SDK does this for you — see its `client_credentials` token provider, which caches
the token and refreshes it before expiry, and stays dormant when no credential is configured.
