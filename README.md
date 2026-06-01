# Component Auth

Multi-tenant authentication building blocks shared across products. The project ships a standalone service for session management plus a lightweight SDK for consumers.

## Project Layout

```
component-auth/
 ├── docker/           # Docker Compose base + env-specific overrides
 ├── service/          # REST API + Docker assets
 │    ├── src/         # Express app, core logic, models
 │    ├── Dockerfile   # Container build
 ├── sdk/              # TypeScript client for the API
 │    └── src/
 ├── docs/             # Architecture notes & API reference
 └── README.md
```

## Quick Start

1. Copy `service/.env.example` to `.env` and set values:
   - `MONGO_URI`, `MONGO_DB_NAME`
   - `AUTH_JWT_SECRET`, `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`
   - OAuth settings: token TTLs, tenant limits, optional key passphrase (see comments in `.env.example`)
   - Optionally update `SESSION_TTL_MINUTES`, `CORS_ORIGINS`
2. Install dependencies & build:

   ```bash
   cd service
   npm install
   npm run build
   npm test
   npm start
   ```

3. (Optional) Run with Docker:

   ```bash
   docker compose -f docker/compose.yaml -f docker/compose.dev.yaml up --build
   ```
   Use `docker compose -f docker/compose.yaml -f docker/compose.dev.yaml down` to stop containers.

The service listens on `PORT` (default `7305`). Health check at `GET /health`.

## API Summary

- `POST /oauth2/token` – client credentials grant issuing RS256 access tokens.
- `GET /.well-known/jwks.json` – JWKS for verifying issued tokens.
- `POST /v1/tenants/:tenantId/sessions` – validate tenant, persist session, issue legacy session JWT (in migration).
- `PATCH /v1/sessions/:sessionId` – attach contact identifiers or cookie context.
- See `docs/api.md` for full payloads and responses.

## SDK Usage

```ts
import { ComponentAuthClient } from '@fps4/component-auth';

const client = new ComponentAuthClient({
  baseUrl: 'https://auth.example.com',
  defaultTenantId: 'tenant-123'
});

const session = await client.createSession({ visitorId: 'visitor-001' });
await client.updateSession({ sessionId: session.sessionId, contactId: 'contact-42' });

const token = await client.requestClientCredentialsToken({
  clientId: process.env.CORE_AUTH_CLIENT_ID!,
  clientSecret: process.env.CORE_AUTH_CLIENT_SECRET!,
  scope: ['telemetry:write']
});

console.log(token.accessToken);
```

Run `npm install && npm run build` inside `sdk/` to compile distributable assets. Consumers need a `fetch` implementation (Node 18+ or polyfill).

## Docs

- `docs/architecture.md` – overall architecture and OAuth components.
- `docs/api.md` – endpoint contract.
- `docs/tenant-config.md` – tenant onboarding & OAuth configuration.
- `docs/requirements/` – open requirements for pickup. `RQ-0001` adds user identity via Google SSO (OIDC), issued as a JWT maestro's authenticated edge verifies.
- `tests/` – manual harness + scripts for integration checks on deployed environments.

## Migration Notes

Existing authentication logic in `product-chatbot` maps directly onto this service:

- `packages/authorizer-core` → `service/src/core`
- `services/authorizer` → `service/src/server.ts` and routes/models

Downstream products should replace direct module imports with API calls through the service or the SDK to decouple authentication concerns.

## Deployments

- `.github/workflows/deploy.yml` deploys with self-hosted runners and Docker Compose overlays.
- Pushes to `main` roll out to production using `docker/compose.prod.yaml` on a runner labeled `prod`.
- Pushes to any other branch deploy to the `dev` runner with `docker/compose.dev.yaml`.
- Manual runs via *Run workflow* in GitHub Actions let you redeploy either environment on demand.
