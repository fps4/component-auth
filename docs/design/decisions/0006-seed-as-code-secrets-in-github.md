---
title: "0006: Seed definition in git; secret values SOPS-encrypted in git, one master key in GitHub"
status: accepted
date: 2026-06-11
related:
  - ./0003-seed-config-not-admin-api.md
  - ../../product/RQ-0004-seed-config-provisioning.md
  - ../../product/RQ-0006-seed-as-code-and-recovery.md
  - ../../guides/deployment.md
---

## Context

[RQ-0004](../../product/RQ-0004-seed-config-provisioning.md) provisions tenants, clients, and users from
a `config/seed.yaml` loaded by `npm run seed`. That file was **gitignored** and lived only on an
operator's workstation; its secret *values* lived only in a gitignored `docker/.env`.

This bit us. identity-service's auth state (tenants, clients, users) lives in MongoDB, and on ds1 that
data was being **lost on every deploy** — the records are only scrypt **hashes** (unrecoverable), and
the *definition* of who should exist lived only on a laptop. There was **no durable, off-host source of
truth** from which to rebuild.

(The true root cause of the data loss was a **mis-mounted mongo volume**, found later and fixed
separately: the Bitnami image's `dbPath` is `/bitnami/mongodb`, but the volume was mounted at `/data/db`,
so the real DB sat in the container's ephemeral layer and died with every container recreation. This ADR
addresses the orthogonal problem it exposed — that there was no recoverable definition or secret backup.)

The need surfaced as *"my secrets are gone — can we keep them in a cloud service, as a backup / fallback?
is GitHub an option?"*

The two things that were missing are different and must not be conflated:

- **The definition** — which tenants/clients/users *should* exist (emails, client ids, audiences, roles,
  grant types). This is **not secret**.
- **The secret values** — user passwords and client secrets. These **are** secret.

## Decision

**Keep the seed *definition* in git and the secret *values* in GitHub; recover the database by re-seeding
from both.** Concretely:

1. **`config/seed.yaml` is committed** — it references every secret as `${ENV_VAR}` and contains **no
   plaintext**, so it is safe in version control. This makes the full topology durable, reviewable, and
   recoverable. (Amends RQ-0004 / ADR-0003, which gitignored the file out of caution; the `${ENV}`-only
   rule makes that caution unnecessary. `config/*.local.yaml` stays ignored for ad-hoc local overrides.)
2. **Secret values live in a SOPS-encrypted file committed to git** — `config/secrets.ds1.sops.yaml`
   holds every seed value AES-256-GCM encrypted (keys readable, values `ENC[...]`). This **encrypted
   backup file** is the fallback: versioned, recoverable, and — unlike a write-only secret store —
   **readable back** (decrypt it). Only ciphertext ever touches GitHub, so plaintext stays sovereign
   (ADR-0002/0027 friendly).
3. **One master key in GitHub unlocks it** — the `age` **private key** is the single secret held as the
   `SOPS_AGE_KEY` GitHub Actions secret (and by the operator). The `age` **public** recipient sits in
   `.sops.yaml` (it only lets you re-encrypt when adding values). Rotation/onboarding is one key, not N
   secrets. The runtime client secrets are *also* mirrored into the consuming repos' single
   `MAESTRO_RUNTIME_CLIENT_SECRET` Actions secret so those deploys agree (US-0086).
4. **The mongo data actually persists across deploys** — the deploy reconciles containers but never the
   volume (`down` without `-v`), AND the volume is now mounted at the Bitnami `dbPath`
   (`/bitnami/mongodb`) so the DB really lands on it (fixed separately). Steady-state data is no longer
   wiped — re-seeding is recovery, not routine.
5. **Recovery = decrypt + re-seed** — `sops exec-env config/secrets.ds1.sops.yaml '… npm run seed'`
   decrypts with the master key and injects the values the committed `config/seed.yaml` references.
   Because the definition is in git and the values are in the git-committed encrypted file (unlockable
   with the one GitHub-held key), the database is reconstructable from GitHub alone. Idempotent:
   tenants/clients upserted, existing users left untouched (RQ-0004).

### Why SOPS + age (not N individual Actions secrets)

The first cut of this ADR stored each value as its own GitHub Actions secret. That works but has two
flaws: Actions secrets are **write-only** (no read-back recovery), and a growing fleet means N secrets to
manage. SOPS inverts it — **one** master key in GitHub, and an encrypted **backup file** in git that is
versioned, diff-reviewable, and decryptable. GitHub still never sees plaintext. We accept one new
dependency (the `sops` + `age` binaries at decrypt time), which is trivial to install and already
standard for GitOps.

### Why not CI auto-seed (yet)

Seeding needs Node + the `scripts/` loader, which the **production image does not contain** (`tsconfig`
`rootDir: src` excludes `scripts/`) and the socket-only ds1 runner cannot bind-mount a checkout into.
So seeding stays an **operator step** (RQ-0004's stance), now driven from committed config + GitHub
secrets. A seeder-capable image + a `workflow_dispatch` re-seed job is a possible follow-up.

## Consequences

- The full ds1 identity topology **and** its (encrypted) secret values live in git, rebuildable from
  GitHub after any data loss — with read-back recovery via the master key.
- No plaintext is ever committed; rotation = `sops` edit the encrypted file (+ the consumer's mirror)
  and re-seed. Adding a value never adds a GitHub secret — only the file changes.
- Operators keep `config/seed.yaml` and `config/secrets.ds1.sops.yaml` in sync (a new client needs an
  entry in both); the deployment guide documents the recovery command.
- The master key (`SOPS_AGE_KEY`) is the one bootstrap secret to guard; losing it means the backup can't
  be decrypted (keep an offline copy), and a leak means re-key + re-encrypt.
- The deploy no longer wipes data, so re-seeding is needed only for first setup, a new tenant/client, or
  an explicit reset — not on every deploy. (CI auto-seed remains out of scope: the prod image has no
  seeder and the socket-only runner can't mount a checkout.)
