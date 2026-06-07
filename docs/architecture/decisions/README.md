---
title: "Architecture decision records"
maestro:
  feature: documentation-refactor-maestro-standards
  kind: overview
  summary: |
    Index for the architecture decision records of the component-auth
    repository. Each record captures one decision in a single page using the
    standard sections for context, decision, and consequences. Files are named
    with a four-digit sequence number and a hyphenated slug so the order of
    decisions stays clear and stable. Readers and the Maestro workspace use this
    page to list the recorded decisions and open any one of them. New records
    are added with the next number in sequence.
---

# Architecture decision records

This folder holds the architecture decision records (ADRs) for component-auth. Each ADR is a one-page record with three standard sections:

- **Context** — the forces and constraints behind the decision.
- **Decision** — what was decided.
- **Consequences** — what follows, including trade-offs.

## Naming

ADR files are named `NNNN-<slug>.md`, where `NNNN` is a four-digit sequence number assigned in order and `<slug>` is lowercase and hyphen-separated.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-two-plane-documentation-information-architecture.md) | Adopt the two-plane documentation information architecture | Accepted |
