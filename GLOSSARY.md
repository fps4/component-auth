# Glossary

Terms where identity-service's business language and code diverge, or that a consumer must get right.

- **Tenant** — a product/organization registered in the `tenants` collection. Opts into OAuth via an
  `oauth` block (`enabled`, `allowedGrantTypes`, `allowedScopes`, `limits`, `idp`). Authentication is
  refused when a tenant is missing, not `active`, or has not enabled OAuth.

- **Client** — a registered consumer of a tenant (`oauth_clients`). Carries `grantTypes`,
  `redirectUris`, `scopes`, `isConfidential`, and — for user login — an `audience`. The `client_id`
  is the document `_id`.

- **Client credentials** — the machine-to-machine grant. A confidential client exchanges its secret
  for a short-lived access token carrying `tid` / `cid` / `sid` / `scope`.

- **User identity token** — the human-login token. An RS256 JWT carrying `email`, a stable `sub`,
  `iss`, a consumer-bound `aud`, `exp`/`iat`, and an optional coarse `roles` array. Proves *who you
  are*, not *what you may do*. Issued by either IdP (Google SSO or local password) with the same shape.

- **Role** — a coarse, tenant-scoped string (e.g. `tenant_admin`, `member`) carried on a local user
  and stamped into the user token's `roles` claim (RQ-0005). Provisioned by the operator (seed config
  `users[].roles` / `manage-users set-roles`), optionally constrained by a tenant's `oauth.allowedRoles`
  vocabulary. identity-service **asserts** roles but does not enforce them — each product maps roles to
  its own permissions ([ADR-0005](docs/design/decisions/0005-decentralized-authorization.md)). Contrast
  **scope** (machine/client authorization); roles describe the *user*.

- **IdP (identity provider)** — how a user authenticates. `google` federates Google SSO (RQ-0001);
  `local` is identity-service's own email/password store (RQ-0002). A per-tenant choice (`oauth.idp`);
  both issue the same user token.

- **Local user** — an email/password account in the `users` collection (RQ-0002). Per-tenant unique
  email, salted-scrypt password hash, a stable server-minted `sub`, and brute-force lockout counters.

- **Audience (`aud`)** — the consumer/workspace a user token is bound to (the client's `audience`
  field). A consumer verifies `aud` equals its own configured value; a token for one workspace is
  invalid for another.

- **Issuer (`iss`)** — the HTTPS base URL of this service (`AUTH_JWT_ISSUER`). A consumer enforces it.

- **PKCE** — Proof Key for Code Exchange (RFC 7636, S256 only). The public-client login proof: the
  browser holds a `code_verifier`; only its `code_challenge` is sent at `/oauth2/authorize`, and the
  verifier is presented at the token exchange. Replaces a client secret for the user flow.

- **Authorization record** — a short-lived `oauth_authorizations` document tying one login attempt
  together: the consumer's PKCE challenge + state, the Google `state`/`nonce`, and (after Google
  succeeds) the single-use code and captured identity. TTL-swept.

- **Nonce** — a random value embedded in the Google authorize request and verified back from
  Google's `id_token`, guarding the Google leg against replay.

- **Session** — a `sessions` document bounding a user token's absolute lifetime. Refresh tokens
  never outlive their session; revoking the session (`status: revoked`) kills refresh.

- **Refresh token** — an opaque, high-entropy, single-use (rotating) token. Only its SHA-256 hash is
  stored; presenting it mints a fresh access + refresh pair while its session is active.

- **JWKS** — the JSON Web Key Set at `/.well-known/jwks.json`: the RS256 public keys (by `kid`)
  consumers use to verify tokens. Publishes both `active` and `inactive` keys for rotation.

- **`kid`** — key id in a JWT header; selects which JWKS key verifies the signature.

- **Key rotation** — minting a new active signing key and demoting the previous one to `inactive`
  (still published, so its tokens verify until retired).

- **Management plane** — the authenticated, audited day-2 surface (ADR-0007): the HTTP `/admin/v1` API,
  an MCP server, and an operator console, all over one service layer. Onboards tenants, manages clients
  and users, rotates secrets and signing keys, and serves statistics. Network-restricted — kept off the
  public token-issuance surface. Distinct from the runtime OAuth/session endpoints.

- **Admin scope** — the privilege a `client_credentials` token must carry to reach the management plane.
  The superscope `admin` satisfies every admin route; granular per-area scopes (`admin:tenants`,
  `admin:clients`, `admin:users`, `admin:keys`, `admin:stats`) let an agent hold least capability. Admin
  tokens are this service's own client tokens, verified against its own JWKS — there is no separate admin
  issuer. Contrast **scope** (tenant runtime authorization) and **roles** (the user).

- **Audit log** — the append-only `audit_logs` collection recording every management mutation (who, what,
  when, which tenant). The per-actor accountability ADR-0003 said a static admin secret could not provide.

- **MCP management server** — the Model Context Protocol face of the management plane (`npm run mcp`,
  stdio JSON-RPC). A thin adapter over the same service layer + admin-auth + audit as the HTTP API — one
  authorization model, two transports — so agents can drive onboarding and rotation as typed tools.

- **Admin console** — the operator-facing web app (`@fps4/identity-service-console`, Next.js) over
  `/admin/v1`. A thin server-side client holding no database credentials; the admin token never reaches
  the browser. Distinct from the consumer-facing `<Login/>` widget shipped in `react/`.
