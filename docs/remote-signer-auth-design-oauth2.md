# Remote Signer Authentication Design Proposal

**Updated for OAuth 2.0 / OIDC Apps Architecture (pymthouse + naap)**

*This document updates the original [Remote Signer Authentication Design Proposal](https://bubble-holly-e80.notion.site/Remote-Signer-Authentication-Design-Proposal-30568e4f5e31804ba200d83dbc60f5cd) to reflect the authentication architecture used by pymthouse and naap.*

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Architecture Overview](#2-architecture-overview)
3. [OAuth 2.0 / OIDC Apps Model](#3-oauth-20--oidc-apps-model)
4. [Authentication Flow](#4-authentication-flow)
5. [Token Types and Validation](#5-token-types-and-validation)
6. [Signer Proxy API](#6-signer-proxy-api)
7. [Deployment Models](#7-deployment-models)
8. [Implementation Phases](#8-implementation-phases)
9. [Security Considerations](#9-security-considerations)
10. [Reference](#10-reference)

---

## 1. Current State

The remote signer (go-livepeer) provides two HTTP endpoints (`/sign-orchestrator-info`, `/generate-live-payment`) that delegate signing authority from a hot wallet. In the pymthouse + naap architecture, these endpoints are **not** exposed directly to external clients. Instead, a **proxy layer** in pymthouse sits in front of the signer and performs all authentication.

### Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Signer proxy | ✅ Complete | Auth + forward to go-livepeer |
| Bearer token (pmth_) auth | ✅ Complete | Session-based, DB lookup |
| OIDC provider (pymthouse) | ✅ Complete | Auth code + refresh, JWKS |
| Developer apps | ✅ Complete | OIDC clients per app |
| naap OIDC integration | ✅ Complete | Billing provider RP |
| Scope enforcement | ✅ Complete | gateway, admin; app approval check |

### Core Files

| File | Purpose |
|------|---------|
| `pymthouse/src/lib/auth.ts` | Bearer token validation, session lookup, scopes |
| `pymthouse/src/lib/signer-proxy.ts` | Forward to signer, usage tracking, StreamSession |
| `pymthouse/src/app/api/signer/sign-orchestrator-info/route.ts` | Proxy: auth + forward |
| `pymthouse/src/app/api/signer/generate-live-payment/route.ts` | Proxy: auth + value tracking + app approval |
| `pymthouse/src/lib/oidc/tokens.ts` | OIDC JWT minting (id_token, access_token) |
| `pymthouse/src/lib/oidc/jwks.ts` | RS256 signing keys, JWKS endpoint |
| `pymthouse/src/lib/oidc/clients.ts` | OIDC client registration (naap, developer apps) |
| `naap/packages/database/src/billing-providers.ts` | Billing provider OIDC config (pymthouse) |

---

## 2. Architecture Overview

### Key Design Change: Proxy-First, Not Signer-First

The original design had the **remote signer** validate JWTs directly via JWKS. In the new architecture:

1. **The signer has no auth.** It runs on a private network (e.g., `localhost` or internal Docker network). Only the proxy can reach it.
2. **The proxy does all auth.** pymthouse validates requests before forwarding to the signer.
3. **Dual token model:**
   - **Bearer tokens (pmth_)** — opaque, session-based. Used for signer proxy access. Validated by DB lookup.
   - **OIDC JWTs** — id_token and access_token. Used for identity, billing, and entitlements. Signed by pymthouse, verifiable via JWKS.

```
┌─────────────────┐     Authorization: Bearer pmth_xxx      ┌─────────────────┐     (no auth)    ┌─────────────────┐
│  Client (naap,  │ ─────────────────────────────────────────▶│  pymthouse      │ ─────────────────▶│  go-livepeer    │
│  ComfyUI, etc.) │                                          │  Signer Proxy   │                   │  Remote Signer  │
└─────────────────┘                                          └─────────────────┘                   └─────────────────┘
                                      │
                                      │ DB: sessions (tokenHash, scopes, appId, endUserId)
                                      ▼
                            ┌─────────────────────┐
                            │  pmth_ token valid? │
                            │  scope >= gateway?  │
                            │  app approved?      │
                            └─────────────────────┘
```

---

## 3. OAuth 2.0 / OIDC Apps Model

### Roles

| Role | Service | Description |
|------|---------|-------------|
| **Identity Provider (IdP)** | pymthouse | Issues OIDC tokens (id_token, access_token) via auth code + refresh flows |
| **Relying Party (RP)** | naap | Connects to pymthouse as billing/identity provider |
| **Developer App** | External | Registers with pymthouse, gets OIDC client_id, requests scope for signer access |

### OIDC Flow (pymthouse as IdP)

1. **Discovery:** `GET /.well-known/openid-configuration`
2. **Authorization:** `GET /api/v1/oidc/authorize?client_id=...&redirect_uri=...&response_type=code&state=...&scope=openid profile email plan entitlements`
   - `state` is **required** (the endpoint enforces this and returns `invalid_request` if missing).
   - PKCE (`code_challenge` + `code_challenge_method`) is required for public clients (`tokenEndpointAuthMethod=none`).
3. **Consent:** User approves scopes (pymthouse consent page). The `naap` client is auto-approved (no consent page shown).
4. **Token:** `POST /api/v1/oidc/token` with `grant_type=authorization_code` + `code` + PKCE

### Developer Apps

- Developers register **apps** via pymthouse (name, redirect URIs, scopes).
- Each approved app gets an **OIDC client** with a generated `client_id` (format: `app_<24hex>`).
- New app clients start as **public clients** (`tokenEndpointAuthMethod=none`), requiring PKCE.
- An optional client secret (prefix `pmth_cs_`) can be generated, which switches the client to `client_secret_post` auth.
- Apps can request scopes: `openid`, `profile`, `email`, `plan`, `entitlements`.
- Tokens can be scoped to an **app** (`appId` in session) for attribution and approval checks.

### naap Integration

- naap configures pymthouse as a **billing provider** (OIDC).
- Config: `oidcIssuer`, `oidcClientId`, `oidcClientSecret`, `oidcScopes`, `oidcDiscoveryUrl`.
- Users link billing via OIDC flow; naap stores `idTokenSub`, `oidcPlan`, `oidcEntitlements` for entitlement mapping.

---

## 4. Authentication Flow

### Option A: Bearer Token (pmth_) — Primary for Signer Access

```
User/App                          pymthouse                         go-livepeer
    │                                  │                                  │
    │  POST /api/signer/sign-orchestrator-info                           │
    │  Authorization: Bearer pmth_xxxxx                                 │
    │ ───────────────────────────────▶                                  │
    │                                  │ validateBearerToken()           │
    │                                  │ hasScope("gateway")             │
    │                                  │ proxySignOrchestratorInfo()     │
    │                                  │ POST /sign-orchestrator-info ──▶│
    │                                  │◀───────────────────────────────│
    │ ◀─────────────────────────────── │                                  │
```

### Option B: OIDC Flow → pmth_ Token (for naap / external apps)

```
naap / App                    pymthouse OIDC                    pymthouse Signer Proxy
    │                                │                                    │
    │  GET /api/v1/oidc/authorize     │                                    │
    │ ──────────────────────────────▶│                                    │
    │  Redirect to consent           │                                    │
    │ ◀────────────────────────────── │                                    │
    │  User approves                 │                                    │
    │  POST /api/v1/oidc/token       │                                    │
    │  (code, code_verifier)          │                                    │
    │ ──────────────────────────────▶│                                    │
    │  access_token (JWT)             │                                    │
    │  id_token (JWT)                 │                                    │
    │  refresh_token                  │                                    │
    │ ◀────────────────────────────── │                                    │
    │                                │                                    │
    │  [Future: token exchange]       │                                    │
    │  Exchange OIDC access_token    │                                    │
    │  for pmth_ session token ──────┼───────────────────────────────────│
    │                                │                                    │
    │  POST /api/signer/*             │                                    │
    │  Authorization: Bearer pmth_   │                                    │
    │ ──────────────────────────────┼───────────────────────────────────▶│
```

*Note: Currently, pmth_ tokens for signer access are obtained via the Tokens API (admin-created) or the deprecated naap link flow. A future OIDC-to-pmth_ exchange endpoint would close this loop for OIDC-first clients.*

---

## 5. Token Types and Validation

### Bearer Tokens (pmth_)

| Attribute | Value |
|-----------|-------|
| Format | Opaque string, prefix `pmth_` |
| Storage | `sessions` table: `tokenHash` (SHA-256), `scopes`, `userId`, `endUserId`, `appId`, `expiresAt` |
| Validation | Hash lookup, expiry check |
| Scopes | `gateway` (signer access), `admin` (admin operations), `read` (read-only billing/stats) |

### OIDC Tokens (JWTs)

| Token | Audience | Claims | Expiry | Signed By |
|-------|----------|--------|--------|-----------|
| id_token | client_id | sub, email, name, role, plan, entitlements, nonce | 1 hour | pymthouse (RS256, JWKS) |
| access_token | issuer | sub, scope, client_id | 1 hour | pymthouse (RS256, JWKS) |
| refresh_token | — | opaque (hashed in DB) | 30 days; rotated on use | pymthouse sessions table |

JWKS endpoint: `GET /api/v1/oidc/jwks` (advertised via `/.well-known/openid-configuration` as `jwks_uri`).

---

## 6. Signer Proxy API

### Endpoints

| Method | Path | Auth | Scope | Notes |
|--------|------|------|-------|-------|
| POST | `/api/signer/sign-orchestrator-info` | Bearer pmth_ | gateway | Forward to signer; no app approval check |
| POST | `/api/signer/generate-live-payment` | Bearer pmth_ | gateway | Track usage, StreamSession, Transactions; **app-scoped tokens require app to be `approved`** |

### Auth Logic

```typescript
// generate-live-payment route auth (sign-orchestrator-info skips the app check)
const auth = authenticateRequest(request);  // validateBearerToken(header)
if (!auth) return 401;
if (!hasScope(auth.scopes, "gateway")) return 403;
if (auth.appId) {  // only on generate-live-payment
  const app = db.select().from(developerApps).where(id === auth.appId).get();
  if (!app || app.status !== "approved") return 403;
}
// Forward to signer
```

### Context Propagated to Downstream

- `userId` — Admin/operator who owns the token
- `endUserId` — End user (for multi-tenant attribution)
- `appId` — Developer app (must be approved for generate-live-payment)
- `sessionId`, `scopes`, `tokenHash`

---

## 7. Deployment Models

### Model A: Proxy (Primary)

```
[Client] ──Bearer pmth_──▶ [pymthouse Proxy] ──internal──▶ [go-livepeer Signer]
```

- Signer is on private network.
- All external traffic goes through the proxy.
- This is the default and only model in pymthouse.

### Model B: Direct Signer Access (Original Design)

*Not used in pymthouse/naap.* The original design had clients call the signer directly with JWT. In the current architecture, the signer is never exposed; the proxy is the single entry point.

---

## 8. Implementation Phases

### Phase 1: Proxy + Bearer Auth — COMPLETE ✅

- Bearer token validation (`pmth_`) with session DB lookup
- Scope enforcement (`gateway`, `admin`)
- Signer proxy routes for sign-orchestrator-info and generate-live-payment
- Usage tracking (StreamSession, Transactions)
- App approval check for app-scoped tokens

### Phase 2: OIDC Provider — COMPLETE ✅

- OIDC endpoints: authorize, token, consent, JWKS, userinfo
- Developer apps with OIDC clients
- RS256 signing keys, key rotation
- id_token and access_token with plan/entitlements claims

### Phase 3: naap OIDC Integration — COMPLETE ✅

- Billing provider config (pymthouse as IdP)
- OIDC auth code flow with PKCE
- id_token validation, oidcSub/oidcPlan/oidcEntitlements binding

### Phase 4: OIDC-to-pmth_ Exchange (Future)

- New endpoint: exchange OIDC access_token for pmth_ session token
- Enables OIDC-first clients (naap, third-party apps) to obtain signer credentials without legacy link flow

### Phase 5: X402 Payment Middleware (Future)

- Per-endpoint pricing, facilitator integration
- Compatible with proxy model; would sit alongside existing auth

---

## 9. Security Considerations

| Threat | Mitigation |
|--------|------------|
| Stolen pmth_ token | Short expiry for sensitive tokens; revoke via `revokeSession()` |
| Stolen OIDC token | Access tokens expire in 1h; refresh tokens expire in 30 days with rotation on each use |
| Unapproved app | generate-live-payment checks `developerApps.status === "approved"` |
| Cross-user hijacking | Sessions have `endUserId`; StreamSession links to token hash |
| Signer exposure | Signer never exposed; proxy is single ingress |
| JWKS compromise | Pymthouse JWKS is internal; use HTTPS, access controls |

### Defense in Depth

- Run pymthouse behind reverse proxy with TLS
- Use network-level access controls for signer (localhost/internal only)
- Monitor hot wallet balance and set alerts
- Rotate OIDC signing keys periodically

---

## 10. Reference

### Comparison: Original Design vs. OAuth 2.0 Apps Architecture

| Aspect | Original (JWT/JWKS at Signer) | New (Proxy + OAuth 2.0 Apps) |
|--------|-------------------------------|------------------------------|
| Signer auth | JWT via JWKS (remoteSignerJWKSUrl) | None — signer on private network |
| Client auth | Bearer JWT (any issuer with JWKS) | Bearer pmth_ (session DB) |
| Identity / billing | JWT sub = user ID | OIDC id_token; naap stores oidcSub, plan, entitlements |
| Apps | N/A | Developer apps with OIDC clients |
| Token issuance | External auth service (jwt-issuer, etc.) | pymthouse: sessions API, OIDC token endpoint |

### Related Documentation

- [SSO with Google & GitHub (OAuth 2.0)](./sso-oauth-google-github.md) — naap admin OAuth
- [pymthouse clearinghouse plan](../../pymthouse/.cursor/plans/pymthouse_clearinghouse_plan.plan.md) — Signer proxy, StreamSession
- Original design: [Remote Signer Authentication Design Proposal](https://bubble-holly-e80.notion.site/Remote-Signer-Authentication-Design-Proposal-30568e4f5e31804ba200d83dbc60f5cd)
