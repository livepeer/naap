# PymtHouse integration (NaaP)

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

## Billing provider — Create API Key (client credentials)

When a NaaP user clicks **Create API Key** for the PymtHouse billing provider, NaaP performs a server-to-server flow — no browser popup, no redirect URI.

```
NaaP server                     PymtHouse OIDC
    │                                │
    ├─ POST {issuer}/token ──────────►│  grant_type=client_credentials
    │    client_id, client_secret     │  scope=gateway
    │◄─ {access_token (JWT)} ─────────┤
    │                                │
    ├─ POST /api/v1/naap/link-user ──►│  Bearer {access_token}
    │    { naapUserId }               │  provisions / upserts user
    │◄─ { api_key: "pmth_*" } ────────┤  returns 90-day gateway session
    │                                │
    ├─ Stored in DevApiKey ──────────
```

PymtHouse records `naapUserId` as `endUserId` on the session for per-user usage attribution.

### Required env vars (NaaP)

| Variable | Purpose |
|----------|---------|
| `PYMTHOUSE_ISSUER_URL` | OIDC issuer base, e.g. `https://api.example.com/api/v1/oidc` |
| `PMTHOUSE_CLIENT_SECRET` | Secret for the `naap-service` (or configured) confidential OIDC client. NaaP also reads **`NAAP_WEB_CLIENT_SECRET`** as a fallback (migration alias). |
| `PMTHOUSE_CLIENT_ID` | Optional; default **`naap-service`**. Must be a confidential OIDC client with **`gateway`** in allowed scopes. |
| `PMTHOUSE_BASE_URL` | Optional; site origin for marketplace link (`{base}/marketplace`) when `PYMTHOUSE_MARKETPLACE_URL` is unset. Also used to derive the PymtHouse API base URL if set. |

`BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN` is **not needed** for PymtHouse (no redirect URI).

### PymtHouse setup (one-time)

1. Set `NAAP_SERVICE_CLIENT_SECRET` in the PymtHouse environment.
2. Run `npm run oidc:seed` on PymtHouse — seeds **`naap-service`** with `client_credentials` grant and **`gateway`** scope (among others).
3. Copy the printed secret into NaaP's **`PMTHOUSE_CLIENT_SECRET`** env var.
4. Restart NaaP.

The deprecated endpoints `GET /api/v1/naap/auth` and `POST /api/v1/naap/exchange` are no longer called by NaaP. Set `LEGACY_NAAP_LINK_ENABLED=false` on PymtHouse when no other client depends on them.

### Verification checklist

- `PYMTHOUSE_ISSUER_URL` ends with `/api/v1/oidc`.
- `PMTHOUSE_CLIENT_SECRET` matches the PymtHouse `naap-service` secret.
- NaaP logs show `[billing-auth:pymthouse] Linked user …` (no browser popup opens).
- The stored API key starts with `pmth_`.

## Database

`BillingProviderOAuthSession` is still created for audit purposes on each link. `pkceCodeVerifier` is always `null` for PymtHouse (client credentials flow has no PKCE). Run `npx prisma db push` or migrate from `packages/database` after pulling schema changes.
