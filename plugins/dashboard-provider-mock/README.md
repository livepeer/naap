# Dashboard Provider (Mock)

Reference implementation of a **dashboard data provider** plugin.

This plugin provides mock data to the core dashboard via the GraphQL-over-event-bus pattern defined in `@naap/plugin-sdk`. It serves as both:

1. **A working example** — install it and the dashboard renders data immediately
2. **A starter template** — clone it, replace mock data with real API calls, deploy

## Quick Start

```bash
# 1. Clone as your own plugin
cp -r plugins/dashboard-provider-mock plugins/my-dashboard-provider

# 2. Update plugin.json (name, displayName, etc.)

# 3. Replace mock data in frontend/src/data/ with real API calls
#    Edit frontend/src/provider.ts to call your backend APIs

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
| `frontend/src/provider.ts` | Registers all dashboard resolvers |
| `frontend/src/job-feed-emitter.ts` | Simulates live job events |
| `frontend/src/data/*.ts` | Mock data (replace with real fetches) |
| `frontend/src/App.tsx` | Plugin entry — registers providers on mount |

## Replacing Mock Data

Each file in `frontend/src/data/` exports a single mock data object. To use real data:

```typescript
// Before (mock)
export const mockKPI = { successRate: { value: 97.3, delta: 1.2 }, ... };

// After (real)
export async function fetchKPI(api: IApiClient): Promise<DashboardKPI> {
  const stats = await api.get('/api/v1/network-analytics/stats');
  return { successRate: { value: stats.successRate, delta: ... }, ... };
}
```

Then update `provider.ts` to call the async function instead of returning the static object.
