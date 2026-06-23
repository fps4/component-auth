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
# Prerequisites:
#   - the `identity-service` container running (docker compose up)
#   - a seeded admin client (config/seed.yaml -> tenant `identity-service-ops`, client `identity-admin-mcp`)
#   - the admin client secret reachable, from EITHER source:
#       * the container env — the deploy injects IDENTITY_ADMIN_CLIENT_SECRET from the GitHub Actions
#         secret (config/ds1/.env). On ds1 this is the default; no host-side secret is needed.
#       * the host — export IDENTITY_ADMIN_CLIENT_SECRET, or write it as a line
#         `IDENTITY_ADMIN_CLIENT_SECRET=...` in ${ADMIN_SECRET_FILE:-/opt/identity-service/docker/.mcp-admin.env}
#         (chmod 600; gitignored). Useful for local/dev. It must equal what the seed hashed for the client.
#
set -euo pipefail

CONTAINER="${IDENTITY_CONTAINER:-identity-service}"
CLIENT_ID="${IDENTITY_ADMIN_CLIENT_ID:-identity-admin-mcp}"
SCOPE="${IDENTITY_ADMIN_SCOPE:-admin}"
TOKEN_URL="${IDENTITY_TOKEN_URL:-http://localhost:7305/oauth2/token}"   # localhost = the service, inside the container
SECRET_FILE="${ADMIN_SECRET_FILE:-$(dirname "$0")/.mcp-admin.env}"

# Resolve the client secret. Preference order:
#   1. an explicit IDENTITY_ADMIN_CLIENT_SECRET in this (host) environment;
#   2. the gitignored host secret file (local/dev convenience);
#   3. otherwise, the secret already present INSIDE the container — the deploy injects
#      IDENTITY_ADMIN_CLIENT_SECRET there from the GitHub Actions secret (config/ds1/.env), so on ds1
#      no host-side secret is needed at all. The in-container `node` below falls back to it.
if [ -z "${IDENTITY_ADMIN_CLIENT_SECRET:-}" ] && [ -f "$SECRET_FILE" ]; then
  # shellcheck disable=SC1090
  . "$SECRET_FILE"
fi

# Pass the host secret through ONLY when we have one; otherwise the container env supplies it.
mint_env=(-e ADMIN_CLIENT_ID="$CLIENT_ID" -e ADMIN_SCOPE="$SCOPE" -e TOKEN_URL="$TOKEN_URL")
if [ -n "${IDENTITY_ADMIN_CLIENT_SECRET:-}" ]; then
  mint_env+=(-e "ADMIN_CLIENT_SECRET=$IDENTITY_ADMIN_CLIENT_SECRET")
fi

# 1. Mint a fresh admin token via the service's own token endpoint (run inside the container).
#    No -i here: this exec must NOT attach stdin, or it would swallow the JSON-RPC the MCP client is
#    sending for the server (step 2). stdin stays buffered in the pipe until the server reads it.
TOKEN="$(docker exec \
  ${mint_env[@]+"${mint_env[@]}"} \
  "$CONTAINER" node -e '
    const secret = process.env.ADMIN_CLIENT_SECRET || process.env.IDENTITY_ADMIN_CLIENT_SECRET;
    if (!secret) {
      console.error("no admin client secret: set IDENTITY_ADMIN_CLIENT_SECRET on the host or inject it into the container (deploy)");
      process.exit(1);
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.ADMIN_CLIENT_ID,
      client_secret: secret,
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
