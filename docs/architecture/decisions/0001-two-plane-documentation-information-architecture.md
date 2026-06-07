---
title: "Adopt the two-plane documentation information architecture"
status: accepted
last_updated: 2025-06-12
maestro:
  feature: documentation-refactor-maestro-standards
  kind: architecture_decision
  summary: |
    The component-auth repository adopts the Maestro two-plane documentation
    layout. Product-facing pages live on the product shelf and technical pages,
    including decision records, live on the architecture shelf. Every indexed
    page carries a machine-readable header so the workspace can list and search
    it, and a single navigation index links both shelves. This record fixes the
    layout the repository follows so contributors and tooling resolve the same
    paths without guessing.
---

# 0001. Adopt the two-plane documentation information architecture

## Status

Accepted.

## Context

The component-auth repository predates the Maestro documentation standard. Its documentation lacked a consistent layout: pages sat at ad-hoc paths, many had no machine-readable header, and there was no single entry point. Without a declared structure, contributors guessed where to put new pages and the Maestro workspace could not reliably list or search the repository's documentation.

The Maestro house style defines a two-plane information architecture for managed documentation: a product plane for what a component does and an architecture plane for how it is built, with decision records kept together and a navigation index linking both. Adopting that shared standard here removes the guesswork and lets the workspace index this repository alongside every other.

## Decision

The repository organises all documentation under `docs/` into two shelves:

- `docs/product/` — the product shelf: functional specifications and product-facing references.
- `docs/architecture/` — the architecture shelf: technical designs and architecture decision records, with ADRs under `docs/architecture/decisions/` named `NNNN-<slug>.md`.

Every indexed page carries a `maestro:` frontmatter header with a feature slug, a kind, and a plain-language summary. A single navigation index at `docs/README.md` links both shelves, and the repository root README declares the layout and points to it.

## Consequences

- Contributors and tooling resolve the same documentation paths without guessing.
- The Maestro workspace can list and search this repository's documentation without manual curation.
- Existing pages are relocated and re-headed rather than rewritten, so meaning is preserved while structure improves.
- New documentation follows the declared shelves and naming rules from the start.

## Trade-offs

- Relocating pages changes their paths, so internal cross-links are updated as part of the move. The benefit of a discoverable, consistent layout outweighs the one-time link churn.
