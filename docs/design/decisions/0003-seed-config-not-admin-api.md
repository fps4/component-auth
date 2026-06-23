---
title: "0003: Provision tenants/clients/users from a gitignored seed config via an operator script — not an HTTP API"
status: accepted
date: 2026-06-01
related:
  - 0001-local-credential-idp.md
  - ../../product/RQ-0004-seed-config-provisioning.md
  - ../../guides/tenant-config.md
---

## Context

Tenants, OAuth clients, and (now) local users are provisioned out-of-band — originally via
`tests/load-tenant.ts` for a single tenant. As deployments need *several* tenants plus demo/admin
users (e.g. a demo deployment), the one-off script doesn't scale and there's no recorded, repeatable
source of "what exists." The question raised: a config file of tenants + users, loaded by something,
expandable later — and whether to trigger that load **behind an HTTP API guarded by a secret**.

[ADR-0001](0001-local-credential-idp.md) already noted identity-service has **no admin-auth layer** and
deferred an admin HTTP management API. So the live choice is: how to load provisioning data, and
whether to expose it on the wire.

## Decision

**Provision from a gitignored YAML seed config, loaded by an idempotent operator-run script. Do not
expose seeding over HTTP.**

- A **committed `config/seed.example.yaml`** documents the shape; the **real `config/seed.yaml` is
  gitignored**. (The common committed-example / gitignored-real-file split.)
- **`npm run seed`** reads the file, validates it, and **upserts** tenants + clients and
  **inserts-if-absent** users (passwords scrypt-hashed). Re-running is safe and never resets an
  existing password.
- **Secrets stay out of the file** via `${ENV_VAR}` references resolved at run time; the only secret
  the loader needs is the Mongo connection (already in the environment).
- **No HTTP seeding endpoint.** Provisioning is a **privileged operator act**, run against the DB —
  not a network call.

### Why not a secret-gated HTTP load endpoint

It was proposed and rejected. On a service with **no admin-auth layer**, a "load tenants/users"
endpoint — even behind a shared `.env` secret — puts **tenant and user creation on the wire**,
protected by a single static, replayable secret with no per-actor audit, easy to leak via env/logs,
and about to sit behind a public tunnel. The blast radius (create arbitrary tenants/users) is exactly
what should *not* be reachable remotely. A script run by an operator has none of that surface. When a
real, authenticated admin API is justified, it gets its own decision (the ADR-0001 deferral).

## Consequences

- **Repeatable, reviewable provisioning** — the example file documents the contract; the real data is
  versionable in a private location without leaking secrets.
- **No new attack surface** — nothing seeding-related is exposed; the loader is dev/ops tooling.
- **Operational note** — the loader connects to `MONGO_URI`; run it where it can reach the target DB
  (locally against the published Mongo port, or as a one-shot inside the docker network). A compose
  one-shot is a possible future convenience, deferred.
- **`load-tenant.ts` is superseded** for multi-tenant provisioning by `npm run seed` (the older script
  remains for ad-hoc single-tenant use).
