# Dashboard Provider

Reference implementation of a **dashboard data provider** plugin.

This plugin provides live data to the core dashboard via the GraphQL-over-event-bus pattern defined in `@naap/plugin-sdk`. It is backed by:

- **Livepeer Leaderboard API** — KPI, pipelines, GPU capacity, orchestrators
- **Livepeer subgraph** — protocol round info and fee volume
- **L1 RPC** — Ethereum block number for round progress
- **Fallback data** — pricing (until an endpoint exists) and job feed (simulated)

## Quick Start

```bash
# 1. Clone as your own plugin
cp -r plugins/dashboard-provider-mock plugins/my-dashboard-provider

# 2. Update plugin.json (name, displayName, etc.)

# 3. Configure environment variables (see .env.example in apps/web-next)
#    SUBGRAPH_API_KEY, SUBGRAPH_ID, L1_RPC_URL, LEADERBOARD_API_URL

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
| `frontend/src/provider.ts` | Registers all dashboard resolvers (live API + fallbacks) |
| `frontend/src/job-feed-emitter.ts` | Simulates live job events |
| `frontend/src/data/*.ts` | Fallback/seed data (pricing, job feed) |
| `frontend/src/App.tsx` | Plugin entry — registers providers on mount |
