---
title: "RQ-0009 — Console ↔ management-API parity"
status: current
last_updated: 2026-06-25
owners: [architect]
related:
  - docs/design/decisions/0007-management-api-mcp-and-standalone-identity-service.md
  - docs/reference/api.md
  - docs/product/RQ-0007-console-operator-login.md
  - console/README.md
maestro:
  feature: console-api-parity
  kind: functional_spec
  summary: |
    Close the gap between what the management API can do and what the admin console exposes. The API
    can delete a client and inspect signing keys, but the console offers neither; the clients screen
    also makes operators hand-edit the URL to pick a tenant. Add a delete-client action, a signing-key
    list (with the published JWKS view), and a tenant picker so operators can do every day-2 task from
    the UI rather than dropping to curl. Each new action rides the same audited per-actor path as the
    rest of the console.
---

# RQ-0009 — Console ↔ management-API parity

- **Status:** accepted
- **Raised:** 2026-06-25
- **Owner:** @farid (architect)
- **Decision:** [ADR-0007](../design/decisions/0007-management-api-mcp-and-standalone-identity-service.md)

## Why

ADR-0007 sells the console as the surface that keeps human operators off `curl`. Several
`/admin/v1` capabilities have no console affordance, which forces exactly that drop to the command line:

- **Delete client** shipped to the service + HTTP route + MCP tool (PR #31) but has no UI.
- **Signing keys** can be listed (`GET /keys`) and the JWKS is published, yet the console only offers a
  blind "rotate" button — an operator can't see current/inactive keys before rotating.
- The **clients** screen requires manually appending `?tenantId=…` to the URL to list a tenant's clients.

This story brings the console up to the API's surface so day-2 operations are complete in the UI.

## Scope

1. **Delete client** — a guarded action (confirm step) calling the delete-client route (PR #31),
   surfaced on the clients screen.
2. **Signing-key list** — render `GET /keys` (active + inactive, `kid`, status, timestamps) and a view
   of the published JWKS, alongside the existing rotate action so rotation is an informed choice.
3. **Tenant picker** — a selector on the clients screen (and where else a `tenantId` is required) so
   operators choose a tenant instead of editing the URL; pre-populate client/user forms from it.
4. Consistent **audited per-actor** path: every new mutation goes through a Server Action on the
   operator's token ([RQ-0007](RQ-0007-console-operator-login.md)).

## Out of scope

- **New `/admin/v1` endpoints** — this story consumes existing routes only; any missing API capability
  is raised separately.
- **Bulk operations** (multi-select delete, batch import) — deferred.
- **Tenant *delete*** — not offered by the API; out of scope until it is.

## Acceptance criteria (EARS)

- THE console SHALL provide a delete-client action that calls the management API's delete-client route and requires an explicit operator confirmation before deleting.
- THE console SHALL display the signing-key store from `GET /keys` (active and inactive keys with `kid`, status, and timestamps) and a view of the published JWKS.
- WHEN an operator views the clients screen, THE console SHALL let them select a tenant from a picker rather than editing the URL, and SHALL list that tenant's clients.
- WHEN a tenant is selected, THE console SHALL pre-populate the tenant field of the client and user forms.
- WHERE a new action mutates state, THE console SHALL route it through a Server Action carrying the operator's token, so it is audited per-actor.
- IF a delete or key operation fails, THEN THE console SHALL surface the API error and leave state unchanged.

## Definition of done

- An operator can delete a client, list/inspect signing keys (and the JWKS), and pick a tenant — all from the UI, no URL editing or curl.
- Each new mutation appears in `GET /audit` attributed to the operator.
- Covered by tests per [RQ-0008](RQ-0008-console-test-harness.md).
- `console/README.md` and, if needed, `docs/reference/api.md` reflect the console's full surface.
