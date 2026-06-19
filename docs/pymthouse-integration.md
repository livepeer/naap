# PymtHouse integration (NaaP)

Official Builder API contract: [PymtHouse `docs/builder-api.md`](https://github.com/pymthouse/pymthouse/blob/main/docs/builder-api.md).

Server-to-server calls use the published npm package [`@pymthouse/builder-sdk`](https://www.npmjs.com/package/@pymthouse/builder-sdk) (source: [pymthouse/builder-sdk](https://github.com/pymthouse/builder-sdk)), wrapped in [apps/web-next/src/lib/pymthouse-client.ts](apps/web-next/src/lib/pymthouse-client.ts) with `import "server-only"` so M2M secrets never ship to the browser.

**Dependency pin:** NaaP pins `@pymthouse/builder-sdk` at **exact `0.4.3`** from the npm registry in [apps/web-next/package.json](../apps/web-next/package.json) (and matching pins in the developer-api plugin packages). Review [builder-sdk releases](https://github.com/pymthouse/builder-sdk/releases) before bumping, run `npm install` at the repo root, and re-verify billing/OIDC routes after any upgrade.

## Plan-builder data (PymtHouse → NaaP)

PymtHouse and other external plan-builder consumers should call the **existing dashboard BFF routes** on the NaaP deployment (same cache headers and facade-backed payloads as the NaaP UI). There are no provider-specific `/api/v1/pymthouse/*` intelligence routes.

| Data need | Method | Path | Notes |
|-----------|--------|------|--------|
| Pipeline catalog | GET | `/api/v1/dashboard/pipeline-catalog` | Facade pipeline catalog |
| Network models | GET | `/api/v1/developer/network-models` | `?limit=` (default 50, max 200) or `?limit=all` |
| KPI | GET | `/api/v1/dashboard/kpi` | `?timeframe=` hours (facade-normalized) |
| GPU capacity | GET | `/api/v1/dashboard/gpu-capacity` | `?timeframe=` (same key family as KPI) |
| Perf by model | GET | `/api/v1/network/perf-by-model` | **`start` and `end` required** (ISO-8601 timestamps) |
| Pipeline pricing | GET | `/api/v1/dashboard/pricing` | Unit cost / pricing table |

**SLA-style bundle:** the former `/api/v1/pymthouse/sla/summary` aggregate is not a single route. Call KPI, GPU capacity, and perf-by-model in parallel (compute `start`/`end` from your desired `perfDays` window, e.g. last N days in UTC).

Point PymtHouse at the NaaP public origin (e.g. `https://naap.example.com`) plus the paths above. Do not use a separate `NAAP_PLAN_BUILDER_API_BASE` env on NaaP.

## Marketplace and subscribe

NaaP does not mirror the billing marketplace. Use `PYMTHOUSE_MARKETPLACE_URL`, or `PMTHOUSE_BASE_URL` (appends `/marketplace`), or `PYMTHOUSE_ISSUER_URL` (marketplace path defaults to `/marketplace` on the non-`api.` host).

## Billing provider — user access tokens (Builder API)

NaaP uses `@pymthouse/builder-sdk` (`PmtHouseClient`) to upsert app users and mint **short-lived user-scoped JWTs** (`scope: sign:job`, TTL ~15 min) — no browser popup, no redirect URI, no machine-token step.

```text
NaaP server                                              PymtHouse
    │                                                         │
    ├─ POST /api/v1/apps/{clientId}/users ─────────────────────►│  M2M client (SDK: Basic auth on Builder routes)
    │    { externalUserId, email?, status: "active" }          │  upsert end user (NaaP user id)
    │◄─ 200 ───────────────────────────────────────────────────┤
    │                                                         │
    ├─ POST .../users/{externalUserId}/token ──────────────────►│  same M2M credentials
    │    { "scope": "sign:job" }                                │  issue user-scoped JWT
    │◄─ { access_token, refresh_token, expires_in, scope } ─────┤
    │                                                         │
    ├─ Returned to browser / caller — never persisted in NaaP ─
```

- **URL paths** use the **public** app id (`app_…`) — device login and `/api/v1/apps/{clientId}/...` Builder routes.
- **Confidential M2M** (`m2m_…`) credentials are **`PYMTHOUSE_M2M_CLIENT_ID`** + **`PYMTHOUSE_M2M_CLIENT_SECRET`**. A single OIDC client cannot be both public (device flow) and confidential; PymtHouse provisions two clients per developer app when you enable **Backend device helper** in Auth & Scopes.
- **End-user scope** is only **`sign:job`** on the token request.
- The M2M client must allow **`users:read`**, **`users:write`**, **`users:token`**, and **`sign:job`** in its allowed scopes (defaults for the backend helper).
- Short-lived Builder-minted user JWTs are **not** surfaced as NaaP developer API keys for the Create API Key flow. That flow mints long-lived **`pmth_*`** API keys via the Builder Apps **`…/users/{externalUserId}/keys`** route (Dashboard parity). Opaque signer sessions (~90 days) remain available via **`POST /api/v1/billing/pymthouse/token`** only.

### NaaP endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/auth/providers/pymthouse/start` | First-time link from the **Create API Key** UI. Returns `{ access_token, token_type, expires_in, scope, login_session_id, auth_url: null, poll_after_ms: 0 }` where `access_token` is a long-lived **`pmth_*`** API key (Builder Apps user key). |
| `POST` | `/api/v1/billing/pymthouse/token` | Mint-on-demand opaque signer session. Returns `{ access_token, token_type, expires_in, scope }` where `access_token` is an opaque **`pmth_…`** signer session (~90 days). Auth: NaaP session + CSRF. Rate limited per user. Internally mints a short-lived JWT then RFC 8693 token-exchanges with the M2M client. |
| `GET` | `/api/v1/billing/pymthouse/usage` | Session BFF over PymtHouse **Usage API** (see below). Auth: NaaP session cookie / bearer. `Cache-Control: no-store`. |
| `GET` | `/api/v1/billing/pymthouse/config` | Public integration settings for the Developer API UI (`signerUrl` from `PYMTHOUSE_SIGNER_URL`). Auth: NaaP session cookie / bearer. |
| `POST` | `/api/pymthouse/keys/exchange` | Public exchange: PymtHouse **`pmth_*`** API key → short-lived signer JWT. No NaaP session. Uses `@pymthouse/builder-sdk/signer/server` `createApiKeyExchangeHandler`. Same contract as Dashboard. |
| `POST` | `/api/signer/device/exchange` | Public exchange: device token → signer session. No NaaP session. Uses `createDeviceExchangeHandler`. Complements the browser device-approve step below. |

### Developer API manager SDK token

The Developer API manager's **Create API Key** flow returns the normal billing API key and, for providers that support python-gateway discovery (`pymthouse` and `daydream`), also creates an optional SDK token for `python-gateway --token`.

That SDK token is **base64-encoded JSON**, not a JWT. It bundles signer and discovery credentials:

```json
{
  "signer": "https://pymthouse-preview.up.railway.app",
  "discovery": "https://naap.example.com/api/v1/orchestrator-leaderboard/plans/{planId}/python-gateway",
  "signer_headers": {
    "Authorization": "Bearer pmth_..."
  },
  "discovery_headers": {
    "Authorization": "Bearer gw_..."
  }
}
```

- `signer_headers.Authorization` carries the long-lived **`pmth_*`** API key (same value as the billing key in the success dialog). **livepeer-python-gateway** detects `pmth_*` in `signer_headers`, infers the NaaP billing origin from the `discovery` URL host, and exchanges via **`POST /api/pymthouse/keys/exchange`** before calling the signer DMZ (same outcome as `--billing-url` + `--api-key`).
- `discovery_headers.Authorization` uses a separate NaaP service-gateway key (`gw_…`) minted during the same dialog via `/api/v1/gw/admin/keys`.
- The `signer` field comes from **`PYMTHOUSE_SIGNER_URL`** when set (via `GET /api/v1/billing/pymthouse/config`), otherwise `{issuerOrigin}/api/signer`. Exchange may override the effective signer URL with the value returned from the exchange response.
- If the user selects a saved discovery plan, the token points at `/api/v1/orchestrator-leaderboard/plans/{planId}/python-gateway`; otherwise it points at `/api/v1/orchestrator-leaderboard/python-gateway` for default model-based discovery (append `?billingProvider=pymthouse` for PymtHouse default discovery).
- If NaaP cannot mint the `gw_…` key, the UI still shows the billing API key and explains that the user must create a gateway key manually and populate `discovery_headers`.

**Daydream** uses the same token shape with `signer: https://signer.daydream.live` and a Daydream bearer in `signer_headers` (passed through without exchange).

### Network Price discovery allowlist (PymtHouse → NaaP)

For billing provider **`pymthouse`**, NaaP periodically syncs the Builder manifest:

- **Fetch:** `GET {PYMTHOUSE_ISSUER_URL without /oidc}/apps/{publicClientId}/manifest` using the same **M2M Basic** credentials as other Builder routes (see `createPmtHouseClientFromEnv` in `@pymthouse/builder-sdk`).
- **Allow/deny:** `excludedCapabilities` is authoritative — NaaP denies explicitly excluded pipeline/model rules and allows every other NaaP catalog capability.
- **Informational only:** the JSON `capabilities` array is a PymtHouse-local resolved set, not a complete NaaP allowlist (PymtHouse may know fewer capabilities than NaaP).
- **Cache busting:** `manifestVersion` invalidates the synced snapshot when present.
- **Default deny:** a missing manifest blocks discovery. Set **`PYMTHOUSE_ALLOW_MISSING_MANIFEST_FAIL_OPEN=1`** only in controlled environments to restore legacy fail-open behavior (emits a high-severity audit log).

NaaP applies the synced denylist snapshot (`syncPymthouseManifestSnapshot` in `apps/web-next/src/lib/pymthouse-manifest.ts`) to python-gateway discovery and orchestrator-leaderboard evaluation. Minimal app metadata is available via **`GET …/apps/{publicClientId}`** (M2M). Legacy per-plan policy rows for the UI still come from **`GET …/apps/{id}/plans`**.

### Usage API (BFF)

Official contract: [PymtHouse Usage API](https://docs.pymthouse.com/integration/usage-api).

PymtHouse usage is **tenant-wide** (M2M). A NaaP session alone must not expose raw `byUser` or arbitrary `userId` filters to every user. NaaP proxies usage through **`GET /api/v1/billing/pymthouse/usage`** with explicit scopes:

| Query | Behavior |
|-------|-----------|
| `scope=me` (default) | Delegates to `@pymthouse/builder-sdk` **`fetchUsageForExternalUser`** with `includeRetail: true` and the logged-in NaaP user id (`session.user.id`). Returns the SDK-shaped response for that external user (period, request counts, pipeline/model breakdown). App-wide totals and raw `byUser` / `byPipelineModel` arrays are omitted. |
| `scope=app` | **Requires** role `system:admin`. Passes through `groupBy` (`none` \| `user`) and internal PymtHouse `userId` (end user id) to the SDK and returns the **raw** `UsageApiResponse` from upstream. |

**Dates:** Optional `startDate` and `endDate` (ISO strings, validated with `Date.parse`). Both must be set together, or both omitted. If omitted, the BFF uses the **current calendar month in UTC** (same default as the Developer plugin Usage tab).

**Wei:** `totalFeeWei` / `feeWei` are decimal integer strings; format with `BigInt` in app code — never `Number()` on raw wei. The Developer plugin uses `formatFeeWeiStringToEthDisplay` from `@naap/utils`.

**Identifiers:** Upstream `userId` filters `usage_records.user_id`, which may contain legacy app-user ids, end-user ids, or the external id. NaaP’s `scope=me` path passes **`session.user.id`** as `externalUserId` to the SDK; upstream resolution of legacy vs end-user ids is handled inside `@pymthouse/builder-sdk`.

**Env gate:** If PymtHouse M2M env is incomplete, the route returns `400` with `PYMTHOUSE_NOT_CONFIGURED_MESSAGE` from `@pymthouse/builder-sdk/config` (Edge/middleware-safe).

**Implementation:** [`apps/web-next/src/app/api/v1/billing/pymthouse/usage/route.ts`](../apps/web-next/src/app/api/v1/billing/pymthouse/usage/route.ts) uses `getPmtHouseServerClient()` from [`pymthouse-client.ts`](../apps/web-next/src/lib/pymthouse-client.ts) only (never `@pymthouse/builder-sdk/env` in middleware).

### Required env vars (NaaP)

These match [`createPmtHouseClientFromEnv`](https://github.com/pymthouse/builder-sdk/blob/main/src/env.ts) (`@pymthouse/builder-sdk/env`).

| Variable | Purpose |
|----------|---------|
| `PYMTHOUSE_ISSUER_URL` | OIDC issuer base, e.g. `https://example.com/api/v1/oidc` |
| `PYMTHOUSE_PUBLIC_CLIENT_ID` | **Public** app **`client_id`** (`app_…`) — device flow + Builder URL paths. **Required.** |
| `PYMTHOUSE_M2M_CLIENT_ID` | **Confidential** backend client (`m2m_…`) for Builder API and token-endpoint flows used by the SDK. **Required.** |
| `PYMTHOUSE_M2M_CLIENT_SECRET` | Secret for the M2M client. **Required.** |
| `PYMTHOUSE_SIGNER_URL` | Optional; upstream signer facade URL (e.g. `http://localhost:3001/api/signer`). Returned in exchange route responses; defaults to `{issuerOrigin}/api/signer`. |
| `PYMTHOUSE_ALLOW_INSECURE_HTTP` | Set to `1` for local dev when issuer uses `http://` (exchange handlers; complements SDK auto-detect in `createPmtHouseClientFromEnv`). |
| `PMTHOUSE_BASE_URL` | Optional; site origin for marketplace link (`{base}/marketplace`) when `PYMTHOUSE_MARKETPLACE_URL` is unset. Used by middleware/device-initiate helpers where a separate site origin from the issuer is needed. |

`BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN` is **not needed** for PymtHouse (no redirect URI).

### PymtHouse setup (operators)

1. In the app’s **Auth & Scopes** UI, enable **Backend device helper** and save — PymtHouse provisions an **`m2m_…`** client (or use a standalone **Client Credentials** app for M2M-only integrations).
2. Copy the **public** **`app_…`** id into **`PYMTHOUSE_PUBLIC_CLIENT_ID`** (device flow + Builder paths).
3. Copy the **M2M** **`m2m_…`** id and its secret into **`PYMTHOUSE_M2M_CLIENT_ID`** / **`PYMTHOUSE_M2M_CLIENT_SECRET`**.
4. Ensure **`PYMTHOUSE_ISSUER_URL`** points at the OIDC issuer (`.../api/v1/oidc`).
5. Restart NaaP.

Legacy **`naap/link-user`**, **`naap-service`** seed-only flows, and **`gateway`**-only machine scopes are **not** used for this integration.

### Verification checklist

- `PYMTHOUSE_ISSUER_URL` ends with `/api/v1/oidc`.
- `PYMTHOUSE_PUBLIC_CLIENT_ID` is the public **`app_...`** id; `PYMTHOUSE_M2M_CLIENT_ID` is the confidential **`m2m_...`** id.
- `PYMTHOUSE_M2M_CLIENT_SECRET` matches the M2M client’s secret.
- NaaP logs show `[billing-auth:pymthouse] Linked user …` (no browser popup).
- **Create API Key** (`/api/v1/auth/providers/pymthouse/start`) returns a long-lived **`pmth_*`** user API key (exchangeable via `/api/pymthouse/keys/exchange`).
- **`POST /api/v1/billing/pymthouse/token`** still returns an opaque signer session (~90 days) for session/BFF use; implementation uses [`pymthouse-client.ts`](../apps/web-next/src/lib/pymthouse-client.ts) `mintSignerSessionForExternalUser` (omits token-exchange `resource` so PymtHouse selects gateway opaque-session exchange).
- python-gateway `--token` with `signer_headers` carrying **`pmth_*`** logs `API-key signer exchange at {discovery-origin}` and receives a signer JWT + `signerUrl` from the exchange response.

## Device login (RFC 8628) — Option B (NaaP-side approval)

When PymtHouse redirects the browser to NaaP with `iss` + `target_link_uri` (third-party initiated login), NaaP stores a short-lived cookie, completes sign-in, then the server runs **`PmtHouseClient.approveDeviceLogin`** (upsert user, mint JWT, complete device approval via RFC 8693 token exchange).

NaaP treats success from `approveDeviceLogin` as authorized and clears the cookie; the CLI keeps polling PymtHouse **`POST .../token`** with the `device_code` as usual until it receives tokens. Clients may then call **`POST /api/signer/device/exchange`** with the device token to obtain a signer session.

Requires: **`PYMTHOUSE_ISSUER_URL`** (must match the `iss` query param, e.g. `http://localhost:3001/api/v1/oidc`), **`PYMTHOUSE_PUBLIC_CLIENT_ID`**, **`PYMTHOUSE_M2M_CLIENT_ID`**, **`PYMTHOUSE_M2M_CLIENT_SECRET`**, and PymtHouse app settings with device third-party login + initiate URI pointing at NaaP. Device initiate validation uses the **issuer URL’s origin** for `target_link_uri` (so **`PMTHOUSE_BASE_URL`** is not required for that check; avoid pointing `PMTHOUSE_BASE_URL` at NaaP if you also rely on it for PymtHouse site URLs elsewhere).

## Database

`BillingProviderOAuthSession` is still created for audit purposes on each link but the raw API key itself is never stored in this row: `accessToken` is always `null` for PymtHouse, `redeemedAt` is set immediately. PymtHouse does not use browser OAuth redirect on this path (no PKCE verifier column).

## Troubleshooting

### M2M authentication fails

- Verify **`PYMTHOUSE_M2M_CLIENT_ID`**, **`PYMTHOUSE_M2M_CLIENT_SECRET`**, and **`PYMTHOUSE_ISSUER_URL`** (must end with `/api/v1/oidc`).
- Confirm the M2M client is enabled in PymtHouse **Auth & Scopes** and matches `createPmtHouseClientFromEnv` expectations.
- Check NaaP logs for `[billing-auth:pymthouse]` or Builder API 401/403 responses on provider start / usage routes.

### Device approval returns 400

- Confirm **`PYMTHOUSE_PUBLIC_CLIENT_ID`** matches the `client_id` in the device `target_link_uri`.
- Ensure **`PYMTHOUSE_ISSUER_URL`** origin matches PymtHouse’s `iss` query param; **`PMTHOUSE_BASE_URL`** should point at the PymtHouse site (not NaaP) when used for marketplace links.
- Walk the RFC 8628 flow: device initiate → NaaP login → `/oidc/device-approved` → `POST /api/v1/auth/pymthouse-device-approve`.
- Inspect middleware logs for `pymthouse_device_invalid` / `server_not_configured` (cookie signing requires **`PYMTHOUSE_DEVICE_COOKIE_SECRET`** or **`NEXTAUTH_SECRET`**).

### Usage API returns “not configured”

- Ensure all required M2M env vars are set; incomplete config returns **`PYMTHOUSE_NOT_CONFIGURED_MESSAGE`** from `GET /api/v1/billing/pymthouse/usage`.
- For `scope=app`, the caller needs **`system:admin`**; otherwise use `scope=me`.

### Manifest / allowlist issues

- Trigger or inspect **`syncPymthouseManifestSnapshot`** (`apps/web-next/src/lib/pymthouse-manifest.ts`).
- Compare upstream **`GET …/apps/{publicClientId}/manifest`** with NaaP’s cached snapshot; bump **`manifestVersion`** on the PymtHouse side to force refresh.
- Remember: only **`excludedCapabilities`** restricts discovery — do not treat manifest `capabilities` as the full NaaP catalog.
