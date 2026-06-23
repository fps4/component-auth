---
title: "0007: An authenticated management plane (HTTP API + MCP + admin console) over live MongoDB with nightly backups — and repositioning as a standalone identity service"
summary: "Stand up an authenticated, audited management plane (HTTP /admin/v1 + MCP + admin console) over live MongoDB with nightly encrypted backups, and reposition the project as a standalone identity service."
status: accepted
last_updated: 2026-06-23
date: 2026-06-23
related:
  - ./0001-local-credential-idp.md
  - ./0003-seed-config-not-admin-api.md
  - ./0006-seed-as-code-secrets-in-github.md
  - ../../guides/deployment.md
  - ../architecture.md
---

## Context

Day-2 operations on this service are still **operator scripts against the database**. Creating a user,
rotating a client secret, onboarding a tenant, locking an account — each is a `tsx` CLI run
(`npm run seed`, `manage-users`) executed by a human with Mongo reach, or a hand-edit to
`config/seed.yaml` + `config/secrets.ds1.sops.yaml` followed by a re-seed. That was a deliberate choice:

- [ADR-0001](0001-local-credential-idp.md) **deferred** an admin-authenticated HTTP management API —
  "today management is CLI/DB."
- [ADR-0003](0003-seed-config-not-admin-api.md) went further and **rejected** putting provisioning on the
  wire, because the service has **no admin-auth layer**, so any "create tenant/user" endpoint would sit
  behind a single static, replayable secret with no per-actor audit — exactly the blast radius that
  should not be remotely reachable.
- [ADR-0006](0006-seed-as-code-secrets-in-github.md) made the seed **definition** (git) and **secret
  values** (SOPS-encrypted, one `age` master key in GitHub) durable and recoverable, so a wiped database
  can be rebuilt from GitHub.

Three things have changed the calculus since those decisions:

1. **Agents are now operators.** We want creating a user, rotating a credential, and onboarding a tenant
   to be **quick and painless** — initiated by an agent through a protocol, not by a human with a
   checkout, Node, and a Mongo route. The CLI/seed path has no programmatic, authenticated, audited
   surface an agent can drive safely.
2. **Recovery via seed-as-code only restores *definitions*, not *runtime state*.** ADR-0006 rebuilds
   tenants/clients/users from git, but it cannot restore what the database accumulates at runtime:
   issued refresh-token metadata, `oauth_authorizations`, brute-force lockout counters, rotated
   `key_store` history, and audit logs. Re-seeding is a *floor*, not a true point-in-time recovery.
3. **The product is outgrowing "component."** What started as `component-auth` — a building block
   embedded in a fleet — now does what a standalone identity provider does (multi-tenant, multi-IdP,
   JWKS, machine + user tokens, per-tenant policy). The ask is to make it a **completely independent
   service** in the shape of a hosted IdP (an Auth0-style product), with its own management plane and
   its own name, rather than a component framed around one consumer.

This ADR revisits the ADR-0001/0003 deferral **under new conditions**: the objection in ADR-0003 was
never "a management API is wrong," it was "a management API **without an admin-auth layer**, gated by a
static secret, is wrong." The decision below is to **build the admin-auth layer first**, then expose
management over it.

## Decision

**Stand up an authenticated, audited management plane over the live MongoDB — exposed through three faces
on one service layer (an HTTP admin API, an MCP server for agents, and an operator web console with
statistics) — keep the database as the system of record, add nightly off-host backups for true
point-in-time recovery, and reposition the project as a standalone identity service with its own name.**
Concretely:

### 1. MongoDB stays the system of record; management mutates it directly

The live database remains authoritative (it already is — ADR-0006 confirmed steady-state data now
persists across deploys). Management operations become **first-class, authenticated mutations against the
DB**, not detours through a YAML file + re-seed. Seed-as-code (ADR-0003/0006) is retained but **demoted in
role**: it becomes the **bootstrap** and **disaster-recovery floor**, no longer the day-2 change path.

### 2. An authenticated admin-auth layer — the prerequisite ADR-0003 named

Before any management surface ships, the service grows the **admin-auth layer** whose absence ADR-0003
cited as the blocker:

- **Per-actor admin identity**, not a shared static secret — admin principals (human operators and
  agents) authenticate and are individually attributable.
- **Scoped admin authority** — management capability is a distinct, narrowly-scoped privilege
  (e.g. an `admin`/management scope), separate from tenant runtime tokens; agents get the **least
  capability** needed (e.g. provision-user only, not key rotation).
- **Per-actor audit** — every management mutation is recorded (who, what, when, which tenant) in an
  append-only audit collection. This is the per-actor accountability ADR-0003 said a static secret
  could not provide.
- **Controlled exposure** — the management plane is **not** on the same public surface as token
  issuance; it is network-restricted (separate bind/route, not behind the public tunnel by default) and
  rate-limited.

### 3. An HTTP management API

A versioned admin API (e.g. `/admin/v1/*`) exposes the operations that are CLI/seed today, as
idempotent, audited endpoints:

- **Tenants** — onboard, update, enable/disable an IdP, set per-tenant policy and rate limits.
- **Clients** — register, rotate secret, update grants/redirects/scopes, revoke.
- **Users** — create, reset password, lock/unlock, disable (the `manage-users` surface, on the wire).
- **Keys** — trigger rotation, inspect `key_store` status.

Operations reuse the existing idempotent service layer (the same upsert/insert-if-absent logic the seed
loader uses), so an API call and a re-seed converge on the same state.

### 4. An MCP server exposing the same operations as agent tools

The **same management operations** are exposed over the **Model Context Protocol** so agents can drive
onboarding/rotation directly. The MCP server is a **thin protocol adapter over the same service layer and
the same admin-auth + audit path** as the HTTP API — not a parallel implementation. One authorization
model, one audit trail, two transports (HTTP for humans/automation, MCP for agents).

### 5. An admin web console (statistics + management UI)

The same management operations get a **human face**: a standalone **operator console** — dashboards
(statistics) plus management screens for tenants, clients, users, and credential rotation, and a
**registration/onboarding** flow. It is a **thin client over the HTTP management API (#3)** — same
admin-auth, same audit, **no direct database access**.

It **reuses the `sovereign-copilot/web` stack** rather than inventing one: **Next.js 15** (App Router) +
React 19 + TypeScript, **shadcn/ui** (Radix + `class-variance-authority`) on **Tailwind**, **react-hook-form
+ zod** for forms/validation (sharing the API's zod schemas), **vega-lite** (`vega-embed`) for the
statistics charts (token issuance, active users/tenants, lockout rates, key-rotation history), and
sonner/next-themes/lucide for UX. Containerized and deployed like the copilot web app.

This is **distinct from the existing `react/` `<Login/>`** package: that stays a *consumer-facing*
embeddable login widget; the console is an *operator-facing* standalone app. Both can share design tokens,
but they ship and deploy separately.

### 6. Nightly backups for true point-in-time recovery

A scheduled **nightly `mongodump`** ships an **encrypted** snapshot **off-host** (object storage),
retained for a rolling window. This complements — does not replace — ADR-0006:

- **ADR-0006 (seed-from-git)** rebuilds the *intended topology* (tenants/clients/users + secrets) from a
  reviewable, sovereign source. It is the floor when there is no good backup.
- **Nightly backup** restores *actual runtime state* (tokens, authorizations, lockouts, key history,
  audit) to last night. It is the preferred recovery path for data loss.

Backups are encrypted at rest (consistent with the sovereign-plaintext stance of ADR-0006); the
restore procedure is documented alongside the seed-recovery procedure in the deployment guide.

### 7. Reposition as a standalone identity service with its own name

Treat the project as an **independent product**, not a fleet component. Rename away from `component-auth`
(repo, container `component-auth`, package `@fps4/component-auth-react`, docs framing) to **`identity-service`**
— a descriptive name that stands on its own as a hosted IdP. It is chosen over `auth-service`,
`identity-provider`, and `iam-service` because it is accurate to scope: this service issues **identity**
(authentication — who you are) and deliberately does **not** own access management/authorization, which
ADR-0005 keeps in the consuming products. `iam-*` would over-claim that boundary; `identity-service` does
not. The rename is **mechanical and sequenced after** the management plane — the capability is what makes
it a product; the name follows.

### Why not the alternatives

- **Keep seed-config-only (uphold ADR-0003 as-is).** It is safe and reviewable but cannot make
  provisioning "quick and painless" for agents: every change is a human-run script or a YAML edit +
  re-seed, with no programmatic, per-actor, audited surface. ADR-0003's objection was to a
  *static-secret, unauthenticated* endpoint — which this decision does **not** build. We satisfy the
  objection by building the admin-auth layer first.
- **Management API but no MCP.** Leaves agents either screen-scraping the HTTP API ad hoc or back on the
  CLI. MCP is the protocol the agent operators actually use; co-locating it on the same auth/audit path
  is cheaper than maintaining two access stories.
- **API/MCP but no web console.** Workable, but leaves human operators on `curl`/CLI for onboarding and
  with no statistics view. A thin console over the same API is low cost given a proven in-house stack to
  reuse, and is where "quick and painless" lands for humans the way MCP does for agents.
- **A new bespoke UI stack for the console.** Rejected — `sovereign-copilot/web` already runs Next.js 15 +
  shadcn/Tailwind + react-hook-form/zod + vega-lite (charts), which covers dashboards, forms, and tables.
  Reusing it is faster and keeps the fleet's frontend conventions consistent.
- **Extend the existing `react/` `<Login/>` package into an admin UI.** Rejected — that package is a
  *consumer* login widget meant to stay small and dependency-light (no Next.js/charting). The operator
  console is a different audience and footprint; conflating them would bloat the embeddable widget.
- **Rely on seed-from-git for recovery, skip backups.** Loses all runtime state (issued tokens,
  lockouts, key history, audit) on every recovery and gives no point-in-time restore. Backups and
  seed-as-code cover different failure modes; we keep both.
- **Stay a "component," add the API without renaming.** Entirely viable, and the rename can be split into
  its own ADR. But the management plane + MCP is precisely what turns this into a standalone IdP product;
  naming it as one removes the one-consumer framing that no longer fits.

## Consequences

- **A new, high-value attack surface — the one ADR-0003 warned about — now exists by design**, and must
  be defended accordingly: strong per-actor admin authN, least-privilege scopes (especially for agents),
  append-only audit, restricted network exposure (off the public tunnel), and rate limiting. This is a
  standing security responsibility, not a one-time build.
- **Two recovery paths, clearly scoped:** nightly encrypted backup for point-in-time runtime restore;
  seed-from-git (ADR-0006) as the definition floor. The deployment guide documents both and when to use
  which.
- **Seed-as-code is demoted, not deleted.** It remains the bootstrap and DR floor; ADR-0003/0006 stay in
  force for that role. Day-2 mutations move to the API/MCP, so operators no longer edit YAML for routine
  changes (they still do for a from-scratch rebuild).
- **New operational dependencies:** an audit collection, encrypted backup storage + its key management
  (another key to guard, alongside the SOPS `age` key), and a scheduled backup job in the deploy.
- **The MCP server is product surface to maintain** — tool schemas, versioning, and authZ kept in step
  with the HTTP API since both sit on one service layer.
- **The admin console is a new deployable web app** (Next.js, reusing the `sovereign-copilot/web` stack),
  separate from the embeddable `@fps4/component-auth-react` `<Login/>` widget — a new build/deploy unit and
  its own attack surface (it must hold no DB credentials; it talks only to the authenticated admin API).
  Statistics it renders come from the API, so the API needs aggregate/metrics endpoints to feed the
  dashboards.
- **The rename to `identity-service` has fleet-wide churn:** repo name, container/service names, the
  `@fps4/component-auth-react` package (→ `@fps4/identity-service-react`), docs IA, and **every consumer's
  references** (issuer string `AUTH_JWT_ISSUER`, env var names, client config). It is kept in this ADR (one
  decision for the whole refactor direction) but **sequenced after** the management plane; the issuer/`iss`
  claim change in particular is a token-contract concern for verifiers (e.g. maestro) and must be migrated
  carefully (dual-issuer acceptance window rather than a hard cutover).
- **Follow-ups (named, not built here):** the concrete admin-auth mechanism (token type/issuer for admin
  principals), the exact MCP tool catalogue and scopes, the admin-API **aggregate/metrics endpoints** and
  the console's screen inventory, backup tooling/retention specifics, and a `workflow_dispatch` or CI path
  now that an authenticated programmatic surface exists (which ADR-0006 lacked).
