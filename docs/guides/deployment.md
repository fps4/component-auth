---
title: Deployment
summary: How identity-service is deployed to ds1 — secrets, the CI deploy, nightly backups & recovery, and provisioning the management-plane admin client + MCP server.
status: current
last_updated: 2026-06-23
owners: [architect]
related:
  - docs/design/architecture.md
  - docs/guides/tenant-config.md
  - docs/design/decisions/0007-management-api-mcp-and-standalone-identity-service.md
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

## System of record, seeding & recovery — ADR-0007 / ADR-0008

The **live MongoDB is the system of record** for the auth data (tenants, app clients, users, secrets).
SOPS/seed-as-code is **dropped** (ADR-0008, superseding ADR-0006): there is no encrypted secret file in
git, and no `age` master key.

- **Bootstrap definition** — `config/seed.yaml` (committed; only `${ENV}` references, no plaintext). It
  stands up a brand-new **empty** deployment; the deploy keeps the mongo data volume, so steady-state data
  is never wiped. Day-2 changes go through the **management plane** (`/admin/v1` + MCP + console — ADR-0007),
  not a re-seed.
- **Bootstrap seed** (rare — empty DB only): supply the `${ENV}` values from the environment (CI/Actions
  secrets or an operator shell), from `service/`, against ds1's Mongo on its published port `27019`:

  ```bash
  IDENTITY_ADMIN_CLIENT_SECRET=… MAESTRO_COMPONENTS_DS1_SECRET=… SEED_ADMIN_PASSWORD=… \
    MONGO_URI=mongodb://localhost:27019 MONGO_DB_NAME=identity-service npm run seed
  ```

  Idempotent: tenants/clients are upserted; **existing users are left untouched** — change a password with
  `npm run manage-users -- set-password --tenant=<id> --email=<e> --password=<p>`. A runtime client secret
  must stay equal to its consumer-repo mirror (`MAESTRO_RUNTIME_CLIENT_SECRET` in the
  gateway/copilot/sovereign-skills-coach repos, US-0086).

### Nightly backups & point-in-time recovery — ADR-0008

The **primary recovery path is a restore from a nightly backup** (it recovers the full runtime state —
issued tokens, authorizations, lockouts, signing-key history, audit log — which a re-seed cannot). Backups
are **plaintext** (`docker/backup.sh`), written to a controlled off-container path whose access control is
the protection. `docker/backup.sh` dumps the DB via the mongo container and prunes by retention. Schedule
it from the host crontab (nightly at 02:30, 30-day retention):

```cron
30 2 * * *  /home/<user>/identity-service/docker/backup.sh backup >> ~/is-backup.log 2>&1
```

`BACKUP_DIR` defaults to `/mnt/backup/identity-service`. **Restore** a snapshot (DROPS existing
collections; confirm when prompted):

```bash
docker/backup.sh restore /mnt/backup/identity-service/identity-service-20260623-023000.archive.gz
```

> Backups contain plaintext data — treat the backup path as sensitive (rely on its filesystem access
> control / disk encryption).

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

## Management-plane admin client & MCP server — ADR-0007

The `/admin/v1` API, the MCP server, and the admin console all authenticate with a `client_credentials`
token carrying the `admin` scope. That principal is seeded as a dedicated tenant + client
(`identity-service-ops` / `identity-admin-mcp`) in [`config/seed.yaml`](../../config/seed.yaml).

The **one** secret value lives in **two** places (it must be identical in both — same pattern as
`MAESTRO_RUNTIME_CLIENT_SECRET`):

- the **`IDENTITY_ADMIN_CLIENT_SECRET` GitHub Actions secret** → the deploy injects it into the
  `identity-service` container env (`deploy-ds1.yml`), so the in-container launcher can **mint** a token;
- the **seeded client in the live DB** → so the stored secret **hash** matches what the mint presents.

Provision it:

1. **Set the GitHub secret** (used by the pipeline): `gh secret set IDENTITY_ADMIN_CLIENT_SECRET`.
2. **Seed the client with the same value** so it exists in Mongo with that secret hashed (against ds1's
   Mongo on its published port `27019`; SOPS dropped per ADR-0008 — pass the value via the env):

   ```bash
   # from service/ (the seed upserts the identity-service-ops tenant + identity-admin-mcp client):
   IDENTITY_ADMIN_CLIENT_SECRET=<the same value> SEED_FILE=../config/seed.yaml \
     MONGO_URI=mongodb://localhost:27019 MONGO_DB_NAME=identity-service npm run seed
   ```

3. **Mint a token** (any caller — the console, `curl`, a test):

   ```bash
   curl -s -XPOST https://auth.fps4.nl/oauth2/token -d grant_type=client_credentials \
        -d client_id=identity-admin-mcp -d client_secret=$IDENTITY_ADMIN_CLIENT_SECRET -d scope=admin | jq -r .access_token
   ```

   Tokens are short-lived (15 min) — mint on demand from the client id+secret rather than storing one.

### Driving the MCP server from an MCP client (e.g. Claude Code)

The MCP server talks to MongoDB directly and verifies the admin token against the service's own JWKS, so
it runs **inside the `identity-service` container** (which already has Mongo, the key passphrase, and the
issuer — plus `IDENTITY_ADMIN_CLIENT_SECRET`, injected by the deploy).
[`docker/mcp-admin.sh`](../../docker/mcp-admin.sh) mints a fresh token on each start and execs
`node dist/mcp/server.js` in that container — nothing long-lived is stored:

1. **No host-side secret is needed on ds1** — the launcher reads the secret from the container env. (For
   local/dev, or if you prefer not to inject it into the container, the launcher also accepts a host
   `IDENTITY_ADMIN_CLIENT_SECRET` env var or a `.mcp-admin.env` file next to the script, `chmod 600`.)
2. A remote MCP client connects over SSH (stdio passes straight through). The launcher lives at
   `~/identity-service/docker/mcp-admin.sh` on the ds1 host:

   ```bash
   ssh ds1 /home/fgurbanov/identity-service/docker/mcp-admin.sh
   ```

   For Claude Code, register it once at user scope so every project sees it:

   ```bash
   claude mcp add --scope user --transport stdio identity-service-admin -- ssh ds1 /home/fgurbanov/identity-service/docker/mcp-admin.sh
   ```

   The secret never leaves the ds1 host; the laptop config holds only the SSH command.

## Verify

- `GET /health` returns `{ "status": "ok" }`.
- `GET /.well-known/jwks.json` serves the RS256 public keys consumers verify against.
- A consumer's verifier env (`*_ISSUER` / `*_AUDIENCE` / `*_JWKS_URL`) must line up **exactly** with
  what this service mints — see [`tenant-config.md`](./tenant-config.md).
