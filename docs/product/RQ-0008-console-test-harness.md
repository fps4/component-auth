---
title: "RQ-0008 — Test & e2e harness for the admin console"
status: current
last_updated: 2026-06-25
owners: [architect]
related:
  - docs/design/decisions/0007-management-api-mcp-and-standalone-identity-service.md
  - docs/product/RQ-0007-console-operator-login.md
  - console/README.md
maestro:
  feature: console-test-harness
  kind: functional_spec
  summary: |
    Give the admin console the same kind of automated test safety net maestro-web already has, so the
    console can change without silently breaking. Add unit/component tests for the Server Actions and
    screens against a faked management API, and a small end-to-end smoke test that drives login and a
    couple of management actions in a real browser against a stubbed API. Wire both into the
    definition-of-done CI so a broken console is caught before merge. No production behaviour changes —
    this is purely the test toolchain.
---

# RQ-0008 — Test & e2e harness for the admin console

- **Status:** accepted
- **Raised:** 2026-06-25
- **Owner:** @farid (architect)
- **Decision:** [ADR-0007](../design/decisions/0007-management-api-mcp-and-standalone-identity-service.md)

## Why

The console ships zero tests, while maestro-web — the stack it reuses — runs vitest +
`@testing-library` + Playwright. The console is a thin proxy over a security-sensitive API
(`/admin/v1`); a regression in token forwarding, the auth gate ([RQ-0007](RQ-0007-console-operator-login.md)),
or a mutation form is exactly the kind of bug that must be caught in CI, not in production. This story
adopts maestro-web's test toolchain and conventions so the console has a safety net before its surface
grows ([RQ-0009](RQ-0009-console-api-parity.md), [RQ-0010](RQ-0010-console-ux-polish.md)).

## Scope

1. **Unit/component tests** with `vitest` + `@testing-library/react` + `jsdom`: Server Actions in
   `app/actions.ts` (success + `ApiError` paths), the `lib/api` client (token attached, errors mapped),
   and key screens render against a **faked** management API.
2. **End-to-end smoke** with Playwright: login → dashboard loads → one tenant/client mutation → audit
   reflects it, run against a **stubbed `/admin/v1`** (reuse maestro-web's `e2e/stub-api` + `fake-auth`
   approach) — no live identity-service required.
3. **CI wiring**: `npm test` (vitest) and `npm run test:e2e` (Playwright) run in the definition-of-done
   pipeline for the console workspace.
4. **Scripts & devDeps** mirrored from maestro-web (`test`, `test:watch`, `test:e2e`; vitest,
   testing-library, jsdom, `@playwright/test`).

## Out of scope

- **Tests for `/admin/v1` itself** — the service has its own suite; this covers the console only.
- **Visual-regression / screenshot diffing** — deferred; functional e2e first.
- **Load/performance testing** of the console.

## Acceptance criteria (EARS)

- THE console SHALL include a `vitest` + `@testing-library` setup that tests Server Actions and screens against a faked management API, with no network to a live service.
- THE console test suite SHALL cover both the success and the error (`ApiError`) path of each Server Action.
- THE console SHALL include a Playwright e2e smoke that drives operator login and at least one management action against a stubbed `/admin/v1`, without requiring a live identity-service.
- WHEN the definition-of-done CI runs for the console workspace, THE pipeline SHALL build the console and execute the vitest suite and fail on any failing test. (The Playwright smoke runs locally until the CI runner provisions a browser — see the DoD `console` job note.)
- WHERE the auth gate and token forwarding from [RQ-0007](RQ-0007-console-operator-login.md) exist, THE suite SHALL assert unauthenticated routes redirect to `/login` and that the operator's token is the one forwarded.

## Definition of done

- `npm test` and `npm run test:e2e` run green locally in `console/`.
- CI runs both suites for the console workspace and blocks merge on failure.
- The faked API and auth stubs are documented so new screens can add tests without a live backend.
- `console/README.md` documents how to run the tests.
