# Component Auth Test Harness

This folder contains lightweight assets to validate a deployed Component Auth environment without additional tooling.

## Contents

- `manual-test-harness.html` – Standalone HTML page with configurable fields and buttons to exercise `POST /v1/tenants/:id/sessions` and `POST /oauth2/token`.
- `new-tenant.json` – Sample tenant payload (with OAuth enabled) for seeding a test environment.
- `load-tenant.ts` – Script to insert the sample tenant (and optionally an OAuth client) into MongoDB.

## Usage

1. **Seed a Tenant (optional client)**

   ```bash
   cd service
   npm install  # ensure dependencies like mongoose are available
   npx tsx ../tests/load-tenant.ts \
     --mongoUri="mongodb://mongo:27017" \
     --dbName="identity-service" \
     --tenantFile="../tests/new-tenant.json" \
     --clientName="Manual Harness Client" \
     --clientScopes="telemetry:read,telemetry:write" \
     --outputSecret=true
   ```

   Arguments are optional; defaults pull from `MONGO_URI`, `MONGO_DB_NAME`, and `tests/new-tenant.json`. When `--clientName` is provided, the script creates a confidential client with a random secret; use `--outputSecret=true` to print the plain secret for manual testing.

2. **Manual Testing via Browser**

   - Open `manual-test-harness.html` in a browser (no server needed).
   - Fill in the base URL, tenant ID, optional visitor ID, and client credentials (copy from the script output). Entries are stored in `localStorage` for convenience.
   - Use the buttons to create sessions and request OAuth tokens. Responses render beneath each form.

3. **Cleanup**

   Remove test tenants/clients from MongoDB when finished to avoid cluttering production databases.

## Notes

- The harness assumes the API is reachable from your browser. For environments behind VPNs or internal load balancers, use an appropriate network path.
- The tenant loader imports TypeScript models directly; run it with Node 18+ using native ES module support.
