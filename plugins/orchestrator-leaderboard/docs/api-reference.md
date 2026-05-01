# Orchestrator Leaderboard API Reference

## Authentication

All endpoints require authentication via one of:

- **JWT** (NaaP plugin UI): `Authorization: Bearer <jwt_token>`
- **Gateway API Key** (external clients): `Authorization: Bearer gw_<key>`

Obtain an API key from the NaaP dashboard under Service Gateway > API Keys.

---

## POST /api/v1/orchestrator-leaderboard/rank

Returns a ranked list of orchestrator URLs with performance metrics for a given capability.

### Request Body

```json
{
  "capability": "streamdiffusion-sdxl",
  "topN": 10,
  "filters": {
    "gpuRamGbMin": 16,
    "gpuRamGbMax": 80,
    "priceMax": 500,
    "maxAvgLatencyMs": 300,
    "maxSwapRatio": 0.3
  },
  "slaWeights": {
    "latency": 0.4,
    "swapRate": 0.3,
    "price": 0.3
  }
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `capability` | string | Yes | — | Capability name (e.g. `streamdiffusion-sdxl`, `noop`) |
| `topN` | integer | No | 10 | Number of results (1-1000) |
| `filters` | object | No | — | Post-query filters applied after ClickHouse returns |
| `filters.gpuRamGbMin` | number | No | — | Minimum GPU RAM in GB |
| `filters.gpuRamGbMax` | number | No | — | Maximum GPU RAM in GB |
| `filters.priceMax` | number | No | — | Maximum price per unit |
| `filters.maxAvgLatencyMs` | number | No | — | Maximum average latency in ms |
| `filters.maxSwapRatio` | number | No | — | Maximum swap ratio (0-1) |
| `slaWeights` | object | No | — | When provided, re-ranks results by weighted SLA score |
| `slaWeights.latency` | number | No | 0.4 | Weight for latency (lower is better) |
| `slaWeights.swapRate` | number | No | 0.3 | Weight for swap ratio (lower is better) |
| `slaWeights.price` | number | No | 0.3 | Weight for price (lower is better) |

### Response

```json
{
  "success": true,
  "data": [
    {
      "orchUri": "https://orchestrator-1.example.com",
      "gpuName": "RTX 4090",
      "gpuGb": 24,
      "avail": 3,
      "totalCap": 4,
      "pricePerUnit": 100,
      "bestLatMs": 50.2,
      "avgLatMs": 82.5,
      "swapRatio": 0.05,
      "avgAvail": 3.2,
      "slaScore": 0.921
    }
  ]
}
```

`slaScore` is only present when `slaWeights` is provided in the request.

### Response Headers

| Header | Description |
|---|---|
| `Cache-Control: private, max-age=10` | SDK clients can cache the response for 10 seconds |
| `X-Cache: HIT\|MISS` | Whether the server served from its in-memory cache |
| `X-Cache-Age: <seconds>` | Age of the cached data in seconds |
| `X-Data-Freshness: <ISO timestamp>` | When the ClickHouse data was last fetched |

### Error Codes

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid capability, topN, or filter values |
| 401 | `UNAUTHORIZED` | Missing or invalid auth |
| 502 | `UPSTREAM_ERROR` | ClickHouse/gateway unreachable |
| 504 | `GATEWAY_TIMEOUT` | ClickHouse query exceeded 15s timeout |

---

## GET /api/v1/orchestrator-leaderboard/filters

Returns available capability names for the filter dropdown.

### Response

```json
{
  "success": true,
  "data": {
    "capabilities": ["noop", "streamdiffusion-sdxl", "streamdiffusion-sdxl-v2v"],
    "fromFallback": false
  }
}
```

| Field | Type | Description |
|---|---|---|
| `capabilities` | string[] | List of available capability names |
| `fromFallback` | boolean | `true` when capabilities were sourced from a hardcoded fallback list (ClickHouse unavailable) |

Cached for 60 seconds via `Cache-Control` header.

---

## Caching Strategy

The server caches ClickHouse query results **by capability name** for 10 seconds (matching the ClickHouse data update cadence of 5-10s). Multiple requests with different `topN`, `filters`, or `slaWeights` for the same capability share a single cached query result. Post-filtering and SLA scoring happen in-memory.

SDK clients should respect the `Cache-Control: private, max-age=10` header to avoid redundant network round-trips.

---

## GET /api/v1/orchestrator-leaderboard/sources

Returns the list of configured data sources with their priority and enabled status.

### Response

```json
{
  "success": true,
  "data": [
    {
      "kind": "livepeer-subgraph",
      "enabled": true,
      "priority": 1,
      "config": null,
      "updatedAt": "2025-06-01T12:00:00.000Z"
    },
    {
      "kind": "clickhouse-query",
      "enabled": true,
      "priority": 2,
      "config": null,
      "updatedAt": "2025-06-01T12:00:00.000Z"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `kind` | string | Source identifier: `livepeer-subgraph`, `clickhouse-query`, `naap-discover`, `naap-pricing` |
| `enabled` | boolean | Whether this source is active in the refresh pipeline |
| `priority` | integer | Lower = higher priority. Tier-1 (lowest number) owns orchestrator membership |
| `config` | object\|null | Optional per-source overrides |

---

## PUT /api/v1/orchestrator-leaderboard/sources

Update source priority and enabled/disabled status. **Admin only** (`system:admin` role).

### Request Body

```json
{
  "sources": [
    { "kind": "livepeer-subgraph", "enabled": true, "priority": 1 },
    { "kind": "clickhouse-query", "enabled": true, "priority": 2 },
    { "kind": "naap-discover", "enabled": true, "priority": 3 },
    { "kind": "naap-pricing", "enabled": false, "priority": 4 }
  ]
}
```

### Response

Same shape as `GET /sources` — returns the updated list.

### Error Codes

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid kind, priority, or missing required fields |
| 401 | `UNAUTHORIZED` | Missing or invalid auth |
| 403 | `FORBIDDEN` | Caller is not `system:admin` |

---

## GET /api/v1/orchestrator-leaderboard/audits

Returns recent refresh audit records with per-source stats, conflicts, and dropped orchestrators.

### Query Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 20 | Number of audit rows (1–100) |
| `cursor` | string | — | Opaque cursor for keyset pagination |

### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "clxyz...",
      "refreshedAt": "2025-06-01T12:00:00.000Z",
      "refreshedBy": "cron",
      "durationMs": 3200,
      "membershipSource": "livepeer-subgraph",
      "totalOrchestrators": 85,
      "totalCapabilities": 4,
      "perSource": {
        "livepeer-subgraph": { "ok": true, "fetched": 120, "durationMs": 800 },
        "clickhouse-query": { "ok": true, "fetched": 340, "durationMs": 1500 }
      },
      "conflicts": [],
      "dropped": [],
      "warnings": []
    }
  ],
  "pagination": {
    "nextCursor": "clxyz...",
    "hasMore": true
  }
}
```

---

## Quick Start (curl)

```bash
# List capabilities
curl -H "Authorization: Bearer gw_YOUR_KEY" \
  https://your-host/api/v1/orchestrator-leaderboard/filters

# Get top 5 orchestrators
curl -X POST \
  -H "Authorization: Bearer gw_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"capability":"streamdiffusion-sdxl","topN":5}' \
  https://your-host/api/v1/orchestrator-leaderboard/rank

# List data sources
curl -H "Authorization: Bearer gw_YOUR_KEY" \
  https://your-host/api/v1/orchestrator-leaderboard/sources

# View recent audit log
curl -H "Authorization: Bearer gw_YOUR_KEY" \
  https://your-host/api/v1/orchestrator-leaderboard/audits?limit=5
```
