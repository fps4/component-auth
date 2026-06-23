---
title: "0002: An optional React UI package (drop-in Login), separate from the headless SDK"
status: accepted
date: 2026-06-01
related:
  - 0001-local-credential-idp.md
  - ../../product/RQ-0003-react-login-component.md
  - ../../product/RQ-0001-workspace-user-identity-google-sso.md
---

## Context

[RQ-0001](../../product/RQ-0001-workspace-user-identity-google-sso.md) deliberately kept **UI out of
identity-service**: it ships backend flows + a headless TypeScript SDK, and "the consumer's login UI"
was out of scope (the consumer puts the login screen in its own app). That holds for maestro,
which builds its own surface.

But a second consumer needs a login screen and would rather **reuse** one
than hand-roll it (its auth is planned; today it runs on a hardcoded user). The
architect chose: ship a **reusable React `<Login/>` component from identity-service** so consumers drop
it in rather than each rebuilding the form.

This reverses the "auth service stays UI-free" stance, so it is recorded here. The risk to avoid is
forcing a React dependency onto **server-side** SDK consumers (the client-credentials grant runs in
Node with no React), or coupling the component to one app's design system.

## Decision

**Ship the React UI as a separate, opt-in package — `@fps4/identity-service-react` — not by adding React
to the headless `@fps4/identity-service-sdk` SDK.**

- The new `react/` package exports a drop-in `<Login/>` (email/password against the local IdP,
  RQ-0002) plus the underlying `requestPasswordToken` function for custom UIs.
- **React is a peer dependency**; the package is otherwise self-contained (it calls identity-service's
  HTTP API directly, not via the SDK), so a consumer adds exactly one dependency it doesn't already
  have. The headless SDK is untouched — server-side consumers never transitively pull in React.
- The component is **styling-agnostic**: neutral inline defaults so it works with zero CSS, every
  element takes a `className`, and `unstyled` drops the inline styles for Tailwind/shadcn consumers.
- It is a **login form, not a session manager**: it returns the issued token via `onSuccess`. Token
  storage, route guarding, and refresh stay the host app's responsibility.

### Why not the alternatives

- **Add React to `@fps4/identity-service-sdk`.** Simplest to find, but pollutes the headless SDK with a
  React (peer) dependency and JSX build for every consumer, including Node-only ones. Rejected.
- **Build the screen only in the consuming app.** Fine for one app, but the architect explicitly
  wanted reuse across consumers. A shared package pays off as more surfaces appear.
- **A full session/provider kit** (`<AuthProvider>`, route guards, auto-refresh). More than asked
  for and more opinionated about app architecture; deferred. The component returns the token and gets
  out of the way; a richer kit can layer on later without breaking this.

## Consequences

- **identity-service now ships UI**, in a clearly-separated optional package. The default still holds:
  the SDK and service are UI-free; React is opt-in.
- **A new build/test target** (`react/`) joins the DoD CI alongside `service` and `sdk`.
- **Google SSO via the component** is a natural follow-up (a "Sign in with Google" affordance over
  the existing redirect helpers); only the password method ships now (RQ-0003 scope).
- **Session concerns remain the host's** — documented, not hidden. If repetition across consumers
  proves it worthwhile, a provider/guard kit is the additive next step.
