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

- **`clientId`** is the confidential OAuth **`client_id`** (e.g. `app_...`), same as `PMTHOUSE_CLIENT_ID`.
- **End-user scope** is only **`sign:job`** on the token request.
- The confidential client must allow **`users:read`**, **`users:write`**, **`users:token`**, and **`sign:job`** in its allowed scopes.
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
| `PMTHOUSE_CLIENT_ID` | Confidential app **`client_id`** (e.g. `app_...`). Used for OAuth and Builder paths `/api/v1/apps/{clientId}/...`. **Required.** |
| `PMTHOUSE_CLIENT_SECRET` | Secret for that confidential client. NaaP also reads **`NAAP_WEB_CLIENT_SECRET`** as a fallback (migration alias). |
| `PMTHOUSE_BASE_URL` | Optional; site origin for marketplace link (`{base}/marketplace`) when `PYMTHOUSE_MARKETPLACE_URL` is unset. Also used to derive the PymtHouse API base URL if set. |

`BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN` is **not needed** for PymtHouse (no redirect URI).

### PymtHouse setup (operators)

1. Register a **confidential** OAuth client on PymtHouse with **`client_credentials`** and allowed scopes at least **`users:read`**, **`users:write`**, **`users:token`**.
2. Copy **`client_id`** (`app_...`) into NaaP **`PMTHOUSE_CLIENT_ID`** and the client secret into **`PMTHOUSE_CLIENT_SECRET`**.
3. Ensure **`PYMTHOUSE_ISSUER_URL`** points at the OIDC issuer (`.../api/v1/oidc`).
4. Restart NaaP.

Legacy **`naap/link-user`**, **`naap-service`** seed-only flows, and **`gateway`**-only machine scopes are **not** used for this integration.

### Verification checklist

- `PYMTHOUSE_ISSUER_URL` ends with `/api/v1/oidc`.
- `PMTHOUSE_CLIENT_ID` is the Builder **`app_...`** id and matches the confidential client on PymtHouse.
- `PMTHOUSE_CLIENT_SECRET` matches that client’s secret.
- NaaP logs show `[billing-auth:pymthouse] Linked user …` (no browser popup).
- Token endpoint returns a short-lived `sign:job` JWT (`expires_in` ≈ 900s); NaaP does **not** persist it.

## Database

`BillingProviderOAuthSession` is still created for audit purposes on each link but the JWT itself is never stored: `accessToken` is always `null` for PymtHouse, `redeemedAt` is set immediately, and the row expires when the JWT does. `pkceCodeVerifier` is always `null` for PymtHouse (no browser OAuth). Run `npx prisma db push` or migrate from `packages/database` after pulling schema changes.
