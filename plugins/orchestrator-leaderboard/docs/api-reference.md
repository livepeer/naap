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
| `Cache-Control: public, max-age=10` | SDK clients can cache the response for 10 seconds |
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
    "capabilities": ["noop", "streamdiffusion-sdxl", "streamdiffusion-sdxl-v2v"]
  }
}
```

Cached for 60 seconds via `Cache-Control` header.

---

## Caching Strategy

The server caches ClickHouse query results **by capability name** for 10 seconds (matching the ClickHouse data update cadence of 5-10s). Multiple requests with different `topN`, `filters`, or `slaWeights` for the same capability share a single cached query result. Post-filtering and SLA scoring happen in-memory.

SDK clients should respect the `Cache-Control: max-age=10` header to avoid redundant network round-trips.

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
```
