---
title: "0012: Federated identity is a first-class user record — JIT-provisioned on login, linked on verified email, resolved without changing the token contract"
summary: "Google-authenticated people are currently never persisted: the users collection is local-password-only, so federated logins get no roles (RQ-0005 silently fails for them), bypass status/lockout, and are invisible to the admin plane. Make the users collection provider-agnostic (passwordHash optional, an identities[] list), just-in-time provision a canonical user on first federated login, and resolve roles/status through the linked identity — WITHOUT changing the issued token's email/sub claims (the RQ-0001 fixed contract maestro already verifies). Auto-link a federated identity to an existing local account only on a verified, matching email; otherwise keep them separate and leave linking to an operator. Refines ADR-0011; consumes the RQ-0001/RQ-0002 identity contract."
status: accepted
last_updated: 2026-07-01
date: 2026-07-01
related:
  - ./0011-identity-data-operating-model-and-mcp-scope.md
  - ./0005-decentralized-authorization.md
  - ../../product/RQ-0011-federated-user-identity-view.md
  - ../../product/RQ-0001-workspace-user-identity-google-sso.md
  - ../../product/RQ-0002-local-password-idp.md
---

## Context

Google SSO (RQ-0001) and the local email/password IdP (RQ-0002) both ship, and both mint the **same**
RS256 user token (`email` + stable `sub`). But the two flows persist identity very differently, and the
gap only surfaces now that a second product wants to *manage* the people behind the tokens.

- **Local login** writes a durable `users` document (`service/src/models/user.ts`): `_id` is a stable
  UUID used as the token `sub`, and the doc carries `roles`, `status`, and lockout counters. The password
  grant reads it, enforces `status`, and stamps `roles` into the token.
- **Google login** persists **nothing about the person**. `handleGoogleCallback` writes the verified
  identity to the short-lived, TTL-swept `oauth_authorizations` record, `issueAuthorizationCodeToken`
  mints a token straight from it, and the only durable trace is an ephemeral `sessions` doc
  (`issueUserTokens`, `service/src/oauth/server.ts`). There is no user record for a Google-authenticated
  person.

Three concrete failures follow:

1. **Roles silently don't work for federated users.** `loadUserRoles(sub)` does `User.findById(sub)`
   (`service/src/oauth/server.ts:506`). For a Google login `sub` is Google's subject id, so it never
   matches a `users._id` → federated tokens always carry `roles: []`. RQ-0005 is effectively local-only.
2. **Status / lockout is bypassed on the federated path.** The password grant checks
   `status === 'disabled'` and `lockedUntil`; the Google path checks neither. A person an operator
   *disabled* can still obtain a valid token by logging in with Google. That is a security gap, not just
   a feature gap.
3. **Federated people are invisible to the management plane.** The console, `/admin/v1`, and MCP list
   and mutate the `users` collection (ADR-0011's operational surface). A Google-only person cannot be
   listed, assigned a role, disabled, or audited as a principal — they exist only as tokens in flight.

RQ-0001 anticipated this ("store both, match on either") but deferred it. ADR-0011 already declares
users/roles/status **operational, DB-owned** state written through the admin plane; a federated identity
is exactly that kind of state, and it is the one piece currently uncaptured.

The binding constraint is the **RQ-0001 fixed contract**: maestro's shipped verifier reads `sub` as the
**stable Google subject** and keys attribution on `email` + `sub` ("store both, match on either"). So we
**cannot** re-point the token `sub` at a new canonical id — that would break a production consumer. Any
model we pick has to leave the emitted `email`/`sub` claims byte-for-byte as they are today.

## Decision

**1. The `users` collection becomes provider-agnostic — one record per person, many identities.**
Make `passwordHash` **optional**; add an `identities[]` list, each entry `{ provider, subject, email,
emailVerified, linkedAt }`. A user may have a local credential, one or more federated identities, or
both. We keep a **single** `users` collection (not a separate `federated_identities` table) so there is
one admin view, one roles/status path, and one uniqueness rule. `emailVerified` and `status` move to
being meaningful for every provider.

**2. The token contract is unchanged — deliberately.** The emitted `email`/`sub` stay exactly as today:
local `sub` = the user's UUID `_id`; federated `sub` = the provider subject (Google `sub`). We do **not**
introduce a canonical-subject claim now, because RQ-0001's fixed contract makes `sub` load-bearing for
maestro. The federated user record is a **resolution layer behind** the token, not a change to it.
Unifying on a canonical subject is explicitly deferred (see Consequences).

**3. Just-in-time provisioning on first federated login.** On a successful Google callback, upsert a
`users` record keyed by `(tenantId, provider, subject)`, capturing `email`, `emailVerified`, and
`lastLoginAt`. Provisioning is JIT because there is no other moment we learn the person exists; it is
idempotent (upsert) to survive the concurrent-login race.

**4. Resolve roles and status through the linked identity.** Replace `findById(sub)` with a lookup that
matches a user by **either** a linked identity `subject` **or** local `_id` within the tenant. The
federated path then (a) stamps `roles` like the local path (fixes failure 1) and (b) enforces `status`
and lockout before issuing (fixes failure 2). One resolution function serves both grants.

**5. Auto-link only on a verified, matching email; otherwise keep separate or deny.** When a federated
login's email matches an existing user in the same tenant **and** the upstream asserts
`email_verified === true`, link the new identity onto that user. An **unmatched** email creates a distinct
user. An email that matches an existing user but is **unverified** is **denied** (`access_denied`) — never
merged onto that account and, since `(tenantId, email)` is unique, never allowed to shadow it. This is the
security boundary: an unverified upstream email must never reach an existing account (account-takeover).
Manual **link / unlink** is an operator action on the admin plane for the ambiguous cases; the system
never auto-merges on an unverified signal.

**6. The management plane treats users provider-agnostically.** Listing/read/CRUD over `/admin/v1`, the
console, and MCP show a user's linked identities; provisioning and link/unlink are audited like any other
operational mutation (ADR-0007/0011). No new *structural* surface — this stays on the operational side.

**7. Migration is JIT, not a backfill.** MongoDB is schemaless, so the model change is additive
(optional field + new sub-array + indexes). Historical Google-only people are not reconstructable from
TTL-swept authorizations; they simply materialize as a `users` record on their **next** login via (3).
Index changes: `passwordHash` optional; a partial/sparse unique index on `(tenantId, identities.provider,
identities.subject)`; keep the existing `(tenantId, email)` uniqueness (linking merges rather than
duplicates).

## Consequences

- **Positive:** RQ-0005 roles finally apply to Google users, and a disabled/locked person can no longer
  slip a token through the federated path — the same guarantees on both IdPs.
- **Positive:** one provider-agnostic `users` collection → the console/`/admin/v1`/MCP see every person
  regardless of how they authenticate, with per-actor audit for provisioning and linking.
- **Positive:** zero change to the issued token, so maestro and every other verifier keep working with no
  coordinated deploy — the fix is entirely issuer-internal.
- **Watch — the linking signal is a security boundary.** Auto-link is gated on `email_verified`; a change
  that relaxes it (linking on an unverified or cross-tenant email) reopens account-takeover and must be
  re-decided here, not in code.
- **Watch — `sub` semantics are intentionally frozen.** Because federated `sub` stays the provider
  subject, a person with both a local and a Google identity still yields **two different `sub` values**
  depending on how they logged in, even after linking. Consumers that need "one person = one subject"
  must match on `email` (as maestro does). A canonical-subject claim is a future ADR, and shipping it
  will require consumer coordination — which is exactly why it is out of scope here.
- **Watch — JIT means first-touch, not present.** Until a Google-only person logs in again post-change,
  they have no `users` row and cannot be pre-assigned a role. Operators wanting to stage roles ahead of
  first login create the user + identity through the admin plane (an existing operational capability).
- **Refines** ADR-0011 (federated identity is the operational, DB-owned user state it named but did not
  yet capture) and **realizes** RQ-0001's deferred "store both, match on either." ADR-0005 is unaffected:
  authorization still lives in the consumer; this only makes the `roles` *hint* correct for federated
  users.
