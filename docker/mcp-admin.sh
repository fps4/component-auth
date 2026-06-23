#!/usr/bin/env bash
#
# Launch the identity-service MCP management server (ADR-0007) for an MCP client such as Claude Code,
# minting a FRESH admin-scoped token on each start so nothing long-lived is stored anywhere.
#
# Why this shape: the MCP server talks to MongoDB DIRECTLY (it is not an HTTP client of /admin/v1 like
# the console) and verifies the admin token against the service's own JWKS. The simplest way to give it
# Mongo + the signing-key passphrase + the issuer is to run it INSIDE the already-running
# `identity-service` container, which already has all of that in its environment. No DB tunnel, no Node
# install on the host.
#
# Designed to be invoked over SSH by a remote MCP client (stdio is passed straight through):
#     ssh ds1 /opt/identity-service/docker/mcp-admin.sh
#
# Prerequisites on the host:
#   - the `identity-service` container running (docker compose up)
#   - a seeded admin client (config/seed.yaml -> tenant `identity-service-ops`, client `identity-admin-mcp`)
#   - IDENTITY_ADMIN_CLIENT_SECRET available: exported in the environment, or written as a line
#     `IDENTITY_ADMIN_CLIENT_SECRET=...` in ${ADMIN_SECRET_FILE:-/opt/identity-service/docker/.mcp-admin.env}
#     (chmod 600; this file is gitignored). The secret must equal what the seed minted for that client.
#
set -euo pipefail

CONTAINER="${IDENTITY_CONTAINER:-identity-service}"
CLIENT_ID="${IDENTITY_ADMIN_CLIENT_ID:-identity-admin-mcp}"
SCOPE="${IDENTITY_ADMIN_SCOPE:-admin}"
TOKEN_URL="${IDENTITY_TOKEN_URL:-http://localhost:7305/oauth2/token}"   # localhost = the service, inside the container
SECRET_FILE="${ADMIN_SECRET_FILE:-/opt/identity-service/docker/.mcp-admin.env}"

# Resolve the client secret: an explicit env var wins; otherwise source the (gitignored) secret file.
if [ -z "${IDENTITY_ADMIN_CLIENT_SECRET:-}" ] && [ -f "$SECRET_FILE" ]; then
  # shellcheck disable=SC1090
  . "$SECRET_FILE"
fi
: "${IDENTITY_ADMIN_CLIENT_SECRET:?set IDENTITY_ADMIN_CLIENT_SECRET (env or $SECRET_FILE)}"

# 1. Mint a fresh admin token via the service's own token endpoint (run inside the container).
TOKEN="$(docker exec -i \
  -e ADMIN_CLIENT_ID="$CLIENT_ID" \
  -e ADMIN_CLIENT_SECRET="$IDENTITY_ADMIN_CLIENT_SECRET" \
  -e ADMIN_SCOPE="$SCOPE" \
  -e TOKEN_URL="$TOKEN_URL" \
  "$CONTAINER" node -e '
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.ADMIN_CLIENT_ID,
      client_secret: process.env.ADMIN_CLIENT_SECRET,
      scope: process.env.ADMIN_SCOPE,
    });
    fetch(process.env.TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    })
      .then((r) => r.json())
      .then((j) => {
        if (!j.access_token) { console.error("token mint failed:", JSON.stringify(j)); process.exit(1); }
        process.stdout.write(j.access_token);
      })
      .catch((e) => { console.error(String(e)); process.exit(1); });
  ')"

[ -n "$TOKEN" ] || { echo "mcp-admin: failed to mint admin token" >&2; exit 1; }

# 2. Run the MCP server inside the container with that token. -i keeps stdin open for JSON-RPC;
#    the server's logs go to stderr, the JSON-RPC stream to stdout — exactly what an MCP client expects.
exec docker exec -i \
  -e IDENTITY_SERVICE_ADMIN_TOKEN="$TOKEN" \
  "$CONTAINER" node dist/mcp/server.js
