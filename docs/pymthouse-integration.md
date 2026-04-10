# PymtHouse integration (NaaP)

## Plan-builder JSON (PymtHouse → NaaP)

Stable responses use `schemaVersion: "1.0"`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/pymthouse/capabilities/catalog` | Pipeline catalog + network models (`?limit=` optional) |
| GET | `/api/v1/pymthouse/sla/summary` | KPI, GPU capacity, perf-by-model (`timeframe`, `perfDays`) |
| GET | `/api/v1/pymthouse/network/price` | Pipeline pricing (`experimental: true`) |

Set `NAAP_PLAN_BUILDER_API_BASE` on PymtHouse if the default same-origin base is wrong.

## Marketplace and subscribe (Flow 2)

NaaP does not mirror the billing marketplace. Use `PYMTHOUSE_MARKETPLACE_URL`, or `PYMTHOUSE_ISSUER_URL` (marketplace path defaults to `/marketplace` on the non-`api.` host).

Dashboard: **PymtHouse** in the main sidebar → `/pymthouse`.

## Billing provider OAuth (NaaP → PymtHouse)

Requires `naap-web` OIDC client on PymtHouse (`npm run oidc:seed` in pymthouse) and matching secrets.

| Variable | Purpose |
|----------|---------|
| `PYMTHOUSE_ISSUER_URL` | Issuer base, e.g. `https://api.example.com/api/v1/oidc` |
| `NAAP_WEB_CLIENT_SECRET` | Confidential client secret for `naap-web` (token exchange) |
| `PYMTHOUSE_OIDC_CLIENT_ID` | Optional; default `naap-web` |
| `PYMTHOUSE_OIDC_SCOPES` | Optional; default includes `gateway` for legacy API-key exchange |
| `BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN` | Required in production; must match authorize `redirect_uri` origin |

After OIDC, NaaP calls PymtHouse `POST /api/v1/naap/exchange` to obtain a gateway API key. That route must remain enabled (`LEGACY_NAAP_LINK_ENABLED` not `false` on PymtHouse) unless replaced.

## Database

`BillingProviderOAuthSession.pkceCodeVerifier` supports PymtHouse PKCE. Run `npx prisma db push` or migrate from `packages/database` after pulling schema changes.
