# Data Sources — Orchestrator Leaderboard

The orchestrator-leaderboard plugin refreshes its global dataset from **4
pluggable data sources**, each contributing a specific set of fields. Sources
are admin-configurable: you can enable/disable individual sources and change
their priority order.

---

## Source overview

| Priority (default) | Kind                | Description | Owns membership? |
| ------------------- | ------------------- | ----------- | ---------------- |
| 1                   | `livepeer-subgraph` | On-chain registry via The Graph (Livepeer Arbitrum subgraph) | **Yes** |
| 2                   | `clickhouse-query`  | Performance metrics from ClickHouse (GPU, latency, stability) | No |
| 3                   | `naap-discover`     | Live orchestrator discovery with capabilities and scores | No |
| 4                   | `naap-pricing`      | Per-pipeline pricing data from the NaaP dashboard | No |

### livepeer-subgraph (on-chain registry)

- **What it provides**: `ethAddress`, `orchUri` (from `serviceURI`),
  `activationRound`, `deactivationRound`.
- **Why it matters**: This is the **ground truth** for orchestrator identity.
  Only orchestrators registered on-chain and active are considered valid. As
  the default membership source, any orchestrator not in this source is
  dropped from the dataset.
- **Upstream**: The Graph Gateway (`gateway.thegraph.com`) → Livepeer subgraph.
- **Auth**: Bearer token (Graph API key stored in Service Gateway secrets).

### clickhouse-query (performance metrics)

- **What it provides**: `gpuName`, `gpuGb`, `avail`, `totalCap`,
  `pricePerUnit`, `bestLatMs`, `avgLatMs`, `swapRatio`, `avgAvail`.
- **Why it matters**: The primary performance dataset, sourced from the
  `semantic.network_capabilities` and `semantic.gateway_latency_summary`
  tables. This data drives SLA scoring and ranking.
- **Upstream**: ClickHouse HTTP API via the Service Gateway's
  `clickhouse-query` connector.
- **Auth**: Basic auth (username/password in Service Gateway secrets).

### naap-discover (live discovery)

- **What it provides**: `capabilities[]`, `score`, `recentWork`, `lastSeenMs`.
- **Why it matters**: Provides real-time liveness and capability mappings that
  are not available from on-chain data or ClickHouse alone.
- **Upstream**: `https://naap-api.cloudspe.com/v1/discover/orchestrators`.
- **Auth**: None required.

### naap-pricing (dashboard pricing)

- **What it provides**: `pricePerUnit` (per-pipeline, per-model pricing in
  wei), `pipeline`, `model`, `isWarm`.
- **Why it matters**: Supplements ClickHouse pricing with per-model granularity
  and warmth indicators.
- **Upstream**: `https://naap-api.cloudspe.com/v1/dashboard/pricing`.
- **Auth**: None required.

---

## Conflict resolution

The resolver uses a **hybrid** strategy:

### Source-level membership

The source with the **lowest priority number** (highest priority) among
enabled sources is the **membership owner**. Only orchestrators present in
this source appear in the final dataset. Orchestrators from other sources
that are not in the membership set are **dropped** and recorded in the
audit log.

### Field-level metric priority

For each orchestrator in the membership set, individual fields are resolved
using a configurable field-priority order. The **first source** with a
non-null value for a given field wins. Conflicts (multiple sources providing
different values for the same field) are recorded in the audit log.

Default field priorities:

| Field | Priority order |
| --- | --- |
| `orchUri` | subgraph > clickhouse > discover > pricing |
| `ethAddress` | subgraph > pricing > clickhouse > discover |
| `gpuName`, `gpuGb` | clickhouse > discover |
| `avail`, `totalCap` | clickhouse only |
| `pricePerUnit` | clickhouse > pricing |
| `bestLatMs`, `avgLatMs`, `swapRatio`, `avgAvail` | clickhouse only |
| `score`, `recentWork`, `lastSeenMs` | discover only |
| `capabilities` | merged from all sources |

### Orchestrator joining

Orchestrators are joined across sources using two keys:

- **`ethAddress`** (Ethereum address, lowercased)
- **`orchUri`** (service URI / URL)

When one source provides `ethAddress` and another provides `orchUri` for the
same orchestrator, the resolver builds a cross-reference map to join them.

---

## Audit log

Every refresh writes a `LeaderboardRefreshAudit` record to the database with:

- **Per-source stats**: row count, duration, success/failure, error message.
- **Conflicts**: which fields had competing values and which source won.
- **Dropped orchestrators**: which orchs were excluded and why.
- **Warnings**: non-fatal issues (e.g., no sources enabled).

View audits via:
- **API**: `GET /api/v1/orchestrator-leaderboard/audits?limit=20`
- **Admin UI**: Dataset Settings → Refresh Audit tab

---

## Admin configuration

### Via API

```bash
# List sources
GET /api/v1/orchestrator-leaderboard/sources

# Update sources (admin only)
PUT /api/v1/orchestrator-leaderboard/sources
Body: { "sources": [{ "kind": "...", "enabled": true, "priority": 1 }, ...] }
```

### Via Admin UI

In the NaaP shell, navigate to the Orchestrator Leaderboard → Dataset
Settings → **Data Sources** tab. Drag sources to reorder priority, toggle
the switches to enable/disable.

---

## Architecture

```
Cron / Admin POST /dataset/refresh
         │
         ▼
   RefreshOrchestrator
         │
    ┌─────┴──────┐──────────┐──────────┐
    ▼            ▼          ▼          ▼
 Subgraph    ClickHouse  Discover   Pricing
 Adapter     Adapter     Adapter    Adapter
    │            │          │          │
    └────────────┴──────────┴──────────┘
                 │
                 ▼
         ConflictResolver
         (hybrid: source membership + field-level)
                 │
                 ▼
           AuditWriter
                 │
                 ▼
    setGlobalDataset() + clearPlanCache()
```

Each adapter calls its upstream through the Service Gateway proxy
(`/api/v1/gw/<connector-slug>/...`), inheriting the gateway's auth,
rate limiting, and timeout policies.
