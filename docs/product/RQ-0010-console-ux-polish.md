---
title: "RQ-0010 — Admin console UX & information-architecture polish"
status: current
last_updated: 2026-06-25
owners: [architect]
related:
  - docs/design/decisions/0007-management-api-mcp-and-standalone-identity-service.md
  - docs/product/RQ-0007-console-operator-login.md
  - docs/product/RQ-0009-console-api-parity.md
  - console/README.md
maestro:
  feature: console-ux-polish
  kind: functional_spec
  summary: |
    Tidy the admin console's everyday usability now that its surface is complete. Replace free-text
    fields that should be choices (IdP provider, user status) with proper selects, standardise success
    and error toasts, give every list a clear empty and error state, add light/dark theming and a
    consistent nav with the operator menu, and make one-time secrets safe to reveal and copy rather
    than flashing past in a toast. No new capability — this is the finish that makes the console
    pleasant and hard to misuse, matching maestro-web's UX conventions.
---

# RQ-0010 — Admin console UX & information-architecture polish

- **Status:** accepted
- **Raised:** 2026-06-25
- **Owner:** @farid (architect)
- **Decision:** [ADR-0007](../design/decisions/0007-management-api-mcp-and-standalone-identity-service.md)

## Why

The console's screens work but were built as an MVP: IdP provider and user status are typed as free
text ("local/google/blank", "active/disabled") that an operator can get wrong; a freshly minted client
secret is shown only via a transient toast (easy to lose, awkward to copy); empty/error states are
inconsistent; there's no theming or a settled nav. With login ([RQ-0007](RQ-0007-console-operator-login.md))
and full API parity ([RQ-0009](RQ-0009-console-api-parity.md)) in place, this story applies the finish —
aligned to maestro-web's UX conventions (shadcn/ui, next-themes, sonner) — so the console is pleasant
and hard to misuse.

## Scope

1. **Constrained inputs** — replace free-text provider/status fields with selects (and any other field
   with a fixed value set), so invalid values can't be submitted.
2. **One-time secret handling** — show a client secret (on create/rotate) in a copy-to-clipboard reveal
   with a clear "shown once" warning, instead of a transient toast only.
3. **Empty & error states** — every list and dashboard panel has a consistent empty state and a clear
   error state (the management API unreachable, a failed action), reusing sonner for action feedback.
4. **Nav & theming** — a settled left/top nav including the operator user menu ([RQ-0007](RQ-0007-console-operator-login.md)),
   and light/dark theme via `next-themes`.
5. **Accessibility basics** — labelled inputs, focus states, keyboard-navigable forms and tables.

## Out of scope

- **New management capabilities** — those are [RQ-0009](RQ-0009-console-api-parity.md); this is finish only.
- **Full design-system / brand work** — adopt the existing shadcn/ui tokens; no bespoke theme.
- **Internationalisation.**

## Acceptance criteria (EARS)

- THE console SHALL present fixed-value fields (e.g. IdP provider, user status) as selects, so an operator cannot submit an out-of-set value.
- WHEN a client secret is minted or rotated, THE console SHALL present it in a copy-to-clipboard reveal with a clear one-time-only warning, not solely a transient toast.
- THE console SHALL render a consistent empty state for every list and a clear error state when the management API is unreachable or an action fails.
- THE console SHALL provide a consistent navigation including the operator user menu, and SHALL support light and dark themes.
- THE console SHALL label all form inputs and be operable by keyboard for its primary flows.
- WHERE an action succeeds or fails, THE console SHALL give consistent toast feedback.

## Definition of done

- Provider/status (and similar) fields are selects; no free-text value-set inputs remain.
- A minted secret can be revealed and copied with a one-time warning.
- Every list/dashboard panel has empty and error states; theming and nav with the user menu are in place.
- Primary flows pass a basic keyboard/labels accessibility check.
- Covered by tests per [RQ-0008](RQ-0008-console-test-harness.md); `console/README.md` notes the UX conventions.
