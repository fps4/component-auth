---
title: "RQ-0004 — Seed config provisioning (tenants, clients, users)"
status: current
last_updated: 2026-06-07
owners: [architect]
related:
  - docs/design/decisions/0003-seed-config-not-admin-api.md
  - docs/product/RQ-0002-local-password-idp.md
  - docs/guides/tenant-config.md
maestro:
  feature: seed-config-provisioning
  kind: functional_spec
  summary: |
    Provide a single config file that lists the tenants, their app clients, and starter users, and a
    one-command loader that creates them in the database. The real file is kept out of version
    control and can reference secrets from the environment rather than holding them; passwords are
    stored hashed. Running the loader again is safe — it updates tenants and clients and leaves
    existing users alone. The loader is run by an operator, not exposed as a web endpoint.
---

# RQ-0004 — Seed config provisioning

- **Status:** accepted
- **Raised:** 2026-06-01
- **Owner:** @farid (architect)
- **Decision:** [ADR-0003](../design/decisions/0003-seed-config-not-admin-api.md)

## Why

Provisioning was a one-off single-tenant script (`tests/load-tenant.ts`). Deployments now need several
tenants plus demo/admin users (e.g. a demo deployment) from a repeatable, reviewable source — without an
admin HTTP API (which identity-service has no auth layer for, [ADR-0001](../design/decisions/0001-local-credential-idp.md)).

## Scope

1. A committed **`config/seed.example.yaml`** template + a **gitignored `config/seed.yaml`** for real data.
2. An idempotent **`npm run seed`** loader: validate, then **upsert** tenants + clients and **insert-if-absent** users.
3. **`${ENV_VAR}`** references for secrets/passwords (resolved at run time); passwords scrypt-hashed.
4. Operator-run only — **no HTTP seeding endpoint** (ADR-0003).

## Out of scope

- An authenticated **admin management API** (deferred, ADR-0001).
- A **compose one-shot** seed service (possible future convenience).
- Deleting/reconciling removed entries (the loader adds/updates; it does not prune).

## Acceptance criteria (EARS)

- THE SYSTEM SHALL load tenants, OAuth clients, and local users from a YAML seed file whose real form is gitignored, with a committed example template.
- WHEN the loader runs, THE SYSTEM SHALL validate the config and fail with a precise error if a tenant lacks required OAuth fields, a password/authorization_code client lacks an `audience`, a user has an invalid email, or a user is listed on a tenant without the local IdP enabled.
- THE SYSTEM SHALL resolve `${ENV_VAR}` references from the environment and SHALL fail if a referenced variable is unset; passwords SHALL be stored scrypt-hashed, never in plaintext.
- WHEN the loader runs more than once, THE SYSTEM SHALL upsert tenants and clients and SHALL leave existing users unchanged (insert-if-absent), so a re-run never resets a password.
- THE SYSTEM SHALL be runnable only as an operator script against the database and SHALL NOT expose a seeding HTTP endpoint.

## Definition of done

- `config/seed.example.yaml` committed; `config/seed.yaml` gitignored; `npm run seed` loads it idempotently.
- The parser/validator is covered by tests (valid, missing env, missing audience, users-without-local-idp, bad email, empty).
- `docs/guides/tenant-config.md` documents bulk provisioning; ADR-0003 records the no-API decision.
