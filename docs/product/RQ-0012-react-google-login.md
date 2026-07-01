---
title: "RQ-0012 — 'Continue with Google' in the drop-in <Login/>"
status: proposed
last_updated: 2026-07-01
owners: [architect]
related:
  - docs/product/RQ-0003-react-login-component.md
  - docs/product/RQ-0001-workspace-user-identity-google-sso.md
  - docs/reference/api.md
  - docs/guides/tenant-config.md
maestro:
  feature: react-login-google-button
  kind: functional_spec
  summary: |
    Add a "Continue with Google" button to the shared drop-in <Login/> so consumers get Google sign-in
    the same way they already get email/password — without hand-rolling the redirect + PKCE plumbing.
    The button starts the browser redirect flow and stashes the PKCE verifier; a one-call helper
    completes the exchange on the consumer's callback route. The token contract and endpoints are
    unchanged (RQ-0001); this is UI/DX only.
---

# RQ-0012 — "Continue with Google" in the drop-in `<Login/>`

- **Status:** proposed
- **Raised:** 2026-07-01
- **Owner:** @farid (architect)
- **Decision:** additive to [RQ-0003](RQ-0003-react-login-component.md) — no new ADR; reuses the RQ-0001 mechanism and the ADR-0005 authorization boundary.

## Why

Google SSO shipped as endpoints + headless SDK helpers (RQ-0001), and the drop-in `<Login/>` (RQ-0003)
covers only the `password` grant. So every consumer that wants a Google button re-implements the same
redirect + PKCE + callback plumbing (and some, like sovereign-skills-coach, inline it). The reusable
piece — the button, the PKCE stash, and a one-call callback completion — belongs in the shared package.

The asymmetry is intrinsic, not incidental: **password is a single POST** the component can own
end-to-end, whereas **Google is a redirect flow** — it needs a registered `redirect_uri`, a callback
route, and token storage, all consumer-owned. So this RQ standardizes the *button + PKCE handoff* and
gives the consumer a one-liner for the *one* piece it must own (the callback), rather than pretending the
component can own the whole flow.

## Scope

1. An optional **"Continue with Google"** affordance on `<Login/>` (a `google` prop). When set, the
   component renders the button (alongside the password form, or alone via `hidePasswordForm`).
2. **Turnkey redirect helpers**, dependency-free (Web Crypto PKCE), mirroring the SDK contract:
   - `beginGoogleLogin` / `completeGoogleLogin` — pure (build authorize URL + PKCE / exchange code).
   - `startGoogleLoginRedirect` — stash PKCE verifier + state in `sessionStorage`, navigate to `/oauth2/authorize`.
   - `completeGoogleLoginFromRedirect` — read `code`/`state` from the callback URL, validate state against
     the stash (CSRF guard), exchange, clear the stash.
3. **Docs** — README usage (button + callback route) and the config prerequisites.

## Out of scope

- **Changing endpoints or the token contract** (RQ-0001) — this is UI/DX only.
- **Owning the consumer's callback route or token storage** — the consumer wires the route (one call) and
  decides where the token lives.
- **Provisioning the tenant/client for Google** — that is seed/config (grant + redirect URI) plus the
  deployment's Google app env (ADR-0011); documented here, not done here.
- **Non-Google providers** — deferred.

## Acceptance criteria (EARS)

- WHERE a `google` option with a `redirectUri` is provided, THE `<Login/>` SHALL render a
  "Continue with Google" button; WHERE `hidePasswordForm` is also set, it SHALL render the button alone.
- WHEN the Google button is activated, THE SYSTEM SHALL mint an **S256 PKCE** pair, persist the verifier +
  state, and navigate the browser to `/oauth2/authorize` with `client_id`, `redirect_uri`,
  `code_challenge`, `code_challenge_method=S256`, and `state`.
- WHEN the consumer's callback invokes `completeGoogleLoginFromRedirect`, THE SYSTEM SHALL validate the
  returned `state` against the persisted value and reject a mismatch (CSRF guard) issuing **no** token.
- WHEN state validates, THE SYSTEM SHALL exchange the `code` + PKCE verifier via the `authorization_code`
  grant and return the same `UserTokenResponse` shape as the password helper, then clear the stash.
- IF the callback URL carries an OAuth `error`, THEN THE SYSTEM SHALL surface it and issue no token.
- THE helpers SHALL be dependency-free (Web Crypto) so the package keeps only its React peer dependency.
- WHERE only the password form is used, THE `<Login/>` SHALL behave exactly as in RQ-0003 (additive).

## Definition of done

- `<Login google={{ redirectUri }} />` renders a working Google button; a consumer callback route using
  `completeGoogleLoginFromRedirect` obtains a token that passes the existing verifier (RQ-0001).
- Helpers are exported from `@fps4/identity-service-react`; README documents the button + callback + config.
- Unit tests cover authorize-URL construction, the code exchange, the state-mismatch CSRF guard, and the
  upstream-error path. Package builds with no new runtime dependency.
