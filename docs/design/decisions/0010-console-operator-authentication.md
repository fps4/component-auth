---
title: "0010: Per-actor operator authentication for the admin console — user identity tokens with an operator role on the management plane"
summary: "Let the admin console sign operators in with identity-service's own OAuth password grant and forward the operator's user token to /admin/v1, so the management plane attributes each action to a human. The admin authorizer accepts a user identity token whose roles claim carries a configured operator role, in addition to today's machine (client_credentials) tokens."
status: accepted
last_updated: 2026-06-25
date: 2026-06-25
related:
  - ./0007-management-api-mcp-and-standalone-identity-service.md
  - ./0005-decentralized-authorization.md
  - ../../product/RQ-0007-console-operator-login.md
  - ../../product/RQ-0005-user-roles-in-identity-token.md
  - ../architecture.md
---

## Context

[ADR-0007](0007-management-api-mcp-and-standalone-identity-service.md) stood up the management plane and
named, as an explicit follow-up, *"the concrete admin-auth mechanism (token type/issuer for admin
principals)"* and *"the console's screen inventory."* It also set a hard requirement: management is
**per-actor and audited** — *"admin principals (human operators and agents) authenticate and are
individually attributable,"* not a shared static secret (the very objection ADR-0003 raised).

The plane shipped, but only half of that requirement is met today:

- The admin authorizer (`service/src/core/admin-auth.ts`, `verifyAdminToken`) verifies a bearer JWT
  against this service's own JWKS, then **requires a `cid` claim** — i.e. it accepts **only
  `client_credentials` (machine) tokens**. A user identity token (which carries `sub`, `tid`, `roles`
  but no `cid`) is rejected with `403 "Not a machine token"`.
- The admin **console** ([RQ-0007](../../product/RQ-0007-console-operator-login.md)) therefore
  authenticates with a single static `ADMIN_API_TOKEN` (one machine client) held in server env. Every
  console mutation is attributed to that one client — the audit log cannot say *which human* onboarded a
  tenant or rotated a secret.

So the audit collection already records a `principalSubject` (`sub`), but no operator ever populates it,
because no human-bearing token can pass the guard. The missing piece is a **principal model for human
operators** — exactly the follow-up ADR-0007 deferred.

The fleet already has the parts to do this without inventing anything. [RQ-0005](../../product/RQ-0005-user-roles-in-identity-token.md)
stamps a coarse, tenant-scoped **`roles`** claim onto user identity tokens. maestro
([ADR-0019](../../../maestro/docs/architecture/decisions/0019-workspace-identity-service-google-sso.md),
US-0034) already proves the consuming pattern: a Next.js surface that is a **resource server** — the
operator signs in via identity-service, the Next **server** holds the token and forwards it as
`Authorization: Bearer`, and the backend verifies it via JWKS. The console is the same shape pointed at
`/admin/v1`.

## Decision

**Make the admin console a per-actor operator surface by (a) teaching the management-plane authorizer to
accept a user identity token whose `roles` claim carries a configured operator role, and (b) signing
operators in through identity-service's own OAuth `password` grant, with the console forwarding the
operator's token server-side.** The static machine token is demoted to break-glass / non-interactive use.

### 1. Two principal kinds on the management plane

`verifyAdminToken` accepts a verified, this-issuer JWT that is **either**:

- a **machine principal** — a `client_credentials` token (`cid` present) carrying the `admin` superscope
  or a granular `admin:<area>` scope. This is today's path, unchanged — agents (MCP) and the break-glass
  token keep working; **or**
- an **operator principal** — a **user identity token** (`sub` present, no `cid`) whose `roles` claim
  contains a configured operator role (default `platform_admin`). The authorizer maps that role to the
  `admin` superscope for authorization purposes.

In both cases the verified principal is attached to the request and audited. For an operator the audit's
`principalSubject` is the human's stable `sub` — the per-actor attribution ADR-0007 required.

### 2. Authority comes from a role, mapped by the plane itself

identity-service only *carries* roles; consumers map them to permissions ([ADR-0005](0005-decentralized-authorization.md)).
Here **identity-service is itself the consumer** for its own management plane, so it is the legitimate
owner of the mapping `operator role → admin authority`. The operator role(s) and their scope mapping are
**configuration** (e.g. `ADMIN_OPERATOR_ROLES=platform_admin`), defaulting to one role → superscope.
Finer mappings (a role → a subset of `admin:*`) are a later refinement, not built now.

### 3. Operator roles are provisioned, not self-served

An operator is a local user (RQ-0005) whose `roles` include the operator role, granted **only** through
the controlled provisioning paths — seed-as-code / `manage-users` — never self-registration. The
console's password-grant client is a dedicated, restricted OAuth client on a console/operator tenant.

### 4. The console is a thin server-side resource client (maestro-web pattern)

The console signs the operator in via the `password` grant, mirrors the access token into a
**server-readable cookie**, gates navigation in `middleware.ts` on the token's `exp`, **silently
refreshes** via the `refresh_token` grant, and **forwards the operator's token** to `/admin/v1` from
Server Components / Server Actions. The token is never exposed to the browser beyond what that pattern
requires, and the console holds no DB credentials.

### 5. The static admin token is demoted, not deleted

`ADMIN_API_TOKEN` remains for **non-interactive / break-glass** use (bootstrap, scripts, recovery when
no operator account exists yet). Interactive console use is per-actor. This keeps a recovery path that
does not depend on an operator login working.

## Alternatives considered

- **Keep the shared static token (status quo).** Rejected — it cannot satisfy ADR-0007's per-actor audit
  requirement; the audit log can never name the human.
- **A separate admin-only token type / issuer for operators.** Rejected — more moving parts (a second
  issuer or token kind to mint, verify, refresh, and revoke) for no gain over reusing the user identity
  token + `roles` claim the service already issues and verifies.
- **Mint a `client_credentials` token per operator.** Rejected — machine tokens have no human `sub`, no
  interactive login, no refresh-on-behalf-of-a-person; it would re-introduce shared-secret handling per
  operator and still not be a clean per-actor identity.
- **Console calls `/admin/v1` from the browser with the operator token.** Rejected — exposes a
  high-authority token to the browser and breaks the "console holds no credentials, server-side only"
  posture from ADR-0007; the maestro-web SSR-resource-server pattern keeps the token server-side.
- **Map the operator role to permissions in the console instead of the plane.** Rejected — the console
  is a thin client; authority must be enforced at the API (the plane), which is reachable by MCP and curl
  too, not only the console.

## Consequences

- **The management plane gains a second, human-bearing entry path** — a deliberate widening of the
  ADR-0007 attack surface. It is defended by: verifying against the service's own JWKS + `iss` (already
  done), requiring a provisioned operator role (not just any authenticated user), restricting the
  console's password-grant client, and keeping append-only per-actor audit. Granting the operator role
  is now a privileged provisioning act to guard like any admin credential.
- **Per-actor audit becomes real.** `principalSubject` is populated for operator actions with no schema
  change — the audit model already carries it.
- **`verifyAdminToken` is the single chokepoint to change**, and it is shared by both transports (HTTP
  middleware + MCP), so the new principal model applies uniformly; MCP is unaffected because machine
  tokens still validate exactly as before.
- **A new low-privilege failure mode:** an operator whose role was revoked keeps authority until their
  access token expires. Mitigated by short access-token lifetimes + refresh (roles are re-read on every
  issuance — `loadUserRoles`), so a revocation takes effect on the next refresh.
- **Recovery is preserved.** Break-glass `ADMIN_API_TOKEN` still works when no operator exists (e.g. a
  fresh restore), so the per-actor path is not a bootstrap dependency.
- **Resolves an ADR-0007 follow-up** (the admin principal/token model). The console screen inventory and
  test/UX follow-ups are tracked as RQ-0008/0009/0010.
- **Docs to update:** `docs/reference/api.md` (the `/admin/v1` auth section now lists operator user
  tokens as a second accepted principal) and `console/README.md` (operator login + break-glass).
