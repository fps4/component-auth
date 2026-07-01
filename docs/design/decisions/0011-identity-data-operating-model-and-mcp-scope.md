---
title: "0011: Identity-data operating model — structure is GitOps, state is the DB; MCP is read + operational, not provisioning"
summary: "Draw the seam between declarative and imperative identity data: tenants + OAuth clients are structural and provisioned from seed config (GitOps); users, credentials, status, and keys are operational and owned by the live DB (ADR-0008), mutated through the admin plane. Scope the MCP agent surface to read + operational tools and remove structural provisioning (onboard_tenant / create_client / delete_client) from it. Refines ADR-0003 and ADR-0007."
status: accepted
last_updated: 2026-06-26
date: 2026-06-26
related:
  - ./0003-seed-config-not-admin-api.md
  - ./0007-management-api-mcp-and-standalone-identity-service.md
  - ./0008-drop-sops-db-is-system-of-record.md
  - ../../guides/tenant-config.md
---

## Context

Three prior decisions each answered part of "where do identity objects come from," and together they
left a seam undefined:

- [ADR-0003](0003-seed-config-not-admin-api.md): provision tenants/clients/users from a seed YAML via an
  idempotent operator script — **no** HTTP provisioning API (there was no admin-auth layer yet).
- [ADR-0007](0007-management-api-mcp-and-standalone-identity-service.md): added an authenticated
  management plane (HTTP `/admin/v1` **and** an MCP server for agents, plus the operator console) and
  made the **live DB the system of record**; seed-as-code was demoted to a bootstrap/DR floor.
- [ADR-0008](0008-drop-sops-db-is-system-of-record.md): confirmed the DB is the sole system of record;
  recovery is a restore from an off-host backup, not a re-seed (a re-seed restores *definitions*, never
  runtime state).

In practice the ambiguity bit us. The Skills Coach was added to `seed.yaml` (tenant + client +
users), but the seed workflow never ran for it (its `SEED_*` secrets were never configured), so the
objects were created out-of-band via the MCP/admin plane instead — **and the `coach-web` OAuth client
was missed**. Result: a live tenant and users with no client, and a production login failing with
`client not found`. The seeder also cannot reconcile what the MCP creates: it upserts definitions and
inserts users **only if absent**, and never resets a password — it is a bootstrap-and-repair tool, not a
declarative reconciler. And crucially, **credentials are inherently runtime state** — users change them,
resets and lockouts happen — so `seed.yaml` can never be the source of truth for them.

So the real question is not "seed *or* DB" but **which identity data is declarative (belongs in git) and
which is operational (belongs in the DB)** — and, given three write surfaces (HTTP API, console UI, MCP),
**what each surface is allowed to do.**

## Decision

**1. Split identity data by lifecycle.**

| Data | Nature | System of record | Write path |
|---|---|---|---|
| Tenants, OAuth clients | structural — rare, security-sensitive, reviewable | `seed.yaml` (+ focused subset files), GitOps | PR → `seed-ds1` workflow |
| Users, roles, credentials, status, lockouts, signing keys | operational — frequent, secret-bearing, runtime | the **live DB** (ADR-0008) | console UI (humans) · HTTP `/admin/v1` (services) · MCP (agents) |

Bootstrap/demo accounts may be *listed* in seed config (insert-if-absent), but the DB owns them after
first insert; their recovery is the off-host backup, not a re-seed.

**2. Structure is provisioned from seed config, never invented by an agent.** A new tenant or client is a
reviewed change to seed config applied by the workflow — not an imperative `create_client` call. This is
what keeps the security-sensitive objects auditable in git and prevents the drift above. Per-product
subset files (e.g. `config/seed.operators.yaml`, `config/seed.coach.yaml`) let one product be seeded
without every other tenant's secret, and are kept in sync with `seed.yaml`.

**3. Scope the MCP to read + operational tools.** The MCP is the *agent* face on the imperative side; it
must not be a structural-provisioning surface. Remove `onboard_tenant`, `create_client`, and
`delete_client` from the MCP tool set. Keep read (`list_tenants`, `get_stats`) and operational tools
(`create_user`, `reset_user_password`, `set_user_status`, `unlock_user`, `rotate_client_secret`,
`rotate_signing_key`). The HTTP admin API retains full capability for break-glass; removing structure
from the *agent* surface is least-privilege, not a capability loss.

**4. Process rule.** When seed config changes, the `seed-ds1` workflow must run (it is push-triggered on
the seed files); adding a product is not "done" until its objects are in the DB via that path.

## Consequences

- **Positive:** one coherent rule — *structure is declarative (git), state is imperative (DB), and
  UI/API/MCP are interchangeable faces on the imperative side.* The `coach-web` class of drift cannot
  recur: clients only come from reviewed seed config.
- **Positive:** the agent surface is least-privilege; an agent can run break-glass ops (reset a password,
  unlock a user) and read state, but cannot silently mint a tenant/client with invented parameters.
- **Positive:** credentials are never expected in git; DR is git-for-structure + backup-for-state, exactly
  as ADR-0008 intends.
- **Watch:** seed config is not a reconciler — it does not prune or update. Deleting/altering a client is
  a deliberate operator act via the HTTP admin API; document it rather than expecting the seed to remove
  objects.
- **Watch — migration debt:** the monolithic `seed.yaml` still inlines per-tenant user passwords behind
  `${SEED_*}` secrets, most of which are unset, so a full re-seed currently fails fast. Coach is the first
  product modelled the new way (structural subset, DB-owned users). Reconciling the other tenants
  (demo/maestro/copilot) to the split — and configuring or retiring their `SEED_*` secrets — is follow-up.
- **Refines** ADR-0003 (seed-only provisioning predated the admin plane) and ADR-0007 (which introduced
  the MCP as a full mirror of the HTTP API); the MCP is now a deliberate subset.
