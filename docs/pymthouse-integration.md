# PymtHouse integration (NaaP)

Official Builder API contract: [PymtHouse `docs/builder-api.md`](https://github.com/eliteprox/pymthouse/blob/main/docs/builder-api.md).

Server-to-server calls use the published SDK [`@pymthouse/builder-api`](https://github.com/eliteprox/pymthouse-builder-api) (wrapped in [apps/web-next/src/lib/pymthouse-client.ts](apps/web-next/src/lib/pymthouse-client.ts) with `import "server-only"` so M2M secrets never ship to the browser).

## Plan-builder JSON (PymtHouse → NaaP)

Stable responses use `schemaVersion: "1.0"`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/pymthouse/capabilities/catalog` | Pipeline catalog + network models (`?limit=` optional) |
| GET | `/api/v1/pymthouse/sla/summary` | KPI, GPU capacity, perf-by-model (`timeframe`, `perfDays`) |
| GET | `/api/v1/pymthouse/network/price` | Pipeline pricing (`experimental: true`) |

Set `NAAP_PLAN_BUILDER_API_BASE` on PymtHouse if the default same-origin base is wrong.

## Marketplace and subscribe

NaaP does not mirror the billing marketplace. Use `PYMTHOUSE_MARKETPLACE_URL`, or `PMTHOUSE_BASE_URL` (appends `/marketplace`), or `PYMTHOUSE_ISSUER_URL` (marketplace path defaults to `/marketplace` on the non-`api.` host).

## Billing provider — user access tokens (Builder API)

NaaP uses `@pymthouse/builder-api` (`PmtHouseClient`) to upsert app users and mint **short-lived user-scoped JWTs** (`scope: sign:job`, TTL ~15 min) — no browser popup, no redirect URI, no machine-token step.

```
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
- Short-lived Builder-minted user JWTs are **not** surfaced as NaaP developer API keys; NaaP exchanges them server-side for opaque **`pmth_…`** signer sessions (~90 days).

### NaaP endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/auth/providers/pymthouse/start` | First-time link from the **Create API Key** UI. Returns `{ access_token, token_type, expires_in, scope, login_session_id, auth_url: null, poll_after_ms: 0 }` where `access_token` is an opaque **`pmth_…`** signer session (~90 days). |
| `POST` | `/api/v1/billing/pymthouse/token` | Mint-on-demand signer session. Returns `{ access_token, token_type, expires_in, scope }` where `access_token` is an opaque **`pmth_…`** token (~90 days). Auth: NaaP session + CSRF. Rate limited per user. Internally mints a short-lived JWT then RFC 8693 token-exchanges with the M2M client. |
| `GET` | `/api/v1/billing/pymthouse/usage` | Session BFF over PymtHouse **Usage API** (see below). Auth: NaaP session cookie / bearer. `Cache-Control: no-store`. |

### Usage API (BFF)

Official contract: [PymtHouse Usage API](https://docs.pymthouse.com/integration/usage-api).

PymtHouse usage is **tenant-wide** (M2M). A NaaP session alone must not expose raw `byUser` or arbitrary `userId` filters to every user. NaaP proxies usage through **`GET /api/v1/billing/pymthouse/usage`** with explicit scopes:

| Query | Behavior |
|-------|-----------|
| `scope=me` (default) | Server calls upstream with `groupBy=user`, then returns only the row where `externalUserId` matches the logged-in NaaP user id (`session.user.id`). Response shape: `{ clientId, period, currentUser: { externalUserId, requestCount, feeWei } }`. App totals and other users are omitted. |
| `scope=app` | **Requires** role `system:admin`. Passes through `groupBy` (`none` \| `user`) and internal PymtHouse `userId` (end user id) to the SDK and returns the **raw** `UsageApiResponse` from upstream. |

**Dates:** Optional `startDate` and `endDate` (ISO strings, validated with `Date.parse`). Both must be set together, or both omitted. If omitted, the BFF uses the **current calendar month in UTC** (same default as the Developer plugin Usage tab).

**Wei:** `totalFeeWei` / `feeWei` are decimal integer strings; format with `BigInt` in app code — never `Number()` on raw wei. The Developer plugin uses `formatFeeWeiStringToEthDisplay` from `@naap/utils`.

**Identifiers:** Upstream `userId` is the internal PymtHouse **end user** id. NaaP’s `scope=me` path matches on **`externalUserId`** (NaaP user id mirrored on PymtHouse), which is why non-admins never receive the full `byUser` array.

**Env gate:** If PymtHouse M2M env is incomplete, the route returns `400` with `PYMTHOUSE_NOT_CONFIGURED_MESSAGE` from [`pymthouse-env.ts`](../apps/web-next/src/lib/pymthouse-env.ts) (SDK-free, safe to import outside `server-only` routes).

**Implementation:** [`apps/web-next/src/app/api/v1/billing/pymthouse/usage/route.ts`](../apps/web-next/src/app/api/v1/billing/pymthouse/usage/route.ts) uses `getPmtHouseServerClient()` from [`pymthouse-client.ts`](../apps/web-next/src/lib/pymthouse-client.ts) only (never `@pymthouse/builder-api/env` in middleware).

### Required env vars (NaaP)

These match [`createPmtHouseClientFromEnv`](https://github.com/eliteprox/pymthouse-builder-api/blob/main/src/env.ts) (`@pymthouse/builder-api/env`).

| Variable | Purpose |
|----------|---------|
| `PYMTHOUSE_ISSUER_URL` | OIDC issuer base, e.g. `https://example.com/api/v1/oidc` |
| `PYMTHOUSE_PUBLIC_CLIENT_ID` | **Public** app **`client_id`** (`app_…`) — device flow + Builder URL paths. **Required.** |
| `PYMTHOUSE_M2M_CLIENT_ID` | **Confidential** backend client (`m2m_…`) for Builder API and token-endpoint flows used by the SDK. **Required.** |
| `PYMTHOUSE_M2M_CLIENT_SECRET` | Secret for the M2M client. **Required.** |
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
- Provider start and billing token routes return an opaque **`pmth_…`** signer session (`expires_in` ≈ 90 days); the short-lived subject JWT is used only server-side during exchange.

## Device login (RFC 8628) — Option B (NaaP-side approval)

When PymtHouse redirects the browser to NaaP with `iss` + `target_link_uri` (third-party initiated login), NaaP stores a short-lived cookie, completes sign-in, then the server runs **`PmtHouseClient`**: mint user JWT via Builder, then **`completeDeviceApproval`** (RFC 8693 token exchange at `{issuer}/token` via oauth4webapi).

NaaP treats success from `completeDeviceApproval` as authorized and clears the cookie; the CLI keeps polling PymtHouse **`POST .../token`** with the `device_code` as usual until it receives tokens.

Requires: **`PYMTHOUSE_ISSUER_URL`** (must match the `iss` query param, e.g. `http://localhost:3001/api/v1/oidc`), **`PYMTHOUSE_PUBLIC_CLIENT_ID`**, **`PYMTHOUSE_M2M_CLIENT_ID`**, **`PYMTHOUSE_M2M_CLIENT_SECRET`**, and PymtHouse app settings with device third-party login + initiate URI pointing at NaaP. Device initiate validation uses the **issuer URL’s origin** for `target_link_uri` (so **`PMTHOUSE_BASE_URL`** is not required for that check; avoid pointing `PMTHOUSE_BASE_URL` at NaaP if you also rely on it for PymtHouse site URLs elsewhere).

## Database

`BillingProviderOAuthSession` is still created for audit purposes on each link but the opaque API key itself is never stored in this row: `accessToken` is always `null` for PymtHouse, `redeemedAt` is set immediately, and the row `expiresAt` follows the returned signer session TTL (~90 days). `pkceCodeVerifier` is always `null` for PymtHouse (no browser OAuth). Run `npx prisma db push` or migrate from `packages/database` after pulling schema changes.
