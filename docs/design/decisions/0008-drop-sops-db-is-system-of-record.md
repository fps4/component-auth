---
title: "0008: Drop SOPS seed-as-code — the live DB is the system of record, with plaintext off-host backups"
summary: "Stop storing secrets encrypted in git (SOPS/age). The live MongoDB is the sole system of record for tenants/clients/users/secrets; recovery is a restore from a nightly plaintext off-host backup. Supersedes ADR-0006."
status: accepted
last_updated: 2026-06-23
date: 2026-06-23
related:
  - ./0006-seed-as-code-secrets-in-github.md
  - ./0007-management-api-mcp-and-standalone-identity-service.md
  - ../../guides/deployment.md
  - ../../product/RQ-0006-seed-as-code-and-recovery.md
---

## Context

[ADR-0006](0006-seed-as-code-secrets-in-github.md) made the seed **definition** durable in git and kept
the secret **values** in a committed, SOPS-encrypted file (`config/secrets.ds1.sops.yaml`), unlocked by a
single `age` master key. That gave a git-only rebuild path when the database was the *only* copy and there
was no backup.

Two things changed:

- [ADR-0007](0007-management-api-mcp-and-standalone-identity-service.md) made the **live MongoDB the
  system of record** (management mutates it directly) and added **off-host backups** for point-in-time
  recovery. Seed-as-code was already demoted there to a bootstrap/DR *floor*.
- In practice the SOPS layer is now friction with little benefit: the master `age` key is one more secret
  to guard and distribute, the encrypted values **drift** from what the live DB actually holds (the DB,
  not git, is authoritative), and recovery via re-seed only restores *definitions*, never runtime state.

## Decision

**Drop SOPS entirely. The live MongoDB is the single system of record for tenants, clients, users, and
their secrets; disaster recovery is a restore from a nightly off-host database backup.**

- **Remove** `config/secrets.ds1.sops.yaml` and `.sops.yaml` from the repo. No secret values live in git
  anymore — encrypted or otherwise.
- **`config/seed.yaml` stays** as the committed, non-secret **bootstrap** definition: its `${ENV}`
  references are resolved from the environment **at seed time** (e.g. from CI/Actions secrets or an
  operator's shell), used only to stand up a brand-new empty deployment. Day-2 changes go through the
  management plane (ADR-0007), not a re-seed.
- **Backups are plaintext** (`docker/backup.sh`), written to a controlled off-host path
  (`/mnt/backup/identity-service` on ds1) whose access control is the protection. Recovery is
  `backup.sh restore` (or `mongorestore`) — it restores the full runtime state, which a re-seed cannot.
- The `age`/SOPS master key is retired from this repo's workflow.

## Consequences

- **One fewer secret to manage** (the `age` master key) and no more drift between encrypted git values and
  the authoritative DB.
- **Recovery is restore-first**: the nightly backup is the primary recovery path; `seed.yaml` only
  bootstraps an empty deployment, and the operator must supply secret values via the environment when
  doing so (they are no longer recoverable from git).
- **Backups contain plaintext secrets/hashes**, so the backup location's access control (and disk
  encryption, if any) becomes the security boundary — it must be treated as sensitive.
- ADR-0006 is **superseded**; its SOPS mechanics no longer apply. ADR-0007's backup posture is retained
  and simplified (plaintext, no age).
- CI/operators that previously ran `sops exec-env … npm run seed` now provide the same `${ENV}` values
  directly (e.g. exported from Actions secrets) for the rare bootstrap case.
