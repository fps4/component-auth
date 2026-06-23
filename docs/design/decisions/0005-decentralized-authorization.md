---
title: "0005: Decentralized authorization — central coarse roles in the token, fine-grained policy in each product"
status: accepted
date: 2026-06-02
related:
  - 0001-local-credential-idp.md
  - 0003-seed-config-not-admin-api.md
  - ../../product/RQ-0005-user-roles-in-identity-token.md
  - ../../guides/tenant-config.md
---

## Context

identity-service mints a user identity token (`sub`, `email`, `iss`, `aud`, `exp`) that products verify
via JWKS. It has **no role/permission concept**. Consumers now need to authorize users:

- **maestro** already owns a rich, domain-specific authorization model — a private participant
  register and a role×gate routing matrix, enforced at its API boundary. It needs *identity* from
  the token, and resolves permissions itself.
- **Other consumers** have little or no per-user authorization today.

The question: where should RBAC live? Two poles — a **central Policy Decision Point** (identity-service
owns roles *and* permissions for every product) versus **decentralized** (identity-service asserts
identity + coarse roles; each product decides what a role may do).

## Decision

**identity-service is the identity authority and a Policy Information Point — not a central Policy
Decision Point. It carries coarse, tenant-scoped roles as a token claim; each product owns the
fine-grained mapping of roles to permissions.**

- **In the token:** a `roles` claim (array of opaque, coarse, slow-changing strings — e.g.
  `tenant_admin`, `member`), scoped to the user's tenant. Roles are provisioned by the operator (seed
  config + `manage-users`), optionally validated against a per-tenant `oauth.allowedRoles` allow-list.
- **identity-service does NOT enforce** role semantics. It never rejects authentication on roles; it
  asserts them and stops there.
- **Each product is the Policy Enforcement/Decision Point.** It treats `roles` (plus `sub`/`email`) as
  *input* to its own authorization, mapping coarse roles to its domain permissions in its own repo.
- **The token is the contract.** Keep claims coarse and stable; do not push fine-grained, fast-moving
  permissions into a 15-minute-lived token.

## Why not a central permission engine

- **maestro's authorization is domain logic** (gate governance, split-review, self-dealing
  prevention). Centralizing it would couple identity-service to maestro's delivery-engine semantics, and
  maestro already keeps its instance data private.
- A central PDP becomes a **bottleneck and a single point of failure**: every new product permission
  would require a identity-service change, redeploy, and token refresh. The claims-in-token model needs
  no per-request call to auth.
- It matches the **grain of the system**: identity is shared and security-sensitive (must be central,
  versioned, JWKS-rotated, audited); policy is per-product and fast-moving.

## Why roles, not (only) OAuth scopes

The service already has `scope` (allow-listed per tenant and client). Scopes answer *"what may this
client application do"* — right for machine `client_credentials` tokens. **Roles answer *"what is this
user"*** and belong on the user identity token. We add a distinct `roles` claim rather than overload
`scope`, and leave `scope` as the machine-authorization primitive.

## Backward-compatibility contract (load-bearing)

This change is **additive and non-breaking**, so deploying it does not disturb existing deployments:

- **Additive claim.** A new `roles` claim is ignored by existing verifiers — JWT verification does not
  fail on unknown claims. maestro's verifier (checks signature + `iss`/`aud`/`exp`, reads
  `email`/`sub`) is unaffected; a consumer that does not verify these tokens yet is unaffected.
- **Additive schema.** `user.roles` defaults to `[]` and `tenant.oauth.allowedRoles` is optional;
  Mongo needs no migration and existing documents stay valid.
- **Keys persist.** Signing keys live in Mongo (`KeyStore`, encrypted), loaded on boot and only created
  when absent — a redeploy reuses them, so JWKS is stable and already-issued tokens remain valid.
- **Non-enforcing.** identity-service never rejects a login on roles; a user with no roles behaves
  exactly as today.
- **Ships dark.** Until roles are assigned, every token is identical to today's. Rollout is reversible.

A consumer is affected only when **that consumer chooses** to read `roles` — a deliberate change in the
product repo, not a side effect of deploying here.

## Consequences

- **Clear ownership boundary:** identity-service answers *"who is this person and what tenant-roles do
  they hold."* Each product answers *"given this person, what may they do here."*
- **Products do real work:** maestro keeps (and remains the source of truth for) its participant/gate
  model; it may additionally consume `roles` for cross-product org-roles. A consumer with no
  verification yet must first adopt JWKS verification, then add a thin role-gated check.
- **Staleness is bounded** by the access-token TTL (a revoked role lingers at most until refresh); for
  sensitive operations a product can consult a live source. Acceptable for coarse roles.
- **Role vocabulary** is operator-curated per tenant (`allowedRoles`); a normalized role/permission
  store can come later without changing the token contract.
