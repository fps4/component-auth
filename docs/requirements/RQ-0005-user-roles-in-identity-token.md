---
title: "RQ-0005 — Tenant-scoped user roles in the identity token"
status: current
last_updated: 2026-06-02
owners: [architect]
related:
  - docs/decisions/0005-decentralized-authorization.md
  - docs/requirements/RQ-0002-local-password-idp.md
  - docs/requirements/RQ-0004-seed-config-provisioning.md
  - docs/tenant-config.md
maestro:
  feature: user-roles-in-identity-token
  kind: functional_spec
  summary: |
    Let an operator attach coarse, tenant-scoped roles (e.g. tenant_admin, member) to a local user,
    and stamp those roles as a `roles` claim on the user identity token. Roles are provisioned via the
    seed config and the manage-users CLI, optionally validated against a per-tenant allow-list. The
    auth service only carries roles — it does not enforce what a role may do; each consuming product
    maps roles to its own fine-grained permissions. The change is additive: existing tokens, users,
    tenants, and consumers are unaffected, and signing keys are unchanged.
---

# RQ-0005 — Tenant-scoped user roles in the identity token

- **Status:** accepted
- **Raised:** 2026-06-02
- **Owner:** @farid (architect)
- **Decision:** [ADR-0005](../decisions/0005-decentralized-authorization.md)

## Why

component-auth authenticates users and mints an identity token (`sub`, `email`, `iss`, `aud`, `exp`)
but carries **no notion of what a user is** — "admin" is only a labelled email. Consumers
(maestro, sovereign-copilot) increasingly need to authorize users, not just identify them. We want a
**single, central place** to assert coarse organizational roles for a user, delivered in the token
the products already verify, **without** turning component-auth into a central permission engine.

## Scope

1. A user MAY carry a list of **coarse, opaque role strings**, scoped to its tenant.
2. Roles are provisioned by the **operator** — via the **seed config** (`users[].roles`) and the
   **`manage-users` CLI** (a `set-roles` command) — consistent with [ADR-0003](../decisions/0003-seed-config-not-admin-api.md)
   (no admin HTTP API).
3. A tenant MAY declare an **`oauth.allowedRoles`** allow-list; when non-empty, seeded/assigned roles
   are validated against it (mirrors `allowedScopes`). An empty/absent list accepts any role string.
4. On the **user identity token** (password and authorization_code grants, and refresh), the service
   stamps a **`roles` claim** (a JSON array of strings) when the user has roles.
5. The service **does not enforce** role semantics: it asserts identity + roles only. Authorization
   (role → permission) lives in each consuming product.

## Out of scope

- **Fine-grained permissions, resource ACLs, or policy evaluation** — these live in the products
  (see ADR-0005). component-auth carries roles, not permissions.
- A **normalized roles/role-bindings data model** — roles are an array on the user (RBAC-lite); a
  richer model is deferred until there is real demand.
- **Roles for federated (Google SSO) users** that have no local user record — the `roles` claim is
  populated from the local user store; federated org-roles are a later, separate concern.
- An authenticated **admin management API** (still deferred, ADR-0001).

## Acceptance criteria (EARS)

- THE SYSTEM SHALL allow a local user to carry a list of tenant-scoped role strings, provisioned via the seed config (`users[].roles`) and the `manage-users set-roles` command.
- WHEN a tenant declares a non-empty `oauth.allowedRoles` list, THE SYSTEM SHALL reject (at seed/validate time) any user role not present in that list, with a precise error; WHEN the list is empty or absent, THE SYSTEM SHALL accept any role string.
- WHEN the system mints a user identity token (password or authorization_code grant, or a refresh) for a user that has roles, THE SYSTEM SHALL include a `roles` claim (array of strings) reflecting the user's current roles; WHEN the user has no roles, THE SYSTEM SHALL omit the claim.
- THE SYSTEM SHALL re-read roles from the user store on each token issuance (including refresh), so a role change takes effect no later than the next access-token refresh.
- THE SYSTEM SHALL NOT enforce role-to-permission semantics and SHALL NOT reject authentication on the basis of roles; role-based authorization is the consuming product's responsibility.
- THE SYSTEM SHALL remain backward compatible: existing tokens, users, tenants, consumers, and signing keys SHALL be unaffected by deploying this change (additive `roles` claim, additive optional fields).

## Definition of done

- `User` carries `roles: string[]` (default `[]`); `tenant.oauth.allowedRoles` optional allow-list.
- `seed-config` parses and validates `users[].roles` against `allowedRoles`; `npm run seed` applies
  roles to newly created users; `config/seed.example.yaml` documents the shape.
- `manage-users set-roles --tenant=<id> --email=<e> --roles=a,b` sets roles on an existing user.
- The user identity token carries a `roles` claim when present (password, authorization_code, refresh).
- The parser/validator and the claim are covered by tests.
- `docs/tenant-config.md`, `docs/api.md`, `GLOSSARY.md`, and `CODEBASE.md` document roles and the claim;
  ADR-0005 records the decentralized-authorization decision.
