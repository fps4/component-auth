# Core Auth Service

Express-based REST + OAuth service for multi-tenant authentication.

## Setup

```bash
cd service
npm install
cp .env.example .env   # update secrets & Mongo connection
npm run build
npm test
npm start
```

### Required Environment Variables

| Variable | Description |
| --- | --- |
| `MONGO_URI` | Connection string to the MongoDB host (no database appended). |
| `MONGO_DB_NAME` | Database that stores `tenants` and `sessions`. |
| `AUTH_JWT_SECRET` | Legacy secret used to sign session JWTs (HS256); kept for compatibility. |
| `AUTH_JWT_ISSUER` | JWT/OAuth issuer claim. |
| `AUTH_JWT_AUDIENCE` | JWT/OAuth audience claim. |
| `SESSION_TTL_MINUTES` | Session lifetime in minutes (legacy flows). |
| `OAUTH_ACCESS_TOKEN_TTL_SEC` | Access token lifetime in seconds. |
| `OAUTH_REFRESH_TOKEN_TTL_SEC` | Refresh token lifetime (future use). |
| `OAUTH_TENANT_MAX_CLIENTS` | Default per-tenant client cap. |
| `OAUTH_TENANT_MAX_TOKENS_PER_MINUTE` | Default access token rate limit per tenant. |
| `OAUTH_TENANT_MAX_REFRESH_TOKENS` | Default refresh token cap per tenant. |
| `OAUTH_KEY_PASSPHRASE` | Optional passphrase to encrypt stored private keys. |
| `OAUTH_KEY_ROTATION_HOURS` | Desired key rotation cadence. |

Optional:
- `CORS_ORIGINS` – comma-separated list of static origins.
- `TENANT_CORS_REFRESH_INTERVAL_MS` – refresh interval for tenant-scoped origins.
- `LOG_LEVEL`, `LOG_PRETTY` – logging configuration.
- `OAUTH_CLIENT_CREDENTIALS_SCOPE` – global scopes auto-assigned when none requested.

## Scripts

- `npm run dev` – Watch mode with `tsx`.
- `npm run build` – Type-check and emit JavaScript to `dist/`.
- `npm start` – Run compiled server (`dist/server.js`).

## Mongo Collections

- `tenants` – tenant metadata and allowed origins.
- `sessions` – session records, keyed by UUID.
- `oauth_clients` – registered OAuth clients (confidential & public).
- `oauth_tokens` – access/refresh token metadata.
- `key_store` – RSA signing key material.

See `../docs/tenant-config.md` for guidance on enabling OAuth for a tenant and registering clients.

Seed tenants by inserting documents similar to:

```js
db.tenants.insertOne({
  _id: 'tenant-123',
  name: 'Tenant Name',
  status: 'active',
  allowedOrigins: ['https://widget.example.com']
});
```

## Docker

Use `docker compose -f docker/compose.yaml -f docker/compose.dev.yaml up --build` from the repository root to run MongoDB and the service together for local development.
