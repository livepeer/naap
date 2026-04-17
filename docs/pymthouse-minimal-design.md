# PymtHouse Requirements Spec (NaaP Epic 3)

## Goal

Build `pymthouse` as a hosted SaaS that lets a small number of early billing providers monetize Livepeer-backed AI access without running their own billing stack.

Keep the product boundary simple:

- `pymthouse` owns billing, plan management, subscriptions, API keys, OAuth/OIDC identity, and signer proxying.
- `NaaP` owns marketplace, network intelligence products, and **public orchestrator discovery**.
- SDKs use one simple API surface to access the network and standards-based OIDC to obtain JWTs.
- SDKs discover orchestrators via the **NaaP public discovery endpoint** (`/api/v1/network/discover-orchestrators`), eliminating the need for provider signers to implement their own discovery logic.

This document intentionally favors simplicity over completeness. It removes ideas that add architectural cleverness without improving the MVP.

---

## Proposed Requirements Baseline

This document outlines proposed MVP identity and runtime architecture requirements for `pymthouse`.

- OAuth protocol baseline: OAuth 2.0 with OpenID Connect (OIDC), not OAuth 1.0.
- Interactive auth flow: OIDC Authorization Code with PKCE for `pymthouse` app owners, administrative users, and standards-based client integrations, consistent with RFC 6749, RFC 7636, RFC 8252, and OpenID Connect Core 1.0.
- Server-to-server flow: Client Credentials for tenant user management APIs.
- Default non-owner end-user path: confidential user provisioning plus programmatic token issuance for provider-controlled applications.
- Token format: JWT access and ID tokens signed with RS256 or ES256, with JWKS published for verification (RFC 7517, RFC 7519).
- Attribution model: app-aware and user-aware claims in tokens and usage logs (`app_id`, `user_id`) to support billing correctness.
- Runtime routing: single SDK hostname in MVP (`api.pymthouse.io`) with provider resolution derived from tenant context.
- **Discovery routing**: SDK discovers orchestrator candidates from the NaaP public API (`/api/v1/network/discover-orchestrators`), which serves cached network-wide data independently of any provider signer.
- Discovery is handled by NaaP (network-wide) and optionally refined by the remote signer (provider-scoped).
- Compliance posture: remain non-custodial for payments and keep auditable auth/user-management events.

### Success Metrics

These targets define MVP acceptance thresholds for the identity and signing stack:

| Metric | Target |
|---|---|
| OIDC Authorization Code + PKCE auth success rate | > 99% |
| Signed requests with valid `app_id` and `user_id` attribution | > 99.5% |
| Token issuance latency (p95) | < 300 ms |
| Signer JWT verification latency (p95) | < 100 ms |
| NaaP discovery endpoint latency (p95) | < 500 ms |
| NaaP discovery data freshness | ≤ 30 min |
| Misattributed or un-attributed usage events | < 0.1% |
| Auth event audit log completeness | 100% |
| Critical auth vulnerabilities (pen test) | 0 |
| Tenant integration time (median, with docs + SDK) | < 1 day |

---

## Design Principles

1. `pymthouse` should behave like a billing platform, not a second control plane.
2. `NaaP` provides network-wide orchestrator discovery as a public API. `pymthouse` enforces billing boundaries on top of what the network provides. Remote signers curate and execute, but discovery is a network-level concern served by NaaP.
3. Billing correctness wins over graceful degradation.
4. Standard flows beat custom protocols.
5. Optimize for a small number of early providers, not internet-scale multi-tenancy.
6. Provider-controlled UX can remain external; provider-specific runtime endpoints are not required.
7. Anything not required to prove the business should be deferred.

---

## Product Boundary

### pymthouse

Owns:

- Provider onboarding
- Plan definition
- Subscription lifecycle
- API key issuance and revocation
- Key validation
- Plan-aware signer proxying
- Usage recording for billing
- Owner and admin management surfaces
- OIDC identity for interactive `pymthouse` operators and client integrations
- API-based user provisioning and token issuance for provider-controlled end users

### NaaP

Owns:

- Provider marketplace
- Network console
- Cross-provider developer utilities
- Historical SLA and network price intelligence
- Community-facing identity for the control-plane experience
- **Public orchestrator discovery API** (`GET /api/v1/network/discover-orchestrators`) — provides the SDK and external consumers with a network-wide, capability-filtered view of active orchestrators, their service URIs, pricing, and freshness data

### SDK

Owns:

- Supplying the API key
- **Discovering orchestrator candidates via NaaP** (`/api/v1/network/discover-orchestrators`)
- Requesting payment signatures
- Sending traffic to the network

The SDK should not need to understand provider-specific routing rules beyond the API key it was given. Orchestrator discovery is performed against the NaaP public API, which requires no authentication and returns a capability-filtered list the SDK can consume directly.

---

## Reference Scenario

This scenario is used to make flow and data-boundary requirements concrete:

| Provider | Focus | Plan | Billing Model |
|---|---|---|---|
| MedVision AI | Healthcare imaging | Clinical Pro | Monthly subscription |
| PixelForge | Creative tooling | Creator | Pay as you use |

| User | Subscriptions |
|---|---|
| SynthLab | MedVision + PixelForge |

---

## Architecture Summary

```text
+------------------------------------------------------------------------+
| pymthouse SaaS                                                         |
| - one deployment on Vercel                                             |
| - one PostgreSQL database                                              |
| - one OIDC issuer                                                      |
| - one tenant primitive: client_id / developerApp                       |
| - one runtime API base: api.pymthouse.io                               |
|                                                                        |
|   Provider A: MedVision            Provider B: PixelForge              |
|   - plans                          - plans                              |
|   - subscriptions                  - subscriptions                      |
|   - keys                           - keys                               |
|   - signer config                  - signer config                      |
|   - owner/admin controls           - owner/admin controls               |
+-------------------------+-------------------------------+--------------+
                          |                               |
                          v                               v
                 +------------------+             +------------------+
                 | MedVision Signer |             | PixelForge Signer|
                 | (provider-hosted)|             | (provider-hosted)|
                 | - /sign-job      |             | - /sign-job      |
                 +------------------+             +------------------+

+------------------------------------------------------------------------+
| NaaP (Network Intelligence)                                            |
| - GET /api/v1/network/discover-orchestrators                           |
|   Public, cached (30 min TTL), capability-filtered                     |
|   Returns: address, service_uris, capabilities, pricing, last_seen     |
+------------------------------------------------------------------------+
                          ^
                          |
                 +------------------+
                 |   SDK / Client   |
                 | 1. Discover orch → NaaP /discover-orchestrators        |
                 | 2. Validate key  → pymthouse /validate                 |
                 | 3. Sign job      → pymthouse → provider signer         |
                 | 4. Send traffic  → orchestrator                        |
                 +------------------+
```

### Runtime Flow

1. **Discovery** — SDK calls NaaP `GET /api/v1/network/discover-orchestrators?caps=text-to-image` to obtain orchestrator candidates. This is a public, unauthenticated call that returns cached network-wide data.
2. **Key validation** — SDK presents its API key to `pymthouse`, which validates the key, resolves the provider context, and confirms the subscription covers the requested pipeline.
3. **Signing** — SDK requests a payment signature from `pymthouse`, which proxies the request to the provider's remote signer.
4. **Traffic** — SDK sends signed traffic directly to the chosen orchestrator.

Runtime rules:

- NaaP discovery data is derived from the Livepeer on-chain registry and cached for up to 30 minutes.
- If NaaP discovery is temporarily unavailable, clients receive a `503` with `Cache-Control: public, max-age=0, s-maxage=5, stale-while-revalidate=0` — fail-closed behavior with rapid cache expiry.
- Provider signers remain authoritative for signing and payment; `pymthouse` enforces billing boundaries.
- `pymthouse` is not in the discovery path. This reduces its runtime surface area and avoids coupling billing availability to network intelligence.

## Identity and Token Architecture

Identity behavior is intentionally minimal but standards-compliant.

### Auth Protocols

- OIDC Authorization Code + PKCE for interactive `pymthouse` flows used by app owners, administrative users, and supported client integrations.
- OAuth 2.0 Client Credentials for tenant app access to user management APIs.
- Programmatic user token issuance: provider-controlled private server-side apps call a dedicated endpoint (`POST /api/v1/apps/{app_id}/users/{external_user_id}/token`) authenticated via Client Credentials to obtain a scoped pymthouse JWT on behalf of a provisioned user, with refresh paths routed directly to pymthouse without the private app in the loop. This is the default MVP path for non-owner end users. (Decision 2B; see Option A rationale.)
- JWTs as the shared trust artifact across web app, SDK, and signer boundaries.

### Principal Model and Identifier Semantics

The specification uses two principal types and three distinct user identifiers. These identifiers are intentionally non-interchangeable.

| Term | Type | Scope | Meaning | Primary storage |
|---|---|---|---|---|
| `users` | interactive principal | platform-wide | App owners and administrative users who authenticate directly with `pymthouse` through OIDC | `users` |
| `app_users` | provisioned principal | per provider app (`client_id`) | Provider-controlled end users created or reconciled through the user management API | `app_users` |
| `sub` | token claim | token-local, but stable within the principal type | Canonical subject claim used by token consumers; for interactive flows it identifies a `users` principal, and for provisioned flows it identifies an `app_users` principal | JWT claim |
| `user_id` | internal attribution key | internal | Canonical billing and usage attribution key persisted by `pymthouse`; resolves from `sub` during token issuance and validation | billing and usage records |
| `external_user_id` | caller-supplied identifier | per provider app (`client_id`) | Provider-defined identifier used to reconcile a provider-controlled user to an `app_users` row | `app_users.external_user_id` |

Billing, audit, and runtime authorization should use `user_id` as the internal persisted attribution key. External clients should treat `sub` as the only stable token subject and should not assume direct access to internal database identifiers.

### Token Claims and Validation

Access and ID tokens should include, at minimum:

- `sub` (pymthouse user identifier; stable across provider subscriptions)
- `app_id` (provider app boundary; corresponds to `client_id`)
- `tenant_id` (only if a provider operates distinct organizational sub-tenants; omit otherwise)
- `roles`
- `scopes`
- `iss`, `aud`, `iat`, `nbf`, `exp`

Signer and internal services should validate:

- signature against current JWKS
- issuer and audience per environment
- time claims (`nbf`, `exp`) with bounded clock-skew tolerance
- required scopes for endpoint/action

`tenant_id` should be omitted unless a provider explicitly models subordinate organisational tenants beneath one `client_id`. MVP flows do not require `tenant_id`.

### Claim Validation Matrix

| Claim / property | Token issuer (`pymthouse`) | Runtime API | Remote signer | Notes |
|---|---|---|---|---|
| `sub` | issues | validates presence and resolves to internal `user_id` | validates presence | Canonical subject claim for both interactive and provisioned paths |
| `app_id` | issues | validates against requested provider context | validates against signer routing context | Must correspond to `client_id` |
| `scopes` | issues | validates per endpoint | validates per signer action | Missing required scope returns 403 |
| `iss`, `aud` | issues | validates | validates | Environment-specific values |
| `iat`, `nbf`, `exp` | issues | validates | validates | Bounded skew tolerance applies |
| refresh token binding | issues | validates on refresh | n/a | Bound to `sub`, `app_id`, and original client registration context |

### Discovery and Metadata Endpoints

- `/.well-known/openid-configuration`
- `/.well-known/jwks.json`

These endpoints are proposed MVP surfaces because they remove ambiguity for SDK and service integration and support standards-based verification.

### Defined MVP Scopes

Scopes are whitelisted per OIDC client. Requests for scopes beyond the client whitelist return `invalid_scope` per RFC 6749 §5.2.

| Scope | Grant type | Granted to | Purpose |
|---|---|---|---|
| `sign:job` | Auth Code + PKCE or programmatic issuance | Supported interactive clients and provisioned end users | Required to call signing endpoints |
| `discover:orchestrators` | Auth Code + PKCE or programmatic issuance | Supported interactive clients and provisioned end users | Required to call provider-scoped discovery refinement (if offered); NaaP public discovery does not require this scope |
| `users:read` | Client Credentials | Provider apps | Read users provisioned by a provider |
| `users:write` | Client Credentials | Provider apps | Create, update, and deactivate provider-managed users |
| `admin` | Internal | Provider admins | Access provider administration endpoints; denied to auto-provisioned users |
| `users:token` | Client Credentials | Private apps with `users:write` | Authorize issuance of a scoped access and refresh token for a provisioned user; never grants `admin` scope; cross-app requests return 403 |

---

## Tenant Model

Each provider is a promoted `developerApp`. The `client_id` is the single identifier that unifies auth flows, data tenancy, billing, and signer routing.

- **Provider-specific config**: branding, plans, signer config, subscriptions, OIDC client settings
- **Shared platform concerns**: OIDC issuer, billing engine, API surface, admin framework

Consequences:

- One OIDC issuer for all providers — no per-provider issuer or well-known endpoint.
- One runtime API base (`api.pymthouse.io`) — no per-provider runtime hostnames.
- One database instance with `client_id` row-level filtering and RLS — no per-provider deployment.
- One interactive `users` principal may own or administer multiple provider apps, but subscriptions, keys, usage records, provisioned end users, and refresh tokens remain isolated by `client_id`.
- Each provider app maps to its own `developer_apps` row. Shared ownership does not imply shared provider state.

---

## NaaP Orchestrator Discovery Endpoint

### Overview

NaaP exposes a public, unauthenticated endpoint that provides a network-wide view of Livepeer orchestrators, their capabilities, pricing, and freshness data. This endpoint is the **primary discovery mechanism** for SDKs and external consumers.

### Endpoint

```
GET /api/v1/network/discover-orchestrators
```

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `caps` | `string` (repeated) | No | Capability filter with OR semantics. Each value is a `pipeline/model` slug (e.g., `text-to-image/stabilityai/sd-turbo`). If omitted, all orchestrators are returned. |

### Response Shape

```json
[
  {
    "address": "https://orchestrator-1.example.com:8935",
    "orchestrator_address": "0xAbCd...1234",
    "score": 1,
    "capabilities": [
      "text-to-image/stabilityai/sd-turbo",
      "image-to-video/stabilityai/stable-video-diffusion"
    ],
    "service_uris": [
      "https://orchestrator-1.example.com:8935"
    ],
    "capability_details": [
      {
        "capability": "text-to-image/stabilityai/sd-turbo",
        "last_seen": "2026-04-13T10:30:00.000Z",
        "last_seen_ms": 1776278400000,
        "price_per_unit": 1200,
        "pixels_per_unit": 1
      }
    ]
  }
]
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `address` | `string` | Canonical service URI — the URI tied to the most recent `LastSeen` timestamp for this orchestrator. |
| `orchestrator_address` | `string` | On-chain Ethereum address (mixed-case, as registered). |
| `score` | `number` | `1` if the orchestrator is currently active on-chain; `0` otherwise. |
| `capabilities` | `string[]` | List of `pipeline/model` capability slugs supported by this orchestrator. Used for `caps=` filtering. |
| `service_uris` | `string[]` | All distinct service URIs observed for this orchestrator, sorted lexicographically. |
| `capability_details` | `array` | Per-capability detail including freshness and optional pricing. |
| `capability_details[].capability` | `string` | The `pipeline/model` slug. |
| `capability_details[].last_seen` | `string` | ISO 8601 timestamp of when this capability was last observed. Empty string if unknown. |
| `capability_details[].last_seen_ms` | `number` | Unix millisecond timestamp of `last_seen`. `0` if unknown. |
| `capability_details[].price_per_unit` | `number?` | Advertised price per unit from `capabilities_prices`. Omitted if not available. |
| `capability_details[].pixels_per_unit` | `number?` | Pixels per unit for the capability. Omitted if not available. |

### Caching and Freshness

- Data is derived from the NaaP BFF orchestrator cache, which fetches from the Livepeer on-chain registry.
- HTTP cache: `s-maxage=1800` (30 minutes), consistent with the internal `TTL.NET_MODELS` cache key.
- `revalidate = 1800` in the Next.js route segment config for ISR.
- Pipeline slugs are validated against `^[a-z][a-z0-9-]{0,63}$` to prevent injection of malformed capability strings from registry data.

### Error Handling

On internal failure, the endpoint returns `503 Service Unavailable`:

```json
{
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Orchestrator discovery data is unavailable"
  }
}
```

With `Cache-Control: public, max-age=0, s-maxage=5, stale-while-revalidate=0` to avoid stale error caching.

### Capability Slug Resolution

Capability slugs are resolved in the following priority order:

1. **`hardware[]` array** — the `pipeline` and `model_id` fields from the orchestrator's registry JSON are the preferred source. Both must be present and valid.
2. **`capabilities_prices[]` with `hardware` cross-reference** — when a price entry's `constraint` matches a `model_id` in `hardware`, the pipeline slug is inherited from that hardware entry.
3. **Livepeer protobuf enum fallback** — when no `hardware` match exists for a price entry, the `capability` integer ID is mapped to a pipeline slug via the `net.Capability` enum (e.g., capability `27` → `text-to-image`).

This layered resolution ensures the discovery response remains consistent even when orchestrators advertise capabilities in different formats.

---

## MVP Scope

### In MVP

- Hosted `pymthouse` on Vercel
- PostgreSQL on Neon
- Phase 0 PostgreSQL migration gate before feature rollout
- Existing `developerApps` promoted into provider apps
- Existing owner/admin interactive access through `pymthouse` OIDC flow
- Remote signer configuration per provider
- Free plans first
- Plan builder using NaaP data, with manual fallback entry
- Subscription creation and cancellation
- API key issuance per provider subscription
- OIDC Authorization Code + PKCE for app owners, administrative users, and supported client integrations
- App registration with `client_id`, `client_secret`, redirect URI validation, and scoped defaults
- Tenant user management API (client credentials) with app-scoped RBAC
- Programmatic user token issuance endpoint for provisioned non-owner users (Decision 2B)
- One canonical SDK API base URL: `api.pymthouse.io`
- **NaaP public discovery endpoint** (`GET /api/v1/network/discover-orchestrators`) for SDK orchestrator discovery
- Key validation with plan context
- JWT issuance with attribution claims (`app_id`, `user_id`) and JWKS publication
- Remote signer JWT validation (issuer, audience, signature, expiry, scopes)
- NaaP marketplace integration
- Usage recording with idempotent writes
- Basic data isolation with `client_id` filtering and PostgreSQL RLS
- Audit logging for auth, app registration, secrets rotation, and user management actions

### Not in MVP

- Stripe billing
- Custom domains
- Provider-facing hosted custom login or signup UX
- Teams and spend controls
- Cross-provider spend dashboards
- Feature flags per provider
- Rate limiting per provider
- Async usage write buffering
- Read replicas
- Custom referral-token auth bridge
- Multi-layer orchestrator fallback behavior
- Per-provider derived-key crypto scheme
- Provider-scoped discovery refinement (optional future enhancement where provider signers filter/re-rank NaaP candidates)

---

## Simplicity Decisions

### Decision 1: Reuse `developerApps` as providers

Each provider is a `developerApp` with additional billing configuration.

Why:

- Reuses the existing app boundary
- Keeps data model simple
- Avoids introducing a second tenant abstraction
- Preserves one shared identity across providers

### Decision 2A: Interactive OIDC for app owners and administrative users

`pymthouse` is the only OIDC issuer in this system.

For MVP:

- The existing Authorization Code + PKCE flow remains available for the developer app owner who created the app and for administrative users operating directly in `pymthouse`.
- Supported client integrations may also use the standard OIDC redirect flow where a direct `pymthouse` interactive experience is appropriate.
- This is not the default path for provider-controlled end users in MVP.
- Provider-controlled end users are expected to be provisioned through the user management API and issued tokens programmatically under Decision 2B.

Standards references:

- OAuth 2.0 framework (RFC 6749)
- PKCE (RFC 7636)
- Native-app and browser-safe guidance (RFC 8252)
- OpenID Connect Core 1.0

Why this is leaner:

- Preserves existing functionality for current `pymthouse` operators and integrations
- Avoids introducing new provider-facing hosted UX in MVP
- Keeps the interactive path standards-based and easy to audit

Trade-off:

- Interactive `pymthouse` login is no longer the general end-user story for provider-controlled applications
- Providers must provision and manage their non-owner users explicitly via API

### Decision 2B: Programmatic user token issuance (private client application path)

Private server-side applications (e.g., a game platform, analytics service, or any backend that manages its own user accounts) need to obtain valid pymthouse JWTs for their users without routing those users through a hosted `pymthouse` browser flow.

#### Proposed approach: Option A — custom user token endpoint (MVP)

A dedicated endpoint issues pymthouse access and refresh tokens on behalf of a provisioned `app_users` record.

Endpoint: `POST /api/v1/apps/{app_id}/users/{external_user_id}/token`

The private app authenticates once with its own Client Credentials access token. The response returns a short-lived JWT access token, an opaque refresh token bound to the pymthouse user identity, `expires_in`, and `token_type: Bearer`. Thereafter the private app is not in the refresh loop — the SDK client refreshes directly at `POST /api/v1/oidc/token`.

#### Normative endpoint contract

Request:

```json
{
    "scope": "sign:job discover:orchestrators"
}
```

Response:

```json
{
    "access_token": "<jwt>",
    "refresh_token": "<opaque>",
    "expires_in": 900,
    "token_type": "Bearer",
    "subject_type": "app_user"
}
```

Validation rules:

1. Caller must authenticate as a confidential client using Client Credentials for the same `client_id` as `{app_id}`.
2. `{external_user_id}` must resolve to an active `app_users` row under the same `client_id`; otherwise return 404 or a non-revealing equivalent error.
3. Requested scopes must be a subset of the client's allowed scopes and the provisioned-user policy; otherwise return `invalid_scope`.
4. `admin` scope must never be issuable through this endpoint.
5. Issued refresh tokens must be bound to `sub`, `app_id`, and the original client registration context. A refresh token issued for one provider app must not be accepted for another provider app.
6. Each successful and failed issuance attempt must create an `auth_audit_log` entry.

Error contract:

```json
{
    "error": "invalid_scope",
    "error_description": "Requested scope exceeds client whitelist",
    "correlation_id": "<uuid>"
}
```

Representative status codes:

- `400` for malformed requests
- `401` for failed confidential-client authentication
- `403` for cross-app access or forbidden scope elevation attempts
- `404` when the provisioned user cannot be resolved under the specified `client_id`
- `429` for rate limiting if enabled later without contract changes

#### Security invariants

- Private app may only request tokens for users under its own `client_id`; cross-app requests return 403.
- Auto-provisioned users always receive `role=user`; the `admin` scope is never grantable via this endpoint.
- Requested scopes should be within the client whitelist; out-of-whitelist requests return `invalid_scope` (RFC 6749 §5.2).
- All issuance events are logged to `auth_audit_log` with `correlation_id`, `client_id`, and `actor_user_id`.
- Refresh tokens are bound to pymthouse user identity, `app_id`, and the original client registration context; revocation is independent of the calling backend session.

#### Standards alignment

- OAuth 2.0 Client Credentials (RFC 6749 §4.4) for authenticating the private app.
- RFC 7519 (JWT) and RFC 7517 (JWKS) for the issued access token shape.

#### Post-MVP migration path

RFC 8693 Token Exchange is the intended upgrade path. It provides an IETF-standardised mechanism for trusted delegation that produces an identical token shape; migration requires only a new endpoint and no client changes.

#### Rejected alternative: ROPC

Resource Owner Password Credentials (ROPC) is explicitly rejected. It is deprecated in OAuth 2.1, requires passing user credentials through the client, and is incompatible with a non-custodial security posture.

#### Why this split matters

Interactive flows (Decision 2A) and programmatic token flows (Decision 2B) have meaningfully different trust models and lifecycle properties. In MVP, Decision 2A preserves the current owner/admin experience, while Decision 2B is the primary path for provider-controlled end users. Keeping them distinct makes the architecture auditable and the RFC 8693 migration path unambiguous.

### Decision 3: One canonical SDK base URL

SDK traffic should go to `api.pymthouse.io`.

Existing `pymthouse` surfaces may continue to serve owner/admin interactions and client integration entry points.

Why:

- Simplest DevX
- One set of docs and examples
- No hostname and token mismatch edge cases
- Routing is determined from the key's `client_id`

### Decision 4: NaaP provides network-wide discovery; pymthouse enforces billing boundaries; signers execute

**Updated** — Orchestrator discovery is now a NaaP responsibility, not a signer responsibility.

The previous design required each provider's remote signer to implement a `/discover-orchestrators` endpoint. This created unnecessary coupling between billing availability and provider infrastructure, and forced each signer to independently maintain orchestrator curation logic.

The revised design separates concerns:

| Responsibility | Owner | Rationale |
|---|---|---|
| Network-wide orchestrator discovery | **NaaP** | NaaP already aggregates on-chain registry data, caches it, and serves it to the dashboard. Exposing this as a public API is a minimal incremental cost. |
| Billing validation and plan enforcement | **pymthouse** | Unchanged. `pymthouse` validates API keys, resolves provider context, and enforces subscription boundaries. |
| Payment signing | **Provider signer** | Unchanged. Signers hold private keys and produce payment signatures. |
| Orchestrator curation / re-ranking | **Provider signer** (optional, post-MVP) | Providers may optionally filter or re-rank the NaaP candidate list in the future. |

Runtime flow:

1. SDK calls **NaaP** `GET /api/v1/network/discover-orchestrators?caps=<pipeline/model>` to get orchestrator candidates.
2. SDK calls **pymthouse** to validate the API key and get a payment signature.
3. SDK sends signed traffic directly to the chosen orchestrator.

Failure modes:

- If NaaP discovery is unavailable → SDK receives `503`. No orchestrators are returned. SDK should retry with backoff.
- If pymthouse is unavailable → SDK cannot validate keys or obtain signatures. Jobs fail.
- If the provider signer is unavailable → SDK cannot get payment signatures. Jobs fail.
- Discovery and signing failures are independent — a NaaP outage does not affect signing, and a signer outage does not affect discovery.

Why:

- NaaP already has the data — it fetches orchestrator capabilities from the on-chain registry for the dashboard
- Discovery becomes a network-level public good, not a per-provider implementation burden
- Provider signers become simpler — they only need to sign, not discover
- `pymthouse` stays a billing layer, not a network policy engine
- Eliminates a runtime dependency between discovery and provider infrastructure

Trade-off:

- Discovery is network-wide, not provider-scoped. A provider cannot restrict which orchestrators their users see at the discovery layer in MVP.
- Billing enforcement remains the provider-scoping mechanism — a user can discover any orchestrator, but can only pay for jobs on orchestrators the provider signer is willing to sign for.
- Post-MVP, provider-scoped discovery refinement can be layered on top.

### Decision 5: NaaP discovery is the SDK's primary orchestrator source

**Updated** — NaaP is now an online runtime dependency for orchestrator discovery.

The previous design deferred NaaP-to-signer advisory feed integration and kept NaaP out of the runtime path. The new design promotes NaaP's existing cached orchestrator data to a public API that the SDK calls directly.

For MVP:

- NaaP `GET /api/v1/network/discover-orchestrators` is the SDK's primary orchestrator discovery mechanism.
- The endpoint is public and unauthenticated — no API key or bearer token required.
- Data is cached for 30 minutes and derived from the same BFF orchestrator bundle that powers the NaaP dashboard.
- Capability filtering via `caps` query parameter uses OR semantics.
- `pymthouse` is **not** in the discovery path.

Why:

- NaaP already maintains a fresh, aggregated view of the orchestrator network
- Making it a public API is a minimal change (one Next.js route handler)
- SDKs get discovery without needing a provider signer or `pymthouse` token
- Reduces integration complexity — one fewer authenticated call in the SDK's critical path

Trade-off:

- NaaP becomes a runtime dependency for discovery (not for signing or billing)
- Discovery data is eventually consistent (up to 30 minutes stale)
- Discovery quality depends on the completeness and freshness of on-chain registry data

Long-term direction:

- Provider-scoped discovery refinement: allow signers to filter/re-rank NaaP candidates based on provider policy
- Real-time discovery feeds via WebSocket or SSE for latency-sensitive use cases
- Restore robust network-wide Service Registry usage so gateways/signers can operate with minimal custom abstractions

### Decision 6: Usage writes are synchronous and idempotent

Usage records should be written directly to PostgreSQL in the request flow, with an idempotency key such as `(client_id, requestId)`.

Why:

- Prevents double-billing and billing gaps
- Easier to reason about than async queues and replay logic
- Better aligned with a billing product

Trade-off:

- Runtime depends on the primary database for recording usage
- If usage cannot be persisted safely, the request should fail rather than create accounting ambiguity

### Decision 7: Minimal security hardening for MVP

For MVP, keep the big security win and defer the fancy one.

Keep now:

- Provider private keys stay on provider-hosted signers
- Signer API keys stored encrypted at rest with one application encryption key
- `client_id` filtering on all provider-scoped queries
- PostgreSQL RLS on critical billing tables
- OIDC token signing keys published via JWKS with planned rotation runbook
- strict issuer/audience validation in signer and internal services
- Pipeline slug validation (`^[a-z][a-z0-9-]{0,63}$`) on discovery response data to prevent injection

Defer:

- Per-provider derived-key encryption
- advanced compliance packaging
- audit-heavy enterprise controls

### Decision 8: Small-provider-first operating model

Assume a small number of early providers and optimize for clarity.

That means MVP can rely on:

- preview deployments
- careful migrations
- basic health checks
- manual operator response for incidents

It does not need a fully built resilience platform on day one.

---

## MVP User Stories

### Platform Admin

**PL-1: Deploy the shared platform**
As a platform admin, I can deploy `pymthouse` on Vercel with Neon PostgreSQL.

Acceptance:

- `pymthouse.io` and `api.pymthouse.io` are live
- PostgreSQL schema is migrated
- health endpoint is green

**PL-2: Expose a canonical API surface**
As the platform, I can expose one canonical runtime and identity API surface for all providers.

Acceptance:

- runtime and identity endpoints are served from `api.pymthouse.io`
- no provider-branded hosted web entrypoint is required for MVP
- app routing remains derived from `client_id` and server-side configuration

**PL-3: Isolate provider data**
As the platform, I can ensure provider data is scoped by `client_id`.

Acceptance:

- app-scoped queries are enforced in code
- critical tables also have RLS
- multi-provider test fixtures prove isolation

### NaaP Network Intelligence

**ND-1: Serve public orchestrator discovery**
As the NaaP platform, I expose a public HTTP endpoint that returns the current set of orchestrators with their capabilities, pricing, and freshness data.

Acceptance:

- `GET /api/v1/network/discover-orchestrators` returns a JSON array of `OrchestratorDiscoveryEntry` objects
- Response is served with `s-maxage=1800` cache headers
- Data is derived from the NaaP BFF orchestrator cache (same data source as the dashboard)
- Pipeline slugs are validated against `^[a-z][a-z0-9-]{0,63}$`
- On failure, returns `503` with short-lived cache headers

**ND-2: Support capability filtering**
As an SDK consumer, I can filter discovery results by capability using the `caps` query parameter.

Acceptance:

- `?caps=text-to-image/stabilityai/sd-turbo` returns only orchestrators with that capability
- Multiple `caps` values use OR semantics
- Empty `caps` returns all orchestrators
- `caps` values are trimmed and deduplicated

### Provider Admin

**PA-1: Create a provider app**
As a provider admin, I can sign up and create a provider app that I manage from existing `pymthouse` admin surfaces.

Acceptance:

- `developer_apps` row created
- `provider_admins` row created
- owner can access app configuration, signer settings, and plan management from the existing admin experience

**PA-2: Connect a remote signer**
As a provider admin, I can register and verify a provider-hosted remote signer that serves signing requests through the `pymthouse` authentication proxy.

Acceptance:

- signer base URL and signer authentication configuration are stored per `client_id`
- health checks verify the signer can serve signing requests successfully
- signer is no longer required to implement a `/discover-orchestrators` endpoint

---

## Key Design Decisions Summary

| # | Decision | Rationale | Trade-off |
|---|---|---|---|
| 1 | Reuse `developerApps` as providers | Simple, reuses existing boundary | — |
| 2A | Interactive OIDC for owners/admins | Standards-based, no new UX | Not for end users |
| 2B | Programmatic token issuance | Covers provider-controlled users | Custom endpoint (RFC 8693 migration later) |
| 3 | One SDK base URL | Simple DevX | — |
| 4 | **NaaP provides discovery; pymthouse enforces billing; signers sign** | Separation of concerns; NaaP already has the data | Discovery is network-wide, not provider-scoped in MVP |
| 5 | **NaaP discovery is SDK's primary source** | Public, unauthenticated, cached; minimal integration cost | NaaP is a runtime dependency for discovery; data up to 30 min stale |
| 6 | Synchronous idempotent usage writes | Billing correctness | DB in write path |
| 7 | Minimal security hardening | Big wins now, defer the rest | No per-provider key derivation |
| 8 | Small-provider-first | Clarity over resilience | Manual ops |

---

## Implementation Tasks

### Phase 1: NaaP Discovery Endpoint (In Progress — PR #266)

- [x] Implement `GET /api/v1/network/discover-orchestrators` route handler
- [x] Add `OrchestratorDiscoveryEntry` type with address, capabilities, pricing, and freshness
- [x] Implement capability slug resolution from `hardware[]`, `capabilities_prices[]`, and protobuf enum fallback
- [x] Add pipeline slug validation (`^[a-z][a-z0-9-]{0,63}$`)
- [x] Add `caps` query parameter with OR-semantics filtering
- [x] Configure HTTP caching (`s-maxage=1800`, `revalidate=1800`)
- [x] Implement `503` error response with short-lived cache headers
- [x] Aggregate discovery data from the existing `NetOrchestratorBundle` cache

### Phase 2: SDK Integration

- [ ] Update SDK to call NaaP `/api/v1/network/discover-orchestrators` for orchestrator discovery
- [ ] Remove SDK dependency on provider signer `/discover-orchestrators` endpoint
- [ ] Add `caps` parameter support in SDK discovery call
- [ ] Implement retry with exponential backoff on `503` responses
- [ ] Add SDK configuration for NaaP discovery base URL (default: NaaP production)

### Phase 3: pymthouse Billing Integration

- [ ] Ensure `pymthouse` key validation does not require discovery — billing and discovery are independent paths
- [ ] Update provider signer onboarding to remove `/discover-orchestrators` health check requirement
- [ ] Update pymthouse documentation to reflect the NaaP discovery flow

### Phase 4: Documentation and Developer Experience

- [ ] Update SDK quickstart guide with NaaP discovery flow
- [ ] Update `plugin-developer-guide.md` with orchestrator discovery architecture
- [ ] Add example: SDK discovers orchestrators → validates key → signs → sends traffic
- [ ] Update API reference with NaaP discovery endpoint specification

### Phase 5: Post-MVP Enhancements (Deferred)

- [ ] Provider-scoped discovery refinement: allow signers to filter/re-rank NaaP candidates
- [ ] Real-time discovery via WebSocket/SSE for latency-sensitive workloads
- [ ] Discovery endpoint rate limiting
- [ ] Analytics on discovery usage patterns per provider
