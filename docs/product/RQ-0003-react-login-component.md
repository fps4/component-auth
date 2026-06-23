---
title: "RQ-0003 — Reusable React login component"
status: current
last_updated: 2026-06-07
owners: [architect]
related:
  - docs/design/decisions/0002-optional-react-ui-package.md
  - docs/product/RQ-0002-local-password-idp.md
  - docs/reference/api.md
maestro:
  feature: react-login-component
  kind: functional_spec
  summary: |
    Ship a ready-made sign-in box that React apps can drop onto a page, so each product that uses the
    shared auth service does not rebuild the same email-and-password form. It collects the email and
    password, signs the user in, and hands back the resulting token for the app to keep; the app
    decides where to store it and which pages to protect. It comes as its own small add-on so apps
    that only talk to the service from a server never have to include it.
---

# RQ-0003 — Reusable React login component

- **Status:** accepted
- **Raised:** 2026-06-01
- **Owner:** @farid (architect)
- **Decision:** [ADR-0002](../design/decisions/0002-optional-react-ui-package.md)

## Why

A consumer needs a login screen and would rather reuse one than hand-roll it.
identity-service previously shipped only backend + a headless SDK (RQ-0001); this adds an opt-in React
UI so consumers drop in a `<Login/>` instead of each rebuilding the form.

## Scope

1. A new **separate package** `@fps4/identity-service-react` (React peer dependency only; the headless
   SDK is untouched).
2. A **`<Login/>` component** — email/password against the local IdP (RQ-0002) — that performs the
   `password` grant and returns the issued token via `onSuccess`.
3. **Styling-agnostic**: usable unstyled, every element `className`-able, an `unstyled` escape hatch.
4. The underlying **`requestPasswordToken`** function exported for custom UIs, plus a `LoginError`.

## Out of scope

- **Google SSO button** — a natural follow-up over the existing redirect helpers; password only now.
- **Session management** — token storage, route guarding, auto-refresh, and a provider/guard kit are
  the host app's concern (deferred; ADR-0002).
- **Wiring into any specific consumer** — this ships the component; adoption
  is the consumer's change.

## Acceptance criteria (EARS)

- THE SYSTEM SHALL provide a React `<Login/>` component in a package separate from the headless SDK, depending on React as a peer dependency only.
- WHEN a user submits valid credentials, THE `<Login/>` SHALL perform the `password` grant against identity-service and invoke `onSuccess` with the issued token (access + refresh).
- IF the login is rejected, THEN THE `<Login/>` SHALL surface an error to the user and invoke `onError`, issuing no token.
- THE `<Login/>` SHALL be usable with no styling, SHALL accept a `className` per element, and SHALL support an `unstyled` mode that omits built-in inline styles.
- THE SYSTEM SHALL export the underlying `requestPasswordToken` function and a `LoginError` (carrying the HTTP status) for custom UIs.
- WHERE the headless SDK or the service is used, THE SYSTEM SHALL be unaffected (this package is additive and opt-in).

## Definition of done

- `@fps4/identity-service-react` builds and its login function is covered by tests (success + rejection).
- A consumer can `npm install @fps4/identity-service-react react` and render `<Login/>` against a local-IdP tenant.
- The package README documents usage + styling; ADR-0002 records the design shift; DoD CI builds/tests the package.
