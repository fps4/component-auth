# RQ-0001 — User identity via Google SSO (OIDC), issued as a verifiable JWT

- **Status:** proposed
- **Raised:** 2026-06-01
- **Owner:** @farid (architect)
- **Origin:** maestro US-0034 carve-out — the consumer side (the authenticated edge) shipped; this is the issuer side component-auth must provide.
- **Consumer:** the **maestro workspace** (a resource server that already verifies tokens this requirement issues).
- **Repos / refs:** `fps4/maestro` ADR-0019, US-0034; `orchestrator/edgeauth.py` (the verifier that consumes this).

> **For the implementing agent:** this is a self-contained functional requirement. Read it, then the *current state* and *fixed contract* sections before changing anything — the consumer (maestro) is **already in production-shaped code**, so the token contract below is a constraint you must meet, not a design space. Work on a `component-auth/*` branch, open a PR, keep CI green; do not change the existing client-credentials grant.

## Why

`component-auth` today issues **machine** tokens only: `POST /oauth2/token` (client-credentials), carrying `tid` / `cid` / `sid` / scope claims (`docs/api.md`, `service/src/oauth/server.ts`). maestro needs **human** identity: a participant authenticates with **Google SSO**, and component-auth issues a **user** JWT carrying a stable identity (`email` + `sub`) that maestro verifies at its edge. Without it, maestro can only run its off-production loopback dev path — there is no real authenticated edge for a human in production.

maestro deliberately keeps **authorization** (who may do what) in its own register; component-auth owns **authentication** (who you are) only (ADR-0019). So this requirement is about *issuing a trustworthy identity token*, nothing about maestro's roles.

## Current state (what already exists — reuse it)

- ✅ **JWKS** at `GET /.well-known/jwks.json` — RS256 public keys with `kid` (`docs/api.md`). **maestro already consumes this.** Do not change its shape.
- ✅ **RSA key management + rotation** — `key_store` collection, active/inactive keys, JWKS publishing (`docs/architecture.md`, `service/src/utils/key-store.ts`, `service/src/core/jwt.ts`).
- ✅ **OAuth server scaffold** — `service/src/oauth/server.ts` + `service/src/routes/oauth-routes.ts`; the architecture doc explicitly says additional grants/flows plug in here.
- ✅ **Multi-tenant model** — tenants opt into OAuth; clients reference a tenant with redirect URIs + scopes (`docs/tenant-config.md`). A user-login flow fits as a tenant-scoped client.
- ❌ **No user-facing login flow** (only client-credentials). ❌ **No `email` / `sub` user claims.** ❌ **No SDK login helper** for a browser obtaining a user token.

## Fixed contract (what maestro already verifies — you must satisfy this)

maestro's verifier (`orchestrator/edgeauth.py`, shipped) does exactly this, so the issued token MUST conform:

- Presented to maestro as **`Authorization: Bearer <jwt>`**.
- **Signed RS256**, verifiable against the existing **`/.well-known/jwks.json`** by the token's **`kid`**.
- Claims maestro reads / enforces:
  - **`email`** — the workspace identity (primary). REQUIRED for a human token (maestro keys attribution on it).
  - **`sub`** — the **stable, immutable** subject (the Google `sub`). REQUIRED; maestro uses it as the secondary key if email ever changes ("store both, match on either").
  - **`iss`** — MUST equal maestro's configured `COMPONENT_AUTH_ISSUER`.
  - **`aud`** — MUST equal maestro's configured `COMPONENT_AUTH_AUDIENCE` (the maestro workspace; tenant/client-scoped).
  - **`exp`** — REQUIRED and enforced (maestro rejects a token without it); `iat` expected. A 60s leeway is allowed on the consumer.
- A token failing any of the above is rejected by maestro as unauthenticated (401) — there is no fallback. So issuance correctness is load-bearing.

## Scope

1. A **user authentication flow** with **Google** as the upstream IdP — OIDC **Authorization Code + PKCE** (browser-initiated; redirect-based), terminating at component-auth, which validates Google's id_token and establishes the user's identity.
2. **Issue a user JWT** carrying `email` + `sub` + `iss` + `aud` + `exp`/`iat`, signed with the active RSA key (reuse the key manager + JWKS).
3. An **SDK login helper** (`sdk/`) so a consumer frontend (maestro's web app) can drive the redirect login and obtain the token to forward as `Authorization: Bearer`.
4. **Session lifetime + refresh** for the user token (the maestro-side open question ADR-0019 deferred to "the auth slice" — decide it here).
5. **Audience binding** — the token's `aud` is the consuming workspace, configured per tenant/client (so maestro's `COMPONENT_AUTH_AUDIENCE` has a real counterpart).

## Out of scope

- **maestro's register / authorization** — stays in maestro (ADR-0019). This issues identity only; it does not mirror roles.
- **Non-Google IdPs / magic-link** for external (non-fps4-tenant) reviewers — maestro M4; do not build it now (ADR-0019 defers it).
- **Changing the existing client-credentials grant** — leave `POST /oauth2/token` (machine tokens) untouched; add the user flow alongside it.
- **The maestro web app's login UI** — that lands in maestro once this SDK helper exists; here, ship the SDK helper + its contract.

## Acceptance criteria (EARS)

- WHEN a user begins login from a registered consumer (redirect URI on a tenant's OAuth client), THE SYSTEM SHALL run an **OIDC Authorization Code + PKCE** flow with **Google** as the upstream IdP and validate Google's `id_token` (signature, `aud`, `exp`, `nonce`) before establishing identity.
- WHEN Google authentication succeeds, THE SYSTEM SHALL issue an **RS256-signed JWT** whose claims include **`email`**, the immutable **`sub`**, **`iss`** (the service's configured issuer), **`aud`** (the consumer/workspace audience for that client), and **`exp`** + `iat`, signed with the **active key** and verifiable via the existing **`/.well-known/jwks.json`**.
- THE SYSTEM SHALL set `email` to the user's Google email and `sub` to the **stable Google subject** (not the email), so the subject survives an email change.
- THE SYSTEM SHALL bind `aud` to the **registered consumer/tenant** that initiated the flow, so a token minted for one workspace is not valid for another.
- WHERE the existing **client-credentials** grant is used, THE SYSTEM SHALL continue to behave unchanged (this requirement is additive).
- WHEN a user token nears expiry, THE SYSTEM SHALL provide a **refresh** path (refresh token or silent re-auth) with a documented token + session lifetime; refresh SHALL NOT outlive a revoked session.
- IF Google authentication fails, the `state`/PKCE verifier is invalid, or the redirect URI is unregistered, THEN THE SYSTEM SHALL deny the flow with a standard OAuth/OIDC error and issue **no** token.
- THE SDK SHALL expose a **login helper** that initiates the redirect flow and returns the issued access token (and refresh affordance) to a consumer frontend, so the consumer can send it as `Authorization: Bearer` to its own API.
- THE SYSTEM SHALL keep **key rotation** working for user tokens: a token signed by a now-inactive-but-published key SHALL still verify against the JWKS until that key is retired (the existing rotation behaviour, ADR `docs/architecture.md`).

## Implementation notes (pointers, not prescriptions)

- **Add the flow under** `service/src/oauth/` (the architecture doc names `service/src/oauth/server.ts` as the extension point for new grants) + a route under `service/src/routes/oauth-routes.ts` (e.g. `/oauth2/authorize`, `/oauth2/callback`, `/oauth2/token` with `grant_type=authorization_code`).
- **Reuse** `service/src/core/jwt.ts` + `service/src/utils/key-store.ts` for signing and JWKS — do **not** introduce a second signing path.
- **Claims:** extend the user-token claim builder to set `email` + `sub`; keep machine tokens' `tid`/`cid`/`sid` builder separate.
- **Tenant config:** model the consumer (maestro) as a tenant OAuth client with Google IdP settings + redirect URI(s) + the `aud` value (`docs/tenant-config.md`). Document the resulting `iss`/`aud`/JWKS-URL so maestro's `COMPONENT_AUTH_ISSUER` / `COMPONENT_AUTH_AUDIENCE` / `COMPONENT_AUTH_JWKS_URL` can be set to match.
- **SDK:** add the login helper to `sdk/src/index.ts` alongside `requestClientCredentialsToken`.
- **Tests:** prove the token verifies under the **same** checks maestro runs — signature via JWKS, `iss`/`aud`/`exp` enforced, `email` + `sub` present; and the negative paths (bad state, unregistered redirect, expired Google id_token).

## Definition of done

- A user can log in with Google through a registered consumer and receive an RS256 JWT that **passes maestro's verifier unchanged** (`email` + `sub` + `iss` + `aud` + `exp`, verifiable via the published JWKS).
- The SDK login helper drives the flow end to end and hands back the token.
- Token/session lifetime + refresh documented; revocation honoured.
- `docs/api.md` documents the new endpoints; `docs/tenant-config.md` documents the consumer/Google config; the existing client-credentials grant and JWKS are unchanged.
- The maestro values to set (`COMPONENT_AUTH_ISSUER` / `AUDIENCE` / `JWKS_URL`) are written down so the two sides line up.
