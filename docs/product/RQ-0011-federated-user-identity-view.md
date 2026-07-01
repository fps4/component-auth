---
title: "RQ-0011 — Federated user identity: persist Google logins as first-class, manageable users"
status: proposed
last_updated: 2026-07-01
owners: [architect]
related:
  - docs/design/decisions/0012-federated-identity-and-account-linking.md
  - docs/product/RQ-0001-workspace-user-identity-google-sso.md
  - docs/product/RQ-0002-local-password-idp.md
  - docs/product/RQ-0005-user-roles-in-identity-token.md
  - docs/reference/api.md
  - docs/guides/tenant-config.md
maestro:
  feature: federated-user-identity-view
  kind: functional_spec
  summary: |
    Google sign-in already issues a token, but the person behind it is never saved — so they get no
    roles, can log in even after being disabled, and never show up in the admin console. Make a
    Google-authenticated person a real user record the moment they first log in, apply the same
    roles and status rules the password login already enforces, and show them (with their linked
    Google identity) in the operator console alongside password users. The issued token does not
    change, so nothing that already verifies tokens has to change.
---

# RQ-0011 — Federated user identity: persist Google logins as first-class, manageable users

- **Status:** proposed
- **Raised:** 2026-07-01
- **Owner:** @farid (architect)
- **Decision:** [ADR-0012 — Federated identity is a first-class user record](../design/decisions/0012-federated-identity-and-account-linking.md)
- **Origin:** follow-on from RQ-0001 (Google SSO shipped) — the *issuance* works; the *identity record* behind it was deferred ("store both, match on either") and is now needed to manage people who only ever log in with Google.

> **For the implementing agent:** read [ADR-0012](../design/decisions/0012-federated-identity-and-account-linking.md) first — it fixes the model and, critically, the constraint that **the issued token's `email`/`sub` claims must not change** (maestro's shipped verifier depends on them, RQ-0001). This requirement is additive and issuer-internal: no consumer redeploys. Work on an `identity-service/*` branch, open a PR, keep CI green, and do not touch the client-credentials grant or the token claim shape.

## Why

Google login (RQ-0001) mints a token from a TTL-swept `oauth_authorizations` record and persists **no
user**. The `users` collection (`service/src/models/user.ts`) is local-password-only (`passwordHash`
required, `_id` = UUID = token `sub`). Three consequences, all live today:

1. **Roles silently fail for Google users.** `loadUserRoles(sub)` → `User.findById(sub)`
   (`service/src/oauth/server.ts:506`); for Google, `sub` is the Google subject, never a `users._id`, so
   the token always carries `roles: []` (RQ-0005 is local-only in practice).
2. **Status/lockout is bypassed on the Google path.** The password grant enforces `status`/`lockedUntil`;
   the Google path enforces neither — a *disabled* person can still get a token via Google.
3. **Google-only people are invisible to the admin plane** (console / `/admin/v1` / MCP list the `users`
   collection); they cannot be listed, given a role, disabled, or audited as principals.

## Current state (reuse it — do not rebuild)

- ✅ **Google OIDC + PKCE flow** — `service/src/oauth/google.ts`, `handleUserAuthorize` /
  `handleGoogleCallback` / `issueAuthorizationCodeToken` (`service/src/oauth/server.ts`). Untouched here.
- ✅ **Local user record + status/lockout/roles** — `service/src/models/user.ts`, the password grant, and
  `loadUserRoles`. This RQ generalizes it to all providers.
- ✅ **Session per login** — `issueUserTokens` already writes a `sessions` doc (`contactId = sub`); that is
  ephemeral session state, not a durable person. Keep it.
- ✅ **Admin plane** — `service/src/services/admin.ts`, `admin-routes.ts`, MCP, console user CRUD. Extended,
  not replaced.
- ❌ **No durable federated user record; no roles/status on the Google path; no identity view in admin.**

## Fixed contract (must not change)

- The emitted user token's claims stay exactly as today: `email`, `sub` (local = UUID `_id`; federated =
  Google subject), `iss`, `aud`, `exp`/`iat`, `roles`. **Do not** add or re-point `sub`.
- The existing client-credentials grant and JWKS are unchanged.
- `/.well-known/jwks.json` and key rotation behaviour are unchanged.

## Scope

1. Make the `users` collection **provider-agnostic** (optional `passwordHash`, an `identities[]` list).
2. **JIT-provision** a user on first federated login; **link** on a verified, matching email.
3. **Resolve roles and enforce status/lockout** on the federated path (same guarantees as password).
4. Surface federated users + their linked identities in the **management plane** (console, `/admin/v1`,
   MCP), with audit for provisioning and link/unlink.

## Out of scope

- **Changing the token contract** (claims/`sub`) or the client-credentials grant.
- **A canonical cross-provider subject** ("one person = one `sub`") — deferred; needs consumer
  coordination (ADR-0012 Consequences).
- **Non-Google IdPs** (Okta/Azure/SAML) — a separate additive requirement.
- **Backfilling** historical Google-only people — they materialize JIT on next login (ADR-0012 §7).

## Implementation details — user stories

Each story is independently shippable and carries EARS-style acceptance criteria. Suggested order is
US-1 → US-6; US-5 depends on US-1, US-3/US-4 depend on US-2.

### US-1 — Provider-agnostic user record
*As the platform, I want a single user record that can hold a local credential and/or federated
identities, so a person is one row regardless of how they authenticate.*

- THE `users` schema SHALL make `passwordHash` **optional** and add `identities: [{ provider, subject,
  email, emailVerified, linkedAt }]` (`service/src/models/user.ts`).
- THE SYSTEM SHALL enforce a partial/sparse **unique** index on `(tenantId, identities.provider,
  identities.subject)` and RETAIN the existing unique `(tenantId, email)`.
- WHERE a user has no `passwordHash`, the password grant SHALL reject it as it does a wrong password
  (uniform failure, no enumeration) — a federated-only user cannot password-login.
- Existing local users SHALL remain valid unchanged (additive migration; no data rewrite).

### US-2 — JIT-provision a user on first Google login
*As an operator, I want a Google-authenticated person to become a real user on first login, so I can see
and manage them.*

- WHEN a Google callback establishes an identity, THE SYSTEM SHALL **upsert** a `users` record keyed by
  `(tenantId, provider='google', subject=<google sub>)`, capturing `email`, `emailVerified`, and
  `lastLoginAt`, before issuing the token (`issueAuthorizationCodeToken`, `service/src/oauth/server.ts`).
- THE upsert SHALL be idempotent under concurrent logins (no duplicate rows on a race).
- Provisioning SHALL be written to `audit_logs` as an operational mutation (ADR-0007/0011).
- THE issued token's claims SHALL be **byte-for-byte unchanged** vs. today (regression-tested).

### US-3 — Roles & status enforced on the federated path
*As a security owner, I want Google logins to obey roles and status exactly as password logins do.*

- THE SYSTEM SHALL replace `loadUserRoles(sub)`'s `findById` with a resolver that matches a user by a
  linked identity `subject` **or** local `_id` within the tenant (`service/src/oauth/server.ts:506`).
- WHEN issuing a federated token, THE SYSTEM SHALL stamp the resolved user's `roles` (RQ-0005 now applies
  to Google users).
- IF the resolved user's `status` is `disabled` or currently `locked`, THEN THE SYSTEM SHALL deny the
  flow and issue **no** token (closing the current bypass).
- WHERE no user is resolved (should not happen post-US-2), THE SYSTEM SHALL fail closed.

### US-4 — Link on verified email; never auto-merge on an unverified one
*As a person with both a password account and Google, I want them to be the same account — but only when
it's provably me.*

- WHEN a federated login's `email` matches an existing user in the same tenant **and** the upstream
  asserts `email_verified === true`, THE SYSTEM SHALL add the identity to that existing user (link) rather
  than create a new row.
- WHERE the email does **not** match any existing user, THE SYSTEM SHALL create a distinct user.
- IF the email matches an existing user but is **unverified**, THEN THE SYSTEM SHALL **deny** the login
  (`access_denied`) rather than merge onto or shadow that account — the account-takeover guard. (The
  `(tenantId, email)` uniqueness makes a shadow row impossible anyway; denying is the safe, explicit
  outcome.)
- THE SYSTEM SHALL NOT link across tenants.
- Linking (automatic and operator-driven) SHALL be audited.

### US-5 — Federated users & identities in the management plane
*As an operator, I want to see and manage Google users next to password users, with their linked
identities visible.*

- THE `/admin/v1` user list/read, MCP read tools, and the console SHALL return users regardless of
  provider and SHALL expose each user's `identities[]` (provider + masked subject + email + linkedAt).
- THE console user detail view SHALL show linked identities and offer operator **link / unlink** actions;
  link/unlink SHALL go through `/admin/v1` and be audited (`service/src/services/admin.ts`,
  `admin-routes.ts`, `console/`).
- WHERE a user is federated-only, the console SHALL NOT offer password-only affordances (e.g. "reset
  password") except to *set an initial* local credential.

### US-6 — Docs, seed, and tests
*As a maintainer, I want the new model documented and proven.*

- `docs/reference/api.md` SHALL document the `identities[]` shape on user responses and any link/unlink
  endpoints; `docs/guides/tenant-config.md` SHALL note JIT provisioning + the verified-email linking rule.
- Seed/example config SHALL show a federated-only user and a linked (local+google) user.
- Tests SHALL cover: token claims unchanged (US-2), roles present + `disabled` denied on the Google path
  (US-3), link-on-verified vs. no-merge-on-unverified (US-4), and the concurrent-login upsert race.

## Acceptance criteria (rollup, EARS)

- WHEN a person logs in with Google for the first time, THE SYSTEM SHALL create a manageable `users`
  record with their Google identity linked, and issue a token with **unchanged** `email`/`sub` claims.
- WHEN a Google user has roles assigned, THE SYSTEM SHALL stamp them into the token (RQ-0005 parity).
- IF a person is `disabled` or `locked`, THEN THE SYSTEM SHALL deny **both** the password and the Google
  path.
- WHEN a Google email is verified and matches an existing tenant user, THE SYSTEM SHALL link; IF it is
  unmatched THE SYSTEM SHALL create a distinct user; IF it matches but is unverified THE SYSTEM SHALL deny
  (never merge).
- THE management plane SHALL list and manage federated users and show their linked identities, with audit.
- WHERE the client-credentials grant, the token contract, or the JWKS is concerned, THE SYSTEM SHALL
  behave unchanged (this requirement is additive).

## Definition of done

- A Google-only person appears in the console as a user with a linked Google identity after first login;
  an operator can assign a role and disable them, and disabling blocks their next Google login.
- A federated token carries the person's `roles`; its `email`/`sub`/`iss`/`aud`/`exp` are provably
  identical to pre-change (maestro verifier passes with no redeploy).
- Verified-email linking and the no-merge-on-unverified guard are tested; link/unlink is auditable.
- `docs/reference/api.md` and `docs/guides/tenant-config.md` updated; ADR-0012 marked accepted.
