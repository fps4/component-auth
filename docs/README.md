---
title: identity-service documentation index
summary: The documentation index for identity-service — the two-plane Docs/Delivery layout and where each shelf lives.
status: current
last_updated: 2026-06-23
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
| **Reference** | [`reference/`](./reference) | The exact lookup surface — [`api.md`](./reference/api.md) (OAuth + `/admin/v1` endpoints, token contract, JWKS) and [`product-runtime-credential.md`](./reference/product-runtime-credential.md). The [`GLOSSARY.md`](../GLOSSARY.md) lives at the repo root. |
| **Guides** | [`guides/`](./guides) | How-to / operations / onboarding — [`tenant-config.md`](./guides/tenant-config.md), [`deployment.md`](./guides/deployment.md) (deploy + nightly backups & recovery), [`resource-server-integration.md`](./guides/resource-server-integration.md). |

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
| [RQ-0006 — Seed-as-code & recovery](./product/RQ-0006-seed-as-code-and-recovery.md) | [ADR-0006](./design/decisions/0006-seed-as-code-secrets-in-github.md) |
| [RQ-0007 — Console operator login & per-actor identity](./product/RQ-0007-console-operator-login.md) | [ADR-0010](./design/decisions/0010-console-operator-authentication.md) |
| [RQ-0008 — Console test & e2e harness](./product/RQ-0008-console-test-harness.md) | [ADR-0007](./design/decisions/0007-management-api-mcp-and-standalone-identity-service.md) |
| [RQ-0009 — Console ↔ management-API parity](./product/RQ-0009-console-api-parity.md) | [ADR-0007](./design/decisions/0007-management-api-mcp-and-standalone-identity-service.md) |
| [RQ-0010 — Console UX & IA polish](./product/RQ-0010-console-ux-polish.md) | [ADR-0007](./design/decisions/0007-management-api-mcp-and-standalone-identity-service.md) |

The **management plane** (HTTP `/admin/v1` + MCP + admin console) and the repositioning as a standalone
identity service are decided in [ADR-0007](./design/decisions/0007-management-api-mcp-and-standalone-identity-service.md),
which revisits the ADR-0001/0003 deferral of an admin-authenticated API once an admin-auth layer existed.

## Agent-facing files (repo root)

- [`CODEBASE.md`](../CODEBASE.md) — the first file an agent reads: what the product does, directory map, entry points.
- [`GLOSSARY.md`](../GLOSSARY.md) — terms where business language and code diverge.
- [`AGENTS.md`](../AGENTS.md) — what agents may/may not do, how to run things, pre-submit checks.
