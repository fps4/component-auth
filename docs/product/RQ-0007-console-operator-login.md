---
title: "RQ-0007 — Operator login & per-actor identity for the admin console"
status: current
last_updated: 2026-06-25
owners: [architect]
related:
  - docs/design/decisions/0010-console-operator-authentication.md
  - docs/design/decisions/0007-management-api-mcp-and-standalone-identity-service.md
  - docs/design/decisions/0005-decentralized-authorization.md
  - docs/reference/api.md
  - console/README.md
maestro:
  feature: console-operator-login
  kind: functional_spec
  summary: |
    Give the admin console a real operator sign-in instead of a single shared admin token baked into
    the server. An operator logs in with their identity-service credentials; the console keeps that
    session and forwards the operator's own token to the management API, so every management action is
    audited against the human who performed it — the per-actor promise ADR-0007 makes. The console
    reuses maestro-web's proven auth edge: a password-grant login, a short-lived token cookie the
    server reads, a navigation gate that redirects to /login, and silent refresh. The static admin
    token stays only as a break-glass / non-interactive fallback.
---

# RQ-0007 — Operator login & per-actor identity for the admin console

- **Status:** accepted
- **Raised:** 2026-06-25
- **Owner:** @farid (architect)
- **Decision:** [ADR-0010](../design/decisions/0010-console-operator-authentication.md) (extends [ADR-0007](../design/decisions/0007-management-api-mcp-and-standalone-identity-service.md))

## Why

ADR-0007 justifies the console as a **human face** on an **audited, per-actor** management plane. As
built, the console authenticates with one static `ADMIN_API_TOKEN` in server env, so every mutation is
attributed to a single admin client — there is no operator identity and the audit log cannot say *who*
onboarded a tenant or rotated a secret. maestro-web already solved exactly this (its `lib/auth` +
`middleware` + `/login`, ADR-0019): an operator signs in against identity-service, the Next server
forwards the operator's token, and the resource server attributes the action. This story brings that
pattern to the console so the per-actor audit ADR-0007 promises is real.

## Scope

1. A **`/login` route** (public) with a password-grant form against identity-service's local IdP,
   reusing maestro-web's `LoginForm` / `lib/auth` shape (`requestPasswordToken`, `refresh_token` grant,
   silent refresh, `LoginError`).
2. A **session edge**: the access token is mirrored into a server-readable cookie; `lib/api.ts` attaches
   **the operator's** token (not a static env token) so `/admin/v1` sees the real principal.
3. **`middleware.ts`** that gates every console route on a fresh token (cheap `exp` decode, no signature
   check — the service verifies via JWKS) and redirects unauthenticated requests to `/login?next=…`
   (same-origin only, no open redirect).
4. A **user menu** showing the signed-in operator with a sign-out that clears the session.
5. The console must use an OAuth client + admin scope sufficient for the operator's token to satisfy
   `/admin/v1` (the `admin` superscope or granular `admin:*`).
6. **Break-glass fallback:** retain `ADMIN_API_TOKEN` for non-interactive/bootstrap use, clearly marked
   as not per-actor.

## Out of scope

- **Google-SSO operators** — natural follow-up over the existing redirect helpers; password grant only now.
- **Console-side RBAC / fine-grained operator roles** — the service already gates on admin scopes;
  per-screen authorization in the console is deferred.
- **Changes to `/admin/v1` itself** — the API already authenticates bearer tokens and audits the
  principal; this is a console-side change only.

## Acceptance criteria (EARS)

- THE console SHALL provide a public `/login` route that performs the OAuth `password` grant against identity-service and establishes an operator session on success.
- WHEN an authenticated operator issues a management action, THE console SHALL forward **that operator's** access token to `/admin/v1`, so the audit log attributes the action to the operator's principal.
- WHEN an unauthenticated or expired request reaches any non-public console route, THE console SHALL redirect to `/login` with a same-origin `next` parameter and render no protected content.
- WHILE an operator session is active and the access token is near expiry, THE console SHALL silently refresh it using the `refresh_token` grant before the next request.
- WHEN an operator signs out, THE console SHALL clear the session so subsequent navigation is gated again.
- THE console SHALL keep the operator's access token out of any client-readable store beyond what maestro-web's pattern requires, and SHALL never expose the static break-glass `ADMIN_API_TOKEN` to the browser.
- IF login is rejected, THEN THE console SHALL surface the error and establish no session.

## Definition of done

- `/login`, the auth edge (`lib/auth`-equivalent), `middleware.ts`, and the user menu are implemented and aligned to maestro-web's structure.
- An operator can sign in with identity-service credentials, perform a management action, and see it attributed to their principal in `GET /audit`.
- An unauthenticated visit to any protected route redirects to `/login`; sign-out re-gates.
- `console/README.md` documents the operator-login flow and the break-glass fallback; the console-auth decision is recorded in [ADR-0010](../design/decisions/0010-console-operator-authentication.md).
- Covered by tests per [RQ-0008](RQ-0008-console-test-harness.md) (login success/rejection, middleware gate, token forwarding).
