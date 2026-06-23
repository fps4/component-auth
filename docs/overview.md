---
title: identity-service overview
status: current
last_updated: 2026-06-07
owners: [architect]
related:
  - README.md
  - docs/design/architecture.md
  - docs/reference/api.md
---

# identity-service

identity-service is a multi-tenant authentication building block shared across products: a standalone TypeScript service, a headless SDK, and an optional drop-in React `<Login/>`. It owns **authentication** (who you are) only — it issues RS256-signed JWTs verifiable through a published JWKS, and each consuming product keeps its own **authorization** (what you may do). It mints two token kinds: **machine tokens** (OAuth `client_credentials`) and **user identity tokens** (Google SSO via OIDC+PKCE *or* a local email/password IdP — a per-tenant choice), with an optional coarse `roles` claim products map to their own permissions. **Status: active** — machine tokens, both user IdPs, refresh/revoke, and seed provisioning are live. Start with the **Design** shelf for how it's built, the **Reference** shelf for the API and token contract, or the **Guides** shelf to onboard a tenant. New here? Read [`CODEBASE.md`](../CODEBASE.md), then [`docs/design/architecture.md`](design/architecture.md).
