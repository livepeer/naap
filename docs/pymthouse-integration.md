# PymtHouse integration (NaaP)

Official Builder API contract: [PymtHouse `docs/builder-api.md`](https://github.com/eliteprox/pymthouse/blob/main/docs/builder-api.md).

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

NaaP uses PymtHouse's Builder API over **Basic auth** (confidential OAuth
client) to mint **short-lived user-scoped JWTs** (`scope: sign:job`,
TTL ~15 min) — no browser popup, no redirect URI, no machine-token step.

```
NaaP server                                              PymtHouse
    │                                                         │
    ├─ POST /api/v1/apps/{clientId}/users ─────────────────────►│  Basic base64(clientId:clientSecret)
    │    { externalUserId, email?, status: "active" }          │  upsert end user (NaaP user id)
    │◄─ 200 ───────────────────────────────────────────────────┤
    │                                                         │
    ├─ POST .../users/{externalUserId}/token ──────────────────►│  Basic base64(clientId:clientSecret)
    │    { "scope": "sign:job" }                                │  issue user-scoped JWT
    │◄─ { access_token, refresh_token, expires_in, scope } ─────┤
    │                                                         │
    ├─ Returned to browser / caller ─ never persisted in NaaP ─
```

- **URL paths** use the **public** app id (`app_…`) — the same id the SDK uses for device login and `/api/v1/apps/{clientId}/...` Builder routes.
- **Basic auth** uses the **confidential M2M** sibling (`m2m_…`) via **`PMTHOUSE_M2M_CLIENT_ID`** + **`PMTHOUSE_M2M_CLIENT_SECRET`**. A single OIDC client cannot be both public (device flow) and confidential; PymtHouse provisions two clients per developer app when you enable **Backend device helper** in Auth & Scopes.
- **End-user scope** is only **`sign:job`** on the token request.
- The M2M client must allow **`users:read`**, **`users:write`**, **`users:token`**, and **`sign:job`** in its allowed scopes (defaults for the backend helper).
- Tokens are **not** persisted by NaaP — callers re-mint on demand.

### NaaP endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/auth/providers/pymthouse/start` | First-time link from the **Create API Key** UI. Returns `{ access_token, token_type, expires_in, scope, login_session_id, auth_url: null, poll_after_ms: 0 }`. |
| `POST` | `/api/v1/billing/pymthouse/token` | Mint-on-demand refresh. Returns `{ access_token, token_type, expires_in, scope }`. Auth: NaaP session + CSRF. Rate limited per user. Use this from any webpage that needs a fresh PymtHouse JWT for the logged-in user. |

### Required env vars (NaaP)

| Variable | Purpose |
|----------|---------|
| `PYMTHOUSE_ISSUER_URL` | OIDC issuer base, e.g. `https://example.com/api/v1/oidc` |
| `PMTHOUSE_CLIENT_ID` | **Public** app **`client_id`** (`app_…`) — SDK / device flow / Builder URL paths. **Required.** |
| `PMTHOUSE_M2M_CLIENT_ID` | **Confidential** backend client (`m2m_…`) for Builder Basic auth and RFC 8693 device approval at `{issuer}/token`. **Required.** |
| `PMTHOUSE_M2M_CLIENT_SECRET` | Secret for the M2M client. Falls back to **`PMTHOUSE_CLIENT_SECRET`** or **`NAAP_WEB_CLIENT_SECRET`** for migration. |
| `PMTHOUSE_BASE_URL` | Optional; site origin for marketplace link (`{base}/marketplace`) when `PYMTHOUSE_MARKETPLACE_URL` is unset. Also used to derive the PymtHouse API base URL if set. |

`BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN` is **not needed** for PymtHouse (no redirect URI).

### PymtHouse setup (operators)

1. In the app’s **Auth & Scopes** UI, enable **Backend device helper** and save — PymtHouse provisions an **`m2m_…`** client (or use a standalone **Client Credentials** app for M2M-only integrations).
2. Copy the **public** **`app_…`** id into **`PMTHOUSE_CLIENT_ID`** (SDKs / device flow / Builder paths).
3. Copy the **M2M** **`m2m_…`** id and its secret into **`PMTHOUSE_M2M_CLIENT_ID`** / **`PMTHOUSE_M2M_CLIENT_SECRET`**.
4. Ensure **`PYMTHOUSE_ISSUER_URL`** points at the OIDC issuer (`.../api/v1/oidc`).
5. Restart NaaP.

Legacy **`naap/link-user`**, **`naap-service`** seed-only flows, and **`gateway`**-only machine scopes are **not** used for this integration.

### Verification checklist

- `PYMTHOUSE_ISSUER_URL` ends with `/api/v1/oidc`.
- `PMTHOUSE_CLIENT_ID` is the public **`app_...`** id; `PMTHOUSE_M2M_CLIENT_ID` is the confidential **`m2m_...`** id.
- `PMTHOUSE_M2M_CLIENT_SECRET` matches the M2M client’s secret.
- NaaP logs show `[billing-auth:pymthouse] Linked user …` (no browser popup).
- Token endpoint returns a short-lived `sign:job` JWT (`expires_in` ≈ 900s); NaaP does **not** persist it.

## Device login (RFC 8628) — Option B (NaaP-side approval)

When PymtHouse redirects the browser to NaaP with `iss` + `target_link_uri` (third-party initiated login), NaaP stores a short-lived cookie, completes sign-in, then performs **two server-to-server steps** at PymtHouse (no extra browser hop to `/oidc/device`):

1. **Mint subject JWT** — `POST /api/v1/apps/{publicClientId}/users/{naapUserId}/token` with M2M Basic auth (same as billing link / `sign:job`).
2. **RFC 8693 token exchange** — `POST {PYMTHOUSE_ISSUER_URL}/token` with `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token` = that JWT, `subject_token_type=urn:ietf:params:oauth:token-type:access_token`, `resource=urn:pmth:device_code:<user_code>`, and M2M Basic auth.

NaaP treats HTTP 2xx on step 2 as success and discards the response body; the CLI keeps polling PymtHouse **`POST .../token`** with the `device_code` as usual until it receives tokens.

Requires: **`PYMTHOUSE_ISSUER_URL`** (must match the `iss` query param, e.g. `http://localhost:3001/api/v1/oidc`), **`PMTHOUSE_CLIENT_ID`** (public), **`PMTHOUSE_M2M_CLIENT_ID`**, **`PMTHOUSE_M2M_CLIENT_SECRET`**, and PymtHouse app settings with device third-party login + initiate URI pointing at NaaP. Device initiate validation uses the **issuer URL’s origin** for `target_link_uri` (so **`PMTHOUSE_BASE_URL`** is not required for that check; avoid pointing `PMTHOUSE_BASE_URL` at NaaP if you also rely on it for PymtHouse site URLs elsewhere).

## Database

`BillingProviderOAuthSession` is still created for audit purposes on each link but the JWT itself is never stored: `accessToken` is always `null` for PymtHouse, `redeemedAt` is set immediately, and the row expires when the JWT does. `pkceCodeVerifier` is always `null` for PymtHouse (no browser OAuth). Run `npx prisma db push` or migrate from `packages/database` after pulling schema changes.
