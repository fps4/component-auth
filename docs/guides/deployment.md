---
title: Deployment
status: current
last_updated: 2026-06-07
owners: [architect]
related:
  - docs/design/architecture.md
  - docs/guides/tenant-config.md
---

# Deployment

How identity-service is deployed. The service is a **stateless container** driven entirely by environment
variables, with **MongoDB** as its only persistent dependency. It can run anywhere Docker runs; the
default pattern is a **manual deploy over SSH to a Docker host**.

## Prerequisites on the host

- **Docker** with Compose v2.
- A reachable **MongoDB** (provisioned by the compose stack, or external — set `MONGO_URI`).
- An **external Docker network** the service attaches to, if you front it with a shared reverse proxy
  (create it once: `docker network create <network-name>`; reference it from the compose overlay).
- A **public HTTPS endpoint** (reverse proxy, ingress, or tunnel) terminating TLS in front of the
  service. HTTPS is required both for Google's OAuth redirect URI and for any consumer's verifier
  configuration (issuer + JWKS URL). The service itself listens on `PORT` (default `7305`).

## Secrets

Secrets live in a **gitignored `docker/.env`** and are **never committed**:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — the Google OIDC app (service-level, not per tenant).
- `OAUTH_KEY_PASSPHRASE` — optional AES-256-GCM encryption of signing keys at rest.
- `AUTH_JWT_ISSUER` — the public HTTPS issuer URL; becomes the token `iss`.
- `MONGO_URI` and the rest of the knobs documented in `service/.env.example`.

Build context (`../service`) and `${VAR}` interpolation resolve **locally** before the build is sent to
the remote daemon, so the gitignored `docker/.env` never leaves the operator's machine.

## Deploy

Run Compose against a remote Docker daemon over SSH by pointing `DOCKER_HOST` at the target host:

```bash
# Deploy from a workstation against the remote daemon over SSH
export DOCKER_HOST=ssh://<deploy-host>

# Dev overlay
docker compose --env-file docker/.env \
  -f docker/compose.yaml -f docker/compose.dev.yaml up -d --build
docker compose -f docker/compose.yaml -f docker/compose.dev.yaml ps

# Production overlay: swap compose.dev.yaml → compose.prod.yaml
```

The image build runs `npm run build && npm test`, so a type error or a red test **fails the deploy**.

## CI-driven deploys (ds1)

The default ds1 deploy is **automatic** (`.github/workflows/deploy-ds1.yml`), mirroring the other fps4
stacks: a green **Definition of Done** on `main` chains into `deploy-ds1`, which runs on the shared
`[self-hosted, ds1]` runner and drives the host Docker daemon over the mounted socket — `compose build`
+ `up -d`, then gates on the service's `/health` healthcheck via `docker inspect` (the runner has no
host-port access). `workflow_dispatch` runs it on demand.

- **Config:** the non-secret base is committed at `config/ds1/.env.base`; the workflow assembles
  `config/ds1/.env` (base + Actions secrets) runner-local and deletes it afterwards.
- **Secrets** (repo Actions secrets, appended only when set — the ds1 SMOKE posture runs without them):
  `OAUTH_KEY_PASSPHRASE`, and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`.
- **Seeding stays manual** (RQ-0004): the pipeline ships the service; provisioning tenants/clients/users
  (`npm run seed`) remains an operator step — see *Seed & recovery* below.

The SSH / `DOCKER_HOST` runbook above still works for a laptop-driven deploy or a host without the runner.

## Seed & recovery (identity data) — ADR-0006 / RQ-0006

The auth data (tenants, app clients, users) lives in MongoDB. Both halves are durable in git:

- **Definition** — `config/seed.yaml` (committed; only `${ENV}` references, no plaintext).
- **Secret values** — `config/secrets.ds1.sops.yaml` (committed; **SOPS/age-encrypted**, values only).
  The single **master key** that decrypts it is the `age` private key, held as the `SOPS_AGE_KEY` GitHub
  Actions secret (and an operator's offline copy); the public recipient is in `.sops.yaml`.

The deploy keeps the mongo data volume, so steady-state data is not wiped; re-seed only for first setup,
a new tenant/client, or after a loss.

**Prerequisites:** `sops` + `age` (`brew install sops age`) and the master key in the environment, e.g.
`export SOPS_AGE_KEY=$(gh secret …)`  — or point `SOPS_AGE_KEY_FILE` at a local key file.

**Recover / re-seed** — `sops exec-env` decrypts the backup and injects the values the seeder references
(from `service/`, against ds1's Mongo on its published port `27019`):

```bash
SOPS_AGE_KEY='AGE-SECRET-KEY-…' \
sops exec-env ../config/secrets.ds1.sops.yaml \
  'MONGO_URI=mongodb://localhost:27019 MONGO_DB_NAME=identity-service npm run seed'
```

Idempotent: tenants/clients are upserted; **existing users are left untouched** — change a password with
`npm run manage-users -- set-password --tenant=<id> --email=<e> --password=<p>`. Passwords are stored as
scrypt hashes; plaintext lives only inside the encrypted file and with the human owner.

**Edit / rotate a secret:** `sops config/secrets.ds1.sops.yaml` (opens the decrypted values in `$EDITOR`,
re-encrypts on save), then re-seed. A runtime client secret must stay equal to its consumer-repo mirror
(`MAESTRO_RUNTIME_CLIENT_SECRET` in the gateway / copilot repos, US-0086).

## Rename cutover: component-auth → identity-service (one-time) — ADR-0007

The rename changes the compose **project** name (so the data volume moves from `component-auth_mongo_data`
to `identity-service_mongo_data`) **and** `MONGO_DB_NAME` (`component-auth` → `identity-service`). Together
those would orphan the live ds1 data on the first new-name deploy. `docker/migrate-rename-ds1.sh` does a
logical dump→restore with a namespace remap, covering **both** the volume move and the DB rename in one
pass; the old volume is kept as a rollback until you remove it. Run it **on the ds1 host**:

```bash
# 1. With the OLD stack still running, dump the old DB:
docker/migrate-rename-ds1.sh dump
# 2. Deploy the NEW stack (CI deploy-ds1.yml on main, or manual compose up) — brings up identity-service-mongo.
# 3. Restore into the new mongo with the ns remap, then verify counts:
docker/migrate-rename-ds1.sh restore
docker/migrate-rename-ds1.sh verify
# 4. After verifying /health + a token issuance, drop the old rollback volume:
docker/migrate-rename-ds1.sh decommission
```

**Note on the public issuer:** `AUTH_JWT_ISSUER` stays `https://auth.fps4.nl` (a URL, unchanged by the
rename), so consumer verifiers (maestro) are **unaffected** — no `iss` migration is needed. The renamed
default `identity-service` is only the dev/test fallback. **Consumer-side breaking changes** that *do*
need coordination: the published SDK package name (`@fps4/component-auth` → `@fps4/identity-service-sdk`)
and the documented consumer env-var convention (`COMPONENT_AUTH_*` → `IDENTITY_SERVICE_*`, which is each
consumer's own choice of name).

## Verify

- `GET /health` returns `{ "status": "ok" }`.
- `GET /.well-known/jwks.json` serves the RS256 public keys consumers verify against.
- A consumer's verifier env (`*_ISSUER` / `*_AUDIENCE` / `*_JWKS_URL`) must line up **exactly** with
  what this service mints — see [`tenant-config.md`](./tenant-config.md).
