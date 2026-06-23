---
title: identity-service documentation index
status: current
last_updated: 2026-06-07
owners: [architect]
related:
  - docs/overview.md
---

# identity-service docs

Documentation index. identity-service follows the two-plane information architecture of the shared
documentation standard: a **Docs** plane you read, and a **Delivery** plane you track. Docs feed both
humans and agents, so a doc's shelf is **derived from its path** — the folder *is* the shelf.

Start at [`overview.md`](./overview.md) — the product landing.

## Docs plane — reference (you read)

| Shelf | Path | What lives here |
|---|---|---|
| **Overview** | [`overview.md`](./overview.md) | The product landing — what it is, status, where to go next. |
| **Product** | [`product/`](./product) | Intent + functional specs (`RQ-*`) — the *what & why*. |
| **Design** | [`design/`](./design) | [`architecture.md`](./design/architecture.md) + ADRs ([`decisions/`](./design/decisions)) — the *how & why-decided*. |
| **Reference** | [`reference/`](./reference) | The exact lookup surface — [`api.md`](./reference/api.md) (endpoints, token contract, JWKS). The [`GLOSSARY.md`](../GLOSSARY.md) lives at the repo root. |
| **Guides** | [`guides/`](./guides) | How-to / operations / onboarding — [`tenant-config.md`](./guides/tenant-config.md), [`deployment.md`](./guides/deployment.md), [`resource-server-integration.md`](./guides/resource-server-integration.md). |

## Delivery plane — work (you track)

identity-service tracks discrete capabilities as **`RQ-*` requirements** (functional specs) under
[`product/`](./product), each with EARS acceptance criteria and a paired ADR. There is no separate
milestone/epic backlog or issue tracker checked into the repo yet — this plane stays light until the
work warrants it.

| Requirement | Decision |
|---|---|
| [RQ-0001 — User identity via Google SSO](./product/RQ-0001-workspace-user-identity-google-sso.md) | — |
| [RQ-0002 — Local email/password IdP](./product/RQ-0002-local-password-idp.md) | [ADR-0001](./design/decisions/0001-local-credential-idp.md) |
| [RQ-0003 — Reusable React login component](./product/RQ-0003-react-login-component.md) | [ADR-0002](./design/decisions/0002-optional-react-ui-package.md) |
| [RQ-0004 — Seed config provisioning](./product/RQ-0004-seed-config-provisioning.md) | [ADR-0003](./design/decisions/0003-seed-config-not-admin-api.md) |
| [RQ-0005 — User roles in the identity token](./product/RQ-0005-user-roles-in-identity-token.md) | [ADR-0005](./design/decisions/0005-decentralized-authorization.md) |

## Agent-facing files (repo root)

- [`CODEBASE.md`](../CODEBASE.md) — the first file an agent reads: what the product does, directory map, entry points.
- [`GLOSSARY.md`](../GLOSSARY.md) — terms where business language and code diverge.
- [`AGENTS.md`](../AGENTS.md) — what agents may/may not do, how to run things, pre-submit checks.
