---
title: "0001: A local email/password IdP alongside Google SSO"
summary: "Add a local email/password identity provider as a per-tenant alternative to Google SSO, issuing the same user identity token; an admin HTTP management API is deferred."
status: accepted
last_updated: 2026-06-01
date: 2026-06-01
related:
  - ../../product/RQ-0002-local-password-idp.md
  - ../../product/RQ-0001-workspace-user-identity-google-sso.md
  - ../../reference/api.md
  - ../../guides/tenant-config.md
---

## Context

[RQ-0001](../../product/RQ-0001-workspace-user-identity-google-sso.md) added human identity via
**Google SSO**, and a consumer (maestro) deliberately chose *"don't roll our own auth — delegate
identity to Google."* But not every consumer of identity-service can or wants to require a Google
account: local development without a Google app, evaluation environments, and consumers whose users
are outside any Google tenant. The need surfaced concretely as *"do we have a simple username/password
option?"* while standing up a dev deployment with Google not yet wired.

The risk is contradicting that stance — re-introducing a bespoke credential blob that competes with the
"identity comes from Google" model, or weakening the token contract consumers verify.

## Decision

**Add a local email/password identity provider as a second, independent IdP in identity-service — not a
replacement for Google, and not a change to the issued token contract.**

- A tenant opts in by enabling the `password` grant and marking `oauth.idp.provider: 'local'`. Google
  (`authorization_code`) and local (`password`) are independent per-tenant choices; a consumer that
  uses Google is unaffected.
- Local login issues the **same RS256 user token** (`email` + stable `sub` + `iss` + per-consumer
  `aud` + `exp`/`iat`) the Google flow issues, via the **same signing path and JWKS**. A consumer
  (maestro) verifies it identically — it cannot tell which IdP authenticated the user, by design.
- The user's stable `sub` is a server-minted immutable id (not the email), matching the RQ-0001
  identity semantics (survives an email change).
- **Passwords** are stored as salted scrypt hashes (the existing `hashSecret`); a configurable policy
  (min length) and brute-force **lockout** (N failures → temporary lock) apply. Bad email and bad
  password return the same error (no user enumeration).
- **Registration is self-service** (`POST /v1/tenants/:id/register`, rate-limited per tenant).
  **Password reset is operator-mediated** via a CLI (`manage-users`) — there is no email/SMS channel
  in this service yet, so self-service email reset is deferred rather than faked.

### Why not the alternatives

- **Keep Google-only (the original Google-SSO stance).** Cleanest, but blocks local/eval use and any
  non-Google user population. The local IdP is additive and per-tenant, so the original
  Google-for-the-workspace default is untouched.
- **A dev-only stub token issuer.** Considered; it solves "test without Google" but is not a real
  login and must be hard-gated off in prod. The architect chose a real, permanent credential IdP.
- **Self-service password reset now.** Needs an email/SMS provider this service doesn't have;
  operator-mediated reset avoids standing up mail infrastructure under time pressure. Revisit when a
  delivery channel exists.

## Consequences

- **A second auth method, one token contract.** Consumers integrate once; the IdP is a tenant config
  choice. maestro keeps Google; other consumers can use local credentials with zero verifier changes.
- **New `users` collection + a password-management surface** (self-service register, operator CLI).
  identity-service now stores credentials — a new security responsibility (hashing, lockout, rate limit
  are in place; password reset delivery and email verification are explicitly deferred).
- **The Google-SSO stance stands.** This does not mandate local auth anywhere; it offers it. The "identity, not
  authorization" boundary is unchanged — local login still only proves *who you are*.
- **Deferred follow-ups** (named, not built): email verification, self-service password reset over a
  real delivery channel, and an admin-authenticated HTTP management API (today management is CLI/DB).
