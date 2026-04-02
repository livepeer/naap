# Dashboard Network Data

Reference implementation of a **dashboard data provider** plugin.

This plugin provides live data to the core dashboard via the GraphQL-over-event-bus pattern defined in `@naap/plugin-sdk`. It is backed by:

- **NAAP API** — KPI, pipelines, GPU capacity, orchestrators
- **Job feed** — simulated job events (seed data)

- **Protocol** — live data from the Livepeer subgraph and L1 RPC (via server routes `/api/v1/protocol-block` and subgraph proxy). Requires `L1_RPC_URL` and subgraph config for full accuracy.
- **Fees** — live data from the Livepeer subgraph (via server-side proxy). Requires subgraph configuration.
- **Pricing** — currently returns static fallback values; no live pricing source is wired yet.

## Quick Start

```bash
# 1. Clone as your own plugin
cp -r plugins/dashboard-data-provider plugins/my-dashboard-provider

# 2. Update plugin.json (name, displayName, etc.)

# 3. Configure environment variables (see .env.example in apps/web-next)
#    NAAP_API_SERVER_URL (full base including /api or /v1, e.g. https://…/api)
#    L1_RPC_URL (required for protocol block progress)
#    SUBGRAPH_API_KEY and SUBGRAPH_ID (required for fees/protocol data)

# 4. Build and deploy
cd plugins/my-dashboard-provider/frontend && npm run build
```

## Architecture

This is a **headless plugin** — it has no UI routes and no navigation entry. It registers as a dashboard data provider on mount via the event bus.

```
Dashboard (core)  ←—  eventBus.request('dashboard:query', {query})  —→  This plugin
```

The plugin uses `createDashboardProvider()` from the SDK, which:
1. Builds the shared GraphQL schema
2. Wraps your resolver functions
3. Registers a single event bus handler

## Files

| File | Purpose |
|---|---|
| `frontend/src/provider.ts` | Registers dashboard resolvers and fetches widget JSON from `/api/v1/dashboard/*` |
| `frontend/src/job-feed-emitter.ts` | Simulates live job events |
| `frontend/src/data/*.ts` | Pipeline config and seed data |
| `frontend/src/App.tsx` | Plugin entry — registers providers on mount |
