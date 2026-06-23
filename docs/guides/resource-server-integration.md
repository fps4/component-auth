---
title: Resource-Server Integration Guide
status: current
last_updated: 2026-06-16
owners: [architect]
related:
  - docs/design/decisions/0005-decentralized-authorization.md
  - docs/product/RQ-0005-user-roles-in-identity-token.md
  - docs/reference/api.md
  - docs/guides/tenant-config.md
---

# Resource-Server Integration Guide

How a product integrates with Component Auth. This is the build-once contract every consuming
product follows, so that authentication is owned in one place and authorization stays local to
each product.

Component Auth is the **authentication engine** (an OAuth2/OIDC Identity Provider). Each product
is a **resource server**: it verifies the token Component Auth issues and makes its own
authorization decisions. The decision behind this split is [ADR-0005 — decentralized
authorization](../design/decisions/0005-decentralized-authorization.md); the roles mechanism is
[RQ-0005](../product/RQ-0005-user-roles-in-identity-token.md). This guide is the *how-to* for the
consuming side.

## The split: who owns what

| Concern | Owner | Where it lives |
|---|---|---|
| Login, credentials, password reset, Google SSO | **Component Auth** | the IdP |
| Users, the user store, JWKS, token issuance | **Component Auth** | the IdP |
| **Coarse, tenant-scoped role assignment** ("alice is a `reviewer`") | **Component Auth** | the `roles` claim on the signed token; provisioned by operators |
| **Token verification** (signature, `iss`/`aud`/`exp`) | **the product** | a verifier at the product's edge |
| **Fine-grained role → capability mapping** ("`reviewer` may approve a filing") | **the product** | the product's own config/code |
| **Enforcement** of capabilities on operations | **the product** | the product's request path |
| **User / role administration UI** | **Component Auth** | build-once; serves all products |

The governing rule: **Component Auth asserts identity and coarse roles; it never enforces what a
role may do.** Each product maps the role strings it receives to its own permissions. (ADR-0005,
RQ-0005 scope §5.)

## What Component Auth gives you

- **A verifiable RS256 identity token** with `sub` (stable), `email`, `iss`, per-consumer `aud`,
  `exp`/`iat`, and an **optional `roles` claim** (array of coarse strings; omitted when the user
  has none). See [`reference/api.md`](../reference/api.md) for the exact contract.
- **JWKS** at `/.well-known/jwks.json` for signature verification.
- **OAuth2 endpoints** — `/oauth2/token` (local password grant) and authorization-code + PKCE
  (Google SSO).
- **A login widget** — the `@fps4/identity-service-react` `<Login/>` component.
- **Operator role provisioning** — `manage-users set-roles` and the seed config (`users[].roles`),
  optionally constrained by a per-tenant `oauth.allowedRoles` vocabulary (see
  [`tenant-config.md`](./tenant-config.md)).

## What your product owns

1. **Verify the token at the edge** — signature against the JWKS, and `iss` / `aud` / `exp`.
   Extract `sub`, `email`, and `roles`.
2. **Stay stateless on identity** — do **not** keep a user table or a role-grant store, and do
   **not** call back to Component Auth to make an authorization decision. Everything you need
   arrives on the verified token.
3. **Map coarse roles → your capabilities in your own config** — a role string like `reviewer`
   means whatever your product's capability map says it means. Keep that map in the product repo.
4. **Enforce** those capabilities on your protected operations, returning a uniform `403` when the
   caller's roles don't grant the required capability.
5. **Default safely** — a role you don't recognise maps to **no capabilities** (deny by omission);
   log it. An absent `roles` claim means a single-role / unprovisioned deployment — pick a documented
   default (e.g. a baseline role) rather than failing closed silently.

## Roles are tenant-scoped, not product-scoped

Component Auth stamps **one `roles` array per user per tenant**, independent of `audience`. If two
products share a tenant, they see the **same** role strings. Handle this by convention:

- **Namespace role strings per product** — `copilot:reviewer`, `maestro:operator` — and have each
  product map only its own prefix; or
- **Agree a shared vocabulary** across the products in that tenant.

Either way, an unknown role → no capabilities (logged). Keep the product's role vocabulary a subset
of the tenant's `oauth.allowedRoles`.

## Admin UI is Component Auth's job — build once

User and role administration (create user, reset password, lock, **assign roles**) is
Component Auth data and belongs inside its security boundary. **Products do not build their own
user-management surfaces** — that would duplicate the same admin UI over the same data N times.
Today provisioning is the `manage-users` CLI; a GUI admin console, when a deployment needs one, is a
Component Auth deliverable and then serves every product. A product may own **only** a *read-only*
view of its own role → capability mapping (it mutates nothing and owns no identity).

## Integrate via the verifier-SDK pattern, not bespoke code

Don't re-implement JWKS handling per product. The integration surface is:

- A **per-language token verifier** — JWKS fetch + cache, signature + `iss`/`aud`/`exp`
  enforcement, claim extraction. *Reference implementation:* sovereign-copilot's
  `src/chat_api/edgeauth.py` (Python). Promote shared verifiers into versioned libraries as more
  products integrate.
- The **`<Login/>` widget** for the frontend.

## Operational notes

- **Adding roles to a deployment is operator config, not code.** Declare the vocabulary in the
  tenant's `oauth.allowedRoles`, then `manage-users set-roles --tenant=<id> --email=<e> --roles=…`.
  The `roles` claim, per-user storage, and the CLI already ship — no Component Auth code change is
  needed to light up RBAC in a consuming product.
- **Role changes have a refresh-window latency.** Roles are re-read at each token issuance
  (including refresh), so a change takes effect no later than the next access-token refresh
  (RQ-0005). For instant revocation you'd add token introspection or shorter TTLs — defer until a
  deployment requires it.

## Worked example: sovereign-copilot

sovereign-copilot is a resource server consuming this contract. Its edge verifier is
`src/chat_api/edgeauth.py` / `require_identity()`; it owns no user store; its role → capability map
and enforcement (`require_capability`) live in the copilot repo. Its instance of this decision is
sovereign-copilot ADR-0015 (*identity-service as authentication engine; copilot as resource server*),
implemented by copilot story US-0109.
