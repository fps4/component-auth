---
title: "RQ-0002 — Local email/password identity provider"
status: current
last_updated: 2026-06-01
owners: [architect]
related:
  - docs/decisions/0001-local-credential-idp.md
  - docs/requirements/RQ-0001-workspace-user-identity-google-sso.md
  - docs/api.md
  - docs/tenant-config.md
maestro:
  feature: local-password-idp
  kind: functional_spec
  summary: |
    Let people sign in with an email and password directly through the shared auth service, as an
    alternative to Google sign-in, for tenants that turn it on. Users register themselves, then log
    in to receive the same signed identity token the workspace already checks. Passwords are stored
    hashed, weak passwords are rejected, and repeated wrong guesses lock the account for a while.
    There is no email-based password reset yet — an operator resets passwords with a command-line
    tool. Google sign-in and machine tokens are unaffected.
---

# RQ-0002 — Local email/password identity provider

- **Status:** accepted
- **Raised:** 2026-06-01
- **Owner:** @farid (architect)
- **Decision:** [ADR-0001](../decisions/0001-local-credential-idp.md)

## Why

[RQ-0001](RQ-0001-workspace-user-identity-google-sso.md) issues human identity via Google SSO. Some
consumers need a login that does not depend on a Google account (local dev, evaluation, users outside
any Google tenant). This adds component-auth's **own** email/password IdP as a second, opt-in method
that issues the **same** verifiable user token — so consumers integrate once.

## Scope

1. **Self-service registration** — `POST /v1/tenants/:tenantId/register` for tenants with the local
   IdP enabled; rate-limited per tenant.
2. **Password login** — `grant_type=password` (email + password) issuing the RQ-0001 user token
   (`email` + stable `sub` + `iss` + per-consumer `aud` + `exp`/`iat`) via the existing key + JWKS.
3. **Password policy + brute-force lockout** — configurable minimum length; N failures → temporary lock.
4. **Operator password management** — a CLI to create users, reset passwords, and lock/unlock/disable
   (the reset path while there is no email channel).
5. **SDK helpers** — `registerWithPassword` + `loginWithPassword`.

## Out of scope

- **Email verification** and **self-service (email-delivered) password reset** — deferred until a mail
  channel exists (ADR-0001).
- **An admin-authenticated HTTP management API** — management is CLI/DB today; component-auth has no
  request-auth layer yet.
- **Changing Google SSO, client-credentials, or the issued token contract** — this is additive.

## Acceptance criteria (EARS)

- WHEN a tenant has `oauth.enabled`, allows the `password` grant, and marks `oauth.idp.provider: 'local'`, THE SYSTEM SHALL accept self-service registration and password login for that tenant; otherwise it SHALL refuse both.
- WHEN a user registers with a valid email and a password meeting the configured policy, THE SYSTEM SHALL create an account with a salted-hashed password and a stable, immutable subject id, and SHALL NOT store the raw password.
- IF the email is already registered for the tenant, THEN THE SYSTEM SHALL reject the registration (409) and create no account.
- WHEN a user logs in with correct credentials, THE SYSTEM SHALL issue an RS256 user token carrying `email`, the immutable `sub`, `iss`, the client-bound `aud`, and `exp`+`iat`, verifiable via the existing `/.well-known/jwks.json` — identical in shape to the Google-SSO token.
- IF the email is unknown OR the password is wrong, THEN THE SYSTEM SHALL return the same generic `invalid_grant` error (no user enumeration) and issue no token.
- WHEN failed login attempts reach the configured maximum, THE SYSTEM SHALL temporarily lock the account so that even a correct password is refused until the lock expires.
- WHERE a user account is disabled, THE SYSTEM SHALL refuse login regardless of the password.
- WHERE the existing Google SSO, client-credentials, and refresh/revoke flows are used, THE SYSTEM SHALL continue to behave unchanged (this requirement is additive).
- THE SYSTEM SHALL provide an operator CLI to create users, reset passwords, and lock/unlock/disable accounts.

## Definition of done

- A user can register and log in with email/password through a local-IdP tenant and receive a token that **passes maestro's verifier unchanged**.
- Wrong-password, unknown-email, lockout, disabled-account, weak-password, duplicate-email, and grant-gating paths are covered by tests.
- `docs/api.md`, `docs/tenant-config.md`, and `docs/architecture.md` document the new endpoints, tenant config, and `users` collection; ADR-0001 records the decision.
