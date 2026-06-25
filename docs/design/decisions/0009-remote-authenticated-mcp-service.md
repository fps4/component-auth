---
title: "0009: A remotely-reachable, OAuth-authenticated MCP service — Streamable HTTP on a dedicated resource origin (auth-mcp.fps4.nl), sender-constrained tokens, with identity-service as its own authorization server"
summary: "Expose the management MCP server over the network as an OAuth 2.1 protected resource at https://auth-mcp.fps4.nl (a dedicated origin, distinct from the authorization server auth.fps4.nl) using the MCP Streamable HTTP transport. identity-service is the authorization server for its own MCP resource. Tokens are audience-bound and sender-constrained (DPoP/mTLS), admin scopes are role-derived and step-up-gated, clients self-register via gated dynamic registration, and every call flows through the existing admin-auth + audit path — so any MCP client connects with the standard remote-MCP flow instead of SSH+stdio."
status: proposed
last_updated: 2026-06-24
date: 2026-06-24
related:
  - ./0001-local-credential-idp.md
  - ./0005-decentralized-authorization.md
  - ./0007-management-api-mcp-and-standalone-identity-service.md
  - ../../guides/deployment.md
  - ../architecture.md
---

## Context

[ADR-0007](0007-management-api-mcp-and-standalone-identity-service.md) shipped the MCP server as the
agent face of the management plane: a thin protocol adapter over the same service layer and admin-auth +
audit path as the HTTP `/admin/v1` API. But it ships over **stdio**, and the only way to reach it remotely
is the SSH wrapper `docker/mcp-admin.sh`:

```
ssh ds1 /opt/identity-service/docker/mcp-admin.sh
```

That wrapper mints a fresh admin token inside the container and `docker exec`s `node dist/mcp/server.js`,
streaming JSON-RPC over the SSH pipe. It works, but the transport is the limitation, not the design:

- **It is not reachable off the box's network.** Today the client config points at `ssh ds1`
  (`192.168.2.19`, LAN). Off-network there is no route. The MCP server has no public endpoint at all —
  it is stdio-only, tunneled through SSH.
- **It requires shell access to a production host.** Every operator/agent that wants MCP needs an SSH
  account on ds1 and `docker exec` reach — a far larger grant than "call these eleven admin tools," and
  the wrong primitive to hand an agent.
- **AuthN is host-level, not protocol-level.** SSH gates *who can reach the box*; the admin token is then
  minted *for* the caller by the wrapper from the container's seeded secret. The MCP caller never proves
  an identity to the MCP server — the wrapper vouches for them. There is no per-MCP-client credential and
  no standard way for an MCP client (Claude, an IDE, an agent runtime) to authenticate.
- **It is not the flow MCP clients expect.** The MCP authorization spec defines a remote flow — discover
  the authorization server, run OAuth with PKCE in the browser, present a bearer token — that off-the-shelf
  clients implement. SSH+stdio is bespoke plumbing none of them speak.

The asymmetry to exploit: **this service is itself an OAuth authorization server.** It already runs the
`/oauth2/authorize`, `/oauth2/token`, `/oauth2/revoke`, and `/oauth2/callback` endpoints; supports
`authorization_code` + PKCE, `client_credentials`, and `refresh_token` grants; signs RS256 JWTs; and
publishes `/.well-known/jwks.json`. The MCP authorization spec needs exactly an authorization server in
front of the MCP resource — and we *are* one. We do not need to bolt on Auth0 or run a second IdP to put
the MCP server behind real auth; we make the identity-service the authorization server **for its own MCP
resource**.

This ADR keeps ADR-0007's invariant — one authorization model, one audit trail — and adds a **third
transport**: a network-reachable, OAuth-authenticated Streamable HTTP MCP endpoint, alongside the HTTP
admin API (for humans/automation) and stdio (kept for local/dev and break-glass). It deliberately favours
the **future-proof, best-practice** shape over the merely simplest one, because the resource being exposed
is high-privilege admin tooling on the public internet.

## Decision

**Expose the management MCP server over the network as an OAuth 2.1 protected resource at
`https://auth-mcp.fps4.nl` — a dedicated resource origin, separate from the authorization server
`auth.fps4.nl` — using the MCP Streamable HTTP transport, served in-process by the same Express app, with
identity-service acting as the authorization server for its own MCP resource. Tokens are audience-bound
(RFC 8707) and sender-constrained (DPoP, RFC 9449; mTLS, RFC 8705, for agents); admin scopes are
role-derived and require a step-up assurance claim; MCP clients self-register through gated dynamic client
registration; and every call is verified and scope-gated through the same admin-auth + audit path the
stdio server and HTTP API already use.** Concretely:

### 1. Add a Streamable HTTP MCP transport, in-process, on the existing service

The MCP server stops being a separate stdio process and becomes a **route in the running Express app** (the
same app that serves `/oauth2`, `/v1`, `/admin/v1`, and `/.well-known/jwks.json` on `PORT` 7305). It
implements the MCP **Streamable HTTP** transport (protocol revision `2025-03-26` or later, superseding the
stdio server's `2024-11-05` and the deprecated HTTP+SSE transport): a single endpoint handling `POST`
(client → server JSON-RPC, with optional SSE response streaming) and `GET` (server → client SSE stream),
with MCP's built-in protocol-version negotiation handling client skew.

The JSON-RPC core — `initialize`, `tools/list`, `tools/call`, `ping`, the eleven tools, and the
`principalHasScope` gate before each call — is **lifted unchanged** from `service/src/mcp/server.ts` into a
transport-agnostic handler. stdio and HTTP become two thin transports over one handler, exactly as the HTTP
API and stdio are two faces over one service layer today. No tool logic is duplicated, and the handler
stays extractable into its own deploy unit later without a rewrite.

### 2. A dedicated resource origin: `auth-mcp.fps4.nl`, distinct from the authorization server

The MCP resource gets its **own public origin**, `https://auth-mcp.fps4.nl`, which is the canonical
resource identifier. It is deliberately **not** a path on the authorization-server origin
(`auth.fps4.nl/mcp`) and **not** the same origin as token issuance:

- **Origin isolation is the security best practice for a hosted IdP.** The authorization server origin is
  the crown jewel (it mints tokens, holds login cookies/CSRF context). Resource servers — including admin
  tooling — belong on separate origins so an XSS, cookie, or CSP flaw on one does not share a blast radius
  with the other. Same-origin co-location would trade that isolation away for convenience.
- **The resource indicator only carries weight across origins.** Audience-binding (#5) is meaningful
  precisely because `https://auth-mcp.fps4.nl` is a distinct resource from `https://auth.fps4.nl`; the MCP
  spec's discovery chain (resource metadata → authorization-server metadata) is designed for this
  cross-origin case and is the well-trodden path, not an edge case.
- **Single-label subdomain, fleet-consistent, wildcard-friendly.** `auth-mcp.fps4.nl` sits under a
  `*.fps4.nl` wildcard cert (a two-level `mcp.auth.fps4.nl` would not), and establishes the fleet pattern
  `<service>-mcp.fps4.nl` for every other service that later exposes MCP.
- **Independent evolution.** A distinct origin lets the MCP edge be rate-limited, WAF'd, scaled, or moved
  to its own deploy unit without touching the token-issuance surface.

The reverse proxy / ingress adds one vhost `auth-mcp.fps4.nl → http://identity-service:7305/mcp`; the app
still serves it in-process for now.

### 3. identity-service is the authorization server for its own MCP resource

We implement the MCP authorization spec with the service playing **both roles**, advertised by metadata
served at the appropriate origins:

- **Protected Resource Metadata (RFC 9728)** at **`https://auth-mcp.fps4.nl/.well-known/oauth-protected-resource`**:
  the `resource` identifier (`https://auth-mcp.fps4.nl`), the `authorization_servers`
  (`https://auth.fps4.nl`), `scopes_supported` (the admin area scopes — `admin:tenants`, `admin:clients`,
  `admin:users`, `admin:keys`, `admin:stats`, and the `admin` superscope), and the supported
  sender-constraining methods (`dpop_signing_alg_values_supported`).
- **Authorization Server Metadata (RFC 8414)** at **`https://auth.fps4.nl/.well-known/oauth-authorization-server`**:
  describing the **existing** `/oauth2` plane — `authorization_endpoint`, `token_endpoint`,
  `revocation_endpoint`, `registration_endpoint` (#7), `jwks_uri` (the existing `/.well-known/jwks.json`),
  `grant_types_supported` (`authorization_code`, `client_credentials`, `refresh_token`),
  `code_challenge_methods_supported` (`S256`), and `dpop_signing_alg_values_supported`. These are
  descriptive — they document what already exists; no new OAuth machinery is invented here.
- **401 challenge.** An unauthenticated or under-scoped request to the MCP endpoint returns `401` with
  `WWW-Authenticate: Bearer resource_metadata="https://auth-mcp.fps4.nl/.well-known/oauth-protected-resource"`,
  the signal MCP clients follow to begin discovery and authorization.

### 4. Authentication and identity assurance — separate authN from authZ, step up for admin

Two client shapes, both served by endpoints that already exist:

- **Interactive operators/agents — `authorization_code` + PKCE.** The MCP client opens `/oauth2/authorize`
  in a browser; the operator authenticates with the IdP that already backs the service (Google SSO, or
  local credentials per [ADR-0001](0001-local-credential-idp.md)); the client exchanges the code at
  `/oauth2/token` with `code_verifier`.
- **Headless agents — `client_credentials`.** A registered MCP client presents its credential for a machine
  token, preserving today's automation path without SSH.

Two principles make this future-proof rather than a hardcoded shortcut:

- **Admin scopes are role-derived, not stapled to a user record.** A human's `admin:*` entitlements come
  from **role/group membership resolved at token-issuance time**, so granting/revoking admin power is a
  membership change, not a token-schema edit. (This keeps authZ-of-the-product distinct from the
  decentralized product authZ of [ADR-0005](0005-decentralized-authorization.md): admin of identity-service
  itself is the service's own concern.)
- **Step-up assurance is required for admin scopes.** Issuing a token carrying `admin`/`admin:*` requires a
  satisfied MFA/assurance condition surfaced as an `acr`/`amr` claim; the MCP resource rejects admin-scoped
  tokens lacking the required assurance. Interactive grants also show an **explicit consent screen** naming
  the privileged scopes requested. Clients request **least-privilege per session** (only the scopes for the
  tools they will call), and key rotation (`admin:keys`) sits behind the highest assurance.

### 5. Audience-bound *and* sender-constrained tokens

Bearer tokens for admin power are a single-factor-of-possession liability: a leaked token is full
compromise. So MCP tokens are constrained two ways:

- **Audience-bound (RFC 8707).** Clients request tokens with `resource=https://auth-mcp.fps4.nl`; the
  token's audience is bound to the MCP resource and verified on every request. A token minted for another
  resource is rejected at the MCP endpoint, and an MCP token cannot be replayed against an unrelated
  resource server — the token-confusion mitigation the MCP authorization spec calls for.
- **Sender-constrained (RFC 9449 DPoP / RFC 8705 mTLS).** Tokens are bound to a key the client holds:
  **DPoP** for interactive/public clients (a per-request proof JWT), **mTLS-bound** as the option for
  headless agents. **Sender-constraining is required for high-privilege scopes** (notably `admin:keys`);
  for clients that cannot yet do DPoP, a **bearer fallback is permitted only with a short TTL and only for
  lower-privilege scopes**, and that allowance is a tracked deprecation, not a permanent mode. This is the
  OAuth 2.0 Security BCP (RFC 9700) posture for sensitive resources.

### 6. Short admin-token lifetimes with a real revocation path

JWTs verify locally (no introspection round-trip) but are valid until expiry, which is wrong for admin
power. So:

- **Short admin/MCP access-token TTL** (target ~5 min, well under the default 15) with **refresh-token
  rotation**, shrinking the replay window.
- **Revocation that actually bites:** the existing `/oauth2/revoke` plus a **`jti` denylist** checked at the
  MCP resource for emergency kill of a specific token before it expires; optional RFC 7662 introspection is
  available if a future verifier needs real-time status. Revoking a compromised admin session must not wait
  out a token lifetime.

### 7. Gated dynamic client registration — done properly, not deferred

MCP clients increasingly *expect* to self-register; making every new client a manual `/admin/v1/clients`
action is an operational bottleneck and not future-proof. But the MCP resource fronts **admin-power
tooling**, so open registration is unacceptable. The resolution is **gated** dynamic registration:

- **RFC 7591 with an initial access token.** Registration requires a one-time, admin-issued initial access
  token (or a signed software statement); there is no anonymous open registration.
- **Zero privilege by default.** A freshly registered client receives **no** `admin:*` scope; elevation to
  any admin scope is a separate, audited admin action. Registering a client is thus convenient but is never
  itself a privilege-escalation vector.
- **Lifecycle management (RFC 7592).** Registered clients can be read/updated/deleted via the registration
  management protocol, with fixed redirect-URI and scope allow-lists enforced server-side.

Phase 1 may still pre-register the known clients (Claude, the operator's IDE, the seeded
`identity-admin-mcp`) to bootstrap; gated DCR is the **target steady state**, not a "maybe later." The
expected holder of the initial access token — and custodian of the resulting agent credentials — is
**maestro** (§10), not a human copy-pasting secrets.

### 8. Authorization and audit are unchanged in model — strengthened in observability

The MCP endpoint reuses the ADR-0007 machinery wholesale: `verifyAdminToken` (issuer = `AUTH_JWT_ISSUER`,
verified against the local JWKS, now also enforcing audience + sender-constraint + assurance) yields the
`AdminPrincipal`; `principalHasScope(principal, tool.areaScope)` gates each tool; every call (allowed,
denied, failed) is written append-only to the `AuditLog` collection. One authorization model, one audit
trail, **three transports.** Strengthened:

- **Structured, attributable audit** gains a transport discriminator (`method: 'MCP'`, `transport: 'http'`),
  the `client_id`, the `resource`, the scopes actually exercised, and a request/trace id — and is **emitted
  to maestro** (§10), the internal agentic-ops plane, for fleet-level correlation and alerting on anomalous
  admin activity. fps4/* services do not onboard to external SaaS such as Datadog.
- **Tamper-evidence (optional, follow-up):** the per-call records are hash-chainable so retroactive edits
  are detectable; the fleet-wide chain/correlation lives in maestro, this service emits the links.
- For **interactive users**, the audited principal is the `sub` (the human), preserving per-actor
  attribution that ADR-0003 required and a static secret could not give.

This requires the one substantive change to the principal model, called out as work: today
`verifyAdminToken` requires a machine token (a `cid` claim) and rejects user-subject tokens. The
interactive flow in #4 produces **user** tokens, so admin authorization must be extended to accept a user
principal **that carries (role-derived) admin scopes and the required assurance**. This is the crux change
and is sequenced first.

### 9. Network exposure and defense in depth

Putting admin tooling on the public internet is the ADR-0003/0007 attack surface, now larger and public.
It ships with layered controls, not a single gate:

- **Transport hardening:** validate the `Origin` header (DNS-rebinding protection), an explicit **CORS
  allow-list** for browser-based MCP clients, and **stateless, request-scoped** handling — each JSON-RPC
  request re-derives its principal from the (constrained) token rather than holding long-lived server
  sessions, so there is no session to fixate; any `Mcp-Session-Id` is bound to the authenticated principal.
- **Abuse controls:** per-principal **rate limiting** at the MCP origin, a WAF in front of
  `auth-mcp.fps4.nl`, and anomaly alerting off the shipped audit stream.
- **Blast-radius limits:** least-capability scopes per agent, the highest-privilege tools behind
  sender-constraint + step-up, and `ADMIN_API_ENABLED=false` as a **kill switch** that disables the whole
  management plane (MCP included), as today.
- **stdio retained as break-glass:** the SSH `docker/mcp-admin.sh` path stays for local/dev and for
  recovery when the HTTP plane is intentionally closed or down; it is no longer the *primary* remote path.

### 10. Relationship to maestro — the agentic-ops plane this resource is built for

The remote MCP endpoint is not built for ad-hoc human callers in isolation; its primary consumer is
**maestro**, fps4's internal agentic-ops product (and the reason fps4/* services ship ops to maestro, not
to external SaaS like Datadog). This ADR draws the boundary so identity-service exposes clean **emission**
and **action** contracts and delegates ops *intelligence* to maestro, rather than growing a mini-observability
stack inside the IdP (consistent with the decentralization spirit of [ADR-0005](0005-decentralized-authorization.md)):

- **maestro is the agent-credential custodian.** The gated DCR of #7 is designed around maestro holding the
  initial access token and being the broker that **registers, scopes, rotates, and revokes** agent
  credentials against this service's `/oauth2` + registration endpoints. identity-service stays the
  authorization server (it mints and verifies tokens); maestro is the operator runtime that **holds** the
  credentials and the keys backing DPoP/mTLS (#5). Agents never carry standing long-lived secrets that a
  human pasted.
- **maestro is the audit aggregation and alerting plane.** identity-service keeps its append-only
  `AuditLog` as the local system of record (per [ADR-0008](0008-drop-sops-db-is-system-of-record.md)) and
  **emits** structured, correlated records (#8); maestro owns fleet-wide correlation (by request/trace id
  across services), the tamper-evident chain, anomaly detection, and notification routing. This service does
  not implement monitors or dashboards itself.
- **maestro is the closed-loop remediation caller.** The eleven MCP tools are precisely the **action
  surface** maestro invokes from agentic runbooks — e.g. a lockout-storm signal drives an automated
  `unlock_user`, a leaked-secret signal drives `rotate_client_secret`. This is *why* the security controls
  above are load-bearing rather than ceremonial: an automated operator that can act must do so under
  least-privilege scopes, sender-constrained tokens, step-up for the highest-risk tools (`rotate_signing_key`
  stays behind the strongest constraint even for a runbook), and full per-actor audit attributing the action
  to the maestro principal.

The concrete contracts (DCR/initial-access-token handshake, the audit emission schema and transport, and
the remediation scope grants for automated runbooks) are specified with maestro and tracked as follow-ups,
not frozen here.

### Rollout phases

1. **Refactor:** split the MCP JSON-RPC/tool core from the stdio transport into a shared handler.
2. **Principal model:** extend admin-auth to accept role-derived, assurance-gated **user** admin tokens
   (the §4/§8 crux), with per-actor audit on `sub`.
3. **Resource endpoint:** mount Streamable HTTP, stand up `auth-mcp.fps4.nl` (vhost + cert + WAF), serve
   RFC 9728/8414 metadata and the 401 challenge; audience-bind tokens; ship audit to maestro.
4. **Sender-constraining:** DPoP (interactive) and mTLS (agents); require it for `admin:keys`, short-TTL
   bearer fallback elsewhere as a tracked deprecation.
5. **Self-service:** gated RFC 7591/7592 dynamic registration with initial access tokens and zero-default
   privilege; pre-registered clients remain the bootstrap.

### Why not the alternatives

- **Keep SSH + stdio (uphold ADR-0007's transport as-is).** Functional but fails the requirement: no
  off-network reach, requires production shell access per caller, and is not the flow MCP clients speak.
  Kept as break-glass, not as the door.
- **Same-origin path `auth.fps4.nl/mcp` instead of a dedicated origin.** Simpler (one vhost, one cert, no
  cross-origin discovery), and was the first draft's choice — but it co-locates admin tooling with the
  token-issuance crown-jewel origin, weakens the resource-indicator/audience model, and bakes in a
  coupling that is expensive to undo. We pay the small extra setup for origin isolation now.
- **Bearer-only tokens (skip DPoP/mTLS).** Simplest and widely interoperable, but a single leaked admin
  bearer is total compromise. We require sender-constraining for high-privilege scopes and treat bearer as
  a short-TTL, lower-scope, deprecating fallback.
- **Static `admin:*` scopes stapled to user records (skip role-derivation/step-up).** Easy to ship, but
  makes admin grants a schema edit and gives privileged tokens with no assurance signal. Role-derived,
  step-up-gated scopes are the maintainable, auditable shape.
- **Defer dynamic registration; pre-register forever.** Manual registration is fine to bootstrap but
  becomes a bottleneck as MCP clients proliferate and expect DCR. Gated DCR (IAT + zero default privilege)
  gives self-service without an escalation path.
- **Stand up a separate authorization server (Auth0/Keycloak) in front of MCP.** Rejected — we already run
  a conformant OAuth authorization server with JWKS, PKCE, and revocation. A second IdP adds an
  integration, a second issuer, and a second audit story for zero capability we lack.
- **Run MCP as its own container/service now.** Rejected for now — the handler needs the same Mongo reach,
  signing keys, issuer, and service layer the app already has (which is why the stdio server runs *inside*
  the container today). In-process keeps one deploy unit and one config; the dedicated origin (#2) and the
  transport-agnostic handler (#1) keep extraction cheap when scale demands it.
- **Open dynamic registration / static API key at the MCP endpoint.** Rejected for the reason ADR-0003
  rejected static secrets for the management API: no per-actor attribution, no scoped authority, trivial
  privilege escalation. The gated OAuth flow gives all three.

## Consequences

- **The management plane gets its largest attack surface yet — admin tooling on the public internet.** It
  is defended in depth: OAuth 2.1 with PKCE, audience-bound **and** sender-constrained tokens, role-derived
  step-up-gated admin scopes, short TTLs with revocation that bites, per-principal rate limiting, a WAF,
  origin/CORS validation, anomaly alerting off shipped audit, and an `ADMIN_API_ENABLED` kill switch. This
  is a standing security responsibility; `auth-mcp.fps4.nl` belongs in the security-review and pen-test
  rotation.
- **The admin-auth principal model must accept role-derived, assurance-gated user tokens**, not just
  machine (`cid`) tokens — the prerequisite for the interactive flow. This touches
  `service/src/core/admin-auth.ts` (audience, DPoP/mTLS confirmation, `acr`/`amr` checks, user principals)
  and the audit attribution (audit on `sub` for users). It is the first build step and a contract change to
  the admin-auth layer ADR-0007 introduced.
- **New OAuth capabilities to build, not just document:** DPoP/mTLS verification (RFC 9449/8705), audience
  binding (RFC 8707), a `jti` denylist for revocation, role→scope derivation with step-up, gated dynamic
  registration (RFC 7591/7592), and the two metadata documents (RFC 9728/8414). The metadata must track any
  change to the `/oauth2` plane.
- **New public infrastructure:** the `auth-mcp.fps4.nl` vhost, its TLS cert (under `*.fps4.nl`), and its
  WAF/rate-limit config — a new edge to operate, separate from `auth.fps4.nl`.
- **The stdio server becomes a thin transport over a shared handler** — a small refactor of
  `service/src/mcp/server.ts` to split transport from JSON-RPC/tool logic, after which stdio and HTTP share
  one code path (and one place to add tools).
- **MCP protocol version moves forward** (`2024-11-05` → `2025-03-26`+) to get Streamable HTTP and the
  authorization spec; the tool catalogue and scopes are unchanged from ADR-0007.
- **Audit becomes an observability stream, not just a collection** — maestro ingestion, anomaly alerts, and
  (optionally) hash-chaining for tamper-evidence; this is new operational surface with its own value.
- **DPoP introduces an interop tradeoff:** clients that cannot do DPoP yet fall back to short-TTL bearer on
  lower-privilege scopes only, tracked as a deprecation; the highest-privilege tools are unavailable to
  non-constrained clients by design.
- **maestro is the named primary consumer** (§10): the agent-credential custodian via gated DCR, the audit
  aggregation/alerting plane, and the closed-loop remediation caller of the MCP tools. The boundary keeps
  ops intelligence in maestro and leaves identity-service exposing clean emission + action contracts — but
  it creates a real dependency: the DCR/initial-access-token handshake, the audit emission schema/transport,
  and the remediation scope grants must be co-designed with maestro, and automated remediation means a
  maestro compromise can drive admin actions (bounded by least-privilege scopes, step-up on the riskiest
  tools, and audit).
- **Follow-ups (named, not built here):** the concrete role/group model and where membership lives; the
  step-up assurance mechanism for local-credential users (Google SSO can enforce MFA upstream); audit
  hash-chaining; the **maestro contracts** (credential custody/DCR handshake, audit emission schema, runbook
  remediation scopes); CORS specifics for browser MCP clients; refresh-token rotation tuning for long-lived
  MCP sessions; and load/abuse testing of the public MCP surface.
