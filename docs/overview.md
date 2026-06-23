---
title: identity-service overview
summary: The product landing for identity-service — a standalone multi-tenant IdP issuing verifiable JWTs, with a management plane and an admin console.
status: current
last_updated: 2026-06-23
owners: [architect]
related:
  - README.md
  - docs/design/architecture.md
  - docs/reference/api.md
  - docs/design/decisions/0007-management-api-mcp-and-standalone-identity-service.md
---

# identity-service

identity-service is a standalone, multi-tenant identity service (a self-hosted IdP) shared across products: a TypeScript service, a headless SDK, and an optional drop-in React `<Login/>`. It owns **authentication** (who you are) only — it issues RS256-signed JWTs verifiable through a published JWKS, and each consuming product keeps its own **authorization** (what you may do). It mints two token kinds: **machine tokens** (OAuth `client_credentials`) and **user identity tokens** (Google SSO via OIDC+PKCE *or* a local email/password IdP — a per-tenant choice), with an optional coarse `roles` claim products map to their own permissions. Day-2 operations run on an authenticated **management plane** (ADR-0007): the `/admin/v1` HTTP API, an MCP server for agents, and an optional operator **admin console** — all over one audited, per-actor service layer, with nightly encrypted backups. **Status: active** — machine tokens, both user IdPs, refresh/revoke, seed provisioning, and the management plane are live. Start with the **Design** shelf for how it's built, the **Reference** shelf for the API and token contract, or the **Guides** shelf to onboard a tenant. New here? Read [`CODEBASE.md`](../CODEBASE.md), then [`docs/design/architecture.md`](design/architecture.md).
