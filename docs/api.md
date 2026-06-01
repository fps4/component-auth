---
title: Component Auth API
status: current
last_updated: 2026-06-01
owners: [architect]
related:
  - docs/architecture.md
  - docs/tenant-config.md
  - docs/requirements/RQ-0001-workspace-user-identity-google-sso.md
---

# Component Auth API

The service exposes OAuth 2.0 endpoints under `/oauth2/*` and legacy session routes under `/v1/*`. Responses are JSON unless noted otherwise.

## Authentication

The service currently relies on network-level controls (private network, API gateway, etc.). Downstream consumers can optionally send an `Authorization` header; the service will pass it to logging middleware but does not verify it yet.

## Headers

- `Content-Type: application/json`
- `Origin` – used to enforce CORS per tenant.

---

## `POST /oauth2/token`

Issue OAuth 2.0 tokens. Three grants are supported: **`client_credentials`** (machine tokens),
**`authorization_code`** (user login via Google SSO — RQ-0001), and **`refresh_token`** (rotate a
user token).

> **Prerequisite:** the tenant must have `oauth.enabled = true` and allow the grant in
> `oauth.allowedGrantTypes`. See [Tenant Configuration](tenant-config.md).

### `grant_type=client_credentials`

- `Content-Type: application/x-www-form-urlencoded`
- Client authentication via HTTP Basic (`Authorization: Basic base64(client_id:client_secret)`) **or** `client_id` and `client_secret` form fields.
- Body parameters:
  - `grant_type=client_credentials`
  - `scope` (optional, space-delimited string; subset of client’s registered scopes)

Response (`200`):

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 900,
  "scope": "telemetry:write telemetry:read"
}
```

### `grant_type=authorization_code` (user login — PKCE)

Completes the Google login started at [`GET /oauth2/authorize`](#get-oauth2authorize). The client is
**public** — the PKCE `code_verifier` authenticates the exchange, not a client secret.

- `Content-Type: application/x-www-form-urlencoded`
- Body parameters: `grant_type=authorization_code`, `code`, `code_verifier`, `client_id`, `redirect_uri`.

Response (`200`):

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ii4uLiJ9...",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "k7b3...opaque",
  "refresh_expires_in": 2592000,
  "scope": ""
}
```

The `access_token` is an RS256 JWT carrying **`email`**, the stable Google **`sub`** (the JWT
`sub` claim), **`iss`**, the consumer-bound **`aud`** (the client's configured `audience`), and
**`exp`** + `iat` — verifiable via [`/.well-known/jwks.json`](#get-well-knownjwksjson).

### `grant_type=password` (local login — RQ-0002)

Email + password login against component-auth's own credential store, for tenants that enable the
**local** IdP. Issues the same user token shape as the Google flow.

- `Content-Type: application/x-www-form-urlencoded`
- Body parameters: `grant_type=password`, `username` (the email), `password`, `client_id` (must allow the `password` grant and have an `audience`).
- Response: same shape as `authorization_code`.
- Bad email and bad password return the **same** `invalid_grant` (no user enumeration); too many failures temporarily **lock** the account.

### `grant_type=refresh_token`

Rotates a user token. The presented refresh token is single-use; a fresh access + refresh pair is
returned. A refresh fails once its session is revoked or expired.

- `Content-Type: application/x-www-form-urlencoded`
- Body parameters: `grant_type=refresh_token`, `refresh_token`, `client_id`.
- Response: same shape as `authorization_code`.

### Errors

- `400 invalid_request` – missing/unsupported `grant_type` or required parameter.
- `400 invalid_scope` – requested scope not permitted.
- `400 invalid_grant` – bad/expired/used authorization code, failed PKCE, or invalid/revoked refresh token.
- `401 invalid_client` – bad client credentials (client-credentials grant).
- `400 unauthorized_client` – grant not allowed for client/tenant, or client has no `audience`.
- `429 slow_down` – tenant token rate limit exceeded.
- `500 server_error` – unexpected failure.

---

## `GET /oauth2/authorize`

Browser entry point for user login (RQ-0001). Validates the client + tenant and the registered
`redirect_uri`, then **302-redirects** the browser to Google to authenticate.

### Query parameters

- `client_id` – a tenant OAuth client allowing the `authorization_code` grant.
- `redirect_uri` – must be pre-registered on the client (exact match).
- `code_challenge` – PKCE challenge; `code_challenge_method=S256` (the only supported method).
- `state` (recommended) – opaque CSRF value, echoed back unchanged on the consumer redirect.
- `scope` (optional) – space-delimited subset of the client's scopes.

On success: `302` to Google. On a bad/unregistered request: a JSON OAuth error (no redirect, since
an unvalidated `redirect_uri` is never trusted).

---

## `GET /oauth2/callback`

Where Google redirects back after authentication. The service exchanges Google's `code`, verifies
its `id_token` (signature, `iss`, `aud`, `exp`, `nonce`), then **302-redirects** the browser to the
consumer's `redirect_uri` with a single-use `code` (and the echoed `state`). If Google
authentication fails, it redirects back with `?error=access_denied` and issues **no** token.

---

## `POST /oauth2/revoke`

Revoke a refresh token and its session (RFC 7009). Always `200`, even for an unknown token.

- `Content-Type: application/x-www-form-urlencoded`
- Body: `token` (the refresh token).

Revoking cascades to the session, so any sibling refresh token is also dead. Already-issued access
JWTs remain valid until `exp` (≤ 15 min) — they are stateless and not checked against the store.

---

## `POST /v1/tenants/{tenantId}/register`

Self-service local-credential registration (RQ-0002). Creates a user under a tenant that has the
**local** IdP enabled. Login is the separate `password` grant; registration does not return a token.

### Request Body

```json
{ "email": "reviewer@example.com", "password": "at-least-10-chars" }
```

### Response (`201`)

```json
{ "id": "f3ede70f-...", "email": "reviewer@example.com", "tenantId": "tenant-local" }
```

`id` is the stable subject id (the token `sub` at login).

### Errors

- `400 invalid_email` / `400 weak_password` – fails validation (password shorter than the configured minimum).
- `400 local_idp_disabled` – tenant has not enabled the local IdP / `password` grant.
- `404 tenant_not_found` – tenant missing or inactive.
- `409 email_taken` – an account with this email already exists for the tenant.
- `429 slow_down` – per-tenant registration rate limit exceeded.

> **Password reset** has no email channel yet: an operator resets credentials via the
> `service/scripts/manage-users.ts` CLI (`set-password`, `lock`, `unlock`, `disable`).

---

## `POST /v1/tenants/{tenantId}/sessions`

Create a session and issue a tenant-scoped JWT (legacy path; tokens will align with OAuth responses in a future release).

### Path Parameters

- `tenantId` – required tenant identifier.

### Request Body

```json
{
  "visitorId": "optional string",
  "subject": "optional string",
  "clientMeta": {
    "ip": "1.2.3.4",
    "userAgent": "Mozilla/5.0"
  }
}
```

`clientMeta` is optional; headers such as `User-Agent`, `Sec-CH-UA*`, and `X-Forwarded-For` are captured automatically.

### Response (`201`)

```json
{
  "sessionId": "b9c4d3fe-...",
  "token": "jwt string",
  "expiresIn": 899,
  "expiresAt": "2024-04-20T08:30:00.000Z",
  "visitorId": "f3ede70f-..."
}
```

### Errors

- `400` – invalid input (missing tenantId, invalid body).
- `404` – tenant not found or inactive.
- `500` – service misconfiguration (missing JWT secret) or unexpected error.

---

## `PATCH /v1/sessions/{sessionId}`

Update an existing session with additional identifiers or cookie data.

### Path Parameters

- `sessionId` – the session identifier to update.

### Request Body

```json
{
  "contactId": "optional string",
  "cookies": {
    "analytics_id": "abc123"
  }
}
```

### Response (`200`)

```json
{
  "sessionId": "b9c4d3fe-...",
  "updated": {
    "contactId": "user-123",
    "context": {
      "analytics_id": "abc123"
    },
    "updatedAt": "2024-04-20T08:45:12.000Z"
  }
}
```

### Errors

- `400` – no fields supplied or invalid payload.
- `404` – session not found.
- `500` – unexpected error.

---

## `GET /health`

Simple status endpoint returning `{ "status": "ok" }`. Useful for orchestrators and monitoring.

---

## `GET /.well-known/jwks.json`

Returns the JSON Web Key Set (JWKS) for verifying RS256 tokens issued by the service.

### Response

```json
{
  "keys": [
    {
      "kid": "7a2c4a4f-...",
      "kty": "RSA",
      "alg": "RS256",
      "use": "sig",
      "n": "...",
      "e": "AQAB"
    }
  ]
}
```
