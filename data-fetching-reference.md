# Data Fetching Reference: /dashboard & /developers (Models Tab)

This document maps every UI widget on the two main pages to its data source, API route, resolver, and external service.

---

## Page 1: `/dashboard` (Network Overview)

**File:** `apps/web-next/src/app/(dashboard)/dashboard/page.tsx`
**Architecture:** Client component (`'use client'`) using GraphQL queries sent via event bus to a plugin data provider, or directly via BFF API routes.

### Data Fetching Hooks

| Hook | Location | Purpose |
|------|----------|---------|
| `useDashboardQuery` | `apps/web-next/src/hooks/useDashboardQuery.ts` | Sends GraphQL to plugin provider via eventBus; 3 separate query calls |
| `useJobFeedStream` | `apps/web-next/src/hooks/useJobFeedStream.ts` | HTTP polls `/api/v1/dashboard/job-feed` or uses event bus |

### Three GraphQL Queries (via `useDashboardQuery`)

1. **LEADERBOARD_QUERY** — timeout 25s — fields: `kpi`, `pipelines`, `pipelineCatalog`, `orchestrators`
2. **REALTIME_QUERY** — timeout 15s — fields: `protocol`, `gpuCapacity`, `pricing`
3. **FEES_OVERVIEW_QUERY** — timeout 25s — fields: `fees(days: 180)`

---

### Widget → Data Source Map

| Widget | Data Field | API Route | Resolver | External Source | Cache TTL |
|--------|-----------|-----------|----------|-----------------|-----------|
| **KPI Cards** (Success Rate, Orchestrators Online, Usage Minutes, Sessions) | `lbData.kpi` | `/api/v1/dashboard/kpi` | `resolveKPI()` | Leaderboard API `/network/demand` | 180s |
| **KPI sparklines** (hourly usage/sessions) | `data.hourlyUsage`, `data.hourlySessions` | same | same | same | same |
| **Protocol Card** (round, block progress, staked LPT) | `rtData.protocol` | `/api/v1/dashboard/protocol` | `resolveProtocol()` | The Graph subgraph | on-demand |
| **Fees Card** (ETH/USD totals, day/week volumes, chart) | `feesData.fees` | `/api/v1/dashboard/fees` | `resolveFees()` | The Graph subgraph | on-demand |
| **Pipelines Card** (top 5, bar chart, model breakdown) | `lbData.pipelines`, `lbData.pipelineCatalog` | `/api/v1/dashboard/pipelines`, `/api/v1/dashboard/pipeline-catalog` | `resolvePipelines()`, `resolvePipelineCatalog()` | Leaderboard API | 900s |
| **GPU Capacity Card** (total/active GPUs, models, pipeline breakdown) | `rtData.gpuCapacity` | `/api/v1/dashboard/gpu-capacity` | `resolveGPUCapacity()` | ClickHouse `network_events.network_events` | 60s |
| **Pricing Card** (pipeline unit price, pixels/unit) | `rtData.pricing` | embedded in REALTIME_QUERY | `resolveRealtime()` | Leaderboard API | 180s |
| **Job Feed** (live stream list: job ID, pipeline, FPS, duration, gateway, orch) | `jobs` (streamed) | `/api/v1/dashboard/job-feed` | `fetchActiveStreamsFromClickHouse()` | ClickHouse `semantic.stream_events` | 10s |
| **Orchestrators Table** (address, sessions, success ratio, SLA, GPUs, pipelines) | `lbData.orchestrators`, `lbData.pipelineCatalog` | `/api/v1/dashboard/orchestrators` | `resolveOrchestrators()` | Leaderboard API `/sla/compliance` | 300s |

---

### API Route Handlers

All in: `apps/web-next/src/app/api/v1/dashboard/`

| Route | Handler | Timeout |
|-------|---------|---------|
| `/kpi` | `resolveKPI()` | 60s |
| `/protocol` | `resolveProtocol()` | 60s |
| `/fees` | `resolveFees()` | 60s |
| `/pipelines` | `resolvePipelines()` | 60s |
| `/pipeline-catalog` | `resolvePipelineCatalog()` | 60s |
| `/gpu-capacity` | `resolveGPUCapacity()` | 60s |
| `/pricing` | embedded `resolveRealtime()` | 60s |
| `/orchestrators` | `resolveOrchestrators()` | 60s |
| `/job-feed` | `fetchActiveStreamsFromClickHouse()` | 30s |

**Resolvers file:** `apps/web-next/src/lib/dashboard/resolvers.ts`

---

### External Services

| Service | Env Var | Data Provided |
|---------|---------|---------------|
| Leaderboard API | `LEADERBOARD_API_URL` | KPI demand, pipelines, SLA scores, pricing |
| The Graph (subgraph) | `SUBGRAPH_ID`, `SUBGRAPH_API_KEY` | Protocol state, fees/volumes |
| ClickHouse | `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` | Live job feed, GPU capacity |

---

## Page 2: `/developers` — Models Tab

**File:** `plugins/developer-api/frontend/src/pages/DeveloperView.tsx`
**Architecture:** Plugin loaded as UMD bundle; plain `fetch()` calls directly from the frontend to the plugin backend Express server.

### Widget → Data Source Map

| Widget | State Variable | API Call | Backend File | Upstream Source |
|--------|---------------|----------|--------------|-----------------|
| **Search input** (filter by model/pipeline name) | `networkModelSearch` | — (client-side filter) | — | — |
| **Pipeline filter buttons** (dynamic, from loaded data) | `pipelineFilter` / `pipelineOptions` | — (derived from `networkModels`) | — | — |
| **Loading spinner** | `networkModelsLoading` | — | — | — |
| **Models table** (model name, pipeline, warm orch count, total capacity, avg price, price range) | `networkModels` → `filteredNetworkModels` | `GET /api/v1/developer-api/developer/network-models?limit=50` | `plugins/developer-api/backend/src/server.ts` lines 171-200 | NAAP API `${LEADERBOARD_API_URL}/net/models?limit=50` |
| **Copy buttons** (model name, pipeline name) | `copiedCell` | — (clipboard API) | — | — |
| **Refresh button** | triggers `loadNetworkModels()` | same as models table | same | same |

### Data Load Trigger

```
plugins/developer-api/frontend/src/pages/DeveloperView.tsx lines 237-239:
  useEffect → when activeTab === 'models' → loadNetworkModels()
```

### Backend Proxy (`plugins/developer-api/backend/src/server.ts` lines 171-200)

```
Frontend → GET /api/v1/developer-api/developer/network-models?limit=50
  → Plugin backend Express handler
    → Upstream: ${LEADERBOARD_API_URL}/net/models?limit=50  (default: https://naap-api.livepeer.cloud/v1)
    → 10s timeout
    → Parses: direct array | { models: [] } | { data: [] }
    → Returns: { models: NetworkModel[], total: number }
```

### NetworkModel Shape

```typescript
interface NetworkModel {
  Pipeline: string;
  Model: string;
  WarmOrchCount: number;
  TotalCapacity: number;
  PriceMinWeiPerPixel: number;
  PriceMaxWeiPerPixel: number;
  PriceAvgWeiPerPixel: number;
}
```

### Client-side Filtering (memoized, lines 246-260)

1. Filter by `pipelineFilter` (exact match on `Pipeline` field)
2. Filter by `networkModelSearch` (substring match on `Model` or `Pipeline`, case-insensitive)

### Note: Alternative Models Endpoint (not used by the Models tab)

`GET /api/v1/developer/models` (`apps/web-next/src/app/api/v1/developer/models/route.ts`) hits the **Prisma DB** (`DevApiAIModel` table) — separate from the network models endpoint and **not** what the Models tab uses.

---

## Key Environment Variables

```bash
# Shared
LEADERBOARD_API_URL=<base_url>/v1  # drives dashboard pipelines/SLA and developer models proxy

# Dashboard only
CLICKHOUSE_URL=
CLICKHOUSE_USER=
CLICKHOUSE_PASSWORD=
SUBGRAPH_ID=
SUBGRAPH_API_KEY=

# Job feed filter (optional)
JOB_FEED_PIPELINE_FILTER=%
```

---

## Current Data Flow Summary

```
/dashboard
  ├── useDashboardQuery (eventBus → plugin provider → BFF routes)
  │   ├── LEADERBOARD_QUERY → /kpi, /pipelines, /pipeline-catalog, /orchestrators
  │   │   └── External: LEADERBOARD_API_URL (/network/demand, /sla/compliance)
  │   ├── REALTIME_QUERY → /protocol, /gpu-capacity, /pricing
  │   │   ├── /protocol → The Graph subgraph
  │   │   ├── /gpu-capacity → ClickHouse network_events.network_events
  │   │   └── /pricing → LEADERBOARD_API_URL
  │   └── FEES_OVERVIEW_QUERY → /fees
  │       └── External: The Graph subgraph
  └── useJobFeedStream (HTTP polling)
      └── /api/v1/dashboard/job-feed → ClickHouse semantic.stream_events

/developers → Models tab
  └── fetch() on tab activate / refresh button
      └── GET /api/v1/developer-api/developer/network-models?limit=50
          └── Plugin Express backend → LEADERBOARD_API_URL/net/models?limit=50
```

---

## Verification

To validate data flows end-to-end:
1. Open browser devtools Network tab on `/dashboard` — confirm 3 GraphQL query responses via eventBus + `/api/v1/dashboard/job-feed` polling
2. Inspect `/api/v1/dashboard/kpi`, `/protocol`, `/fees`, `/pipelines`, `/gpu-capacity`, `/orchestrators` individually
3. On `/developers` → Models tab, confirm XHR to `/api/v1/developer-api/developer/network-models?limit=50`
4. Confirm `LEADERBOARD_API_URL` is set — both the dashboard (SLA/pipelines) and developer models proxy depend on it
