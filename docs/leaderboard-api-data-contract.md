# Leaderboard API — NaaP Data Contract

**Status:** Draft  
**Branch:** `wip/metrics`  
**Date:** 2026-02-25  

---

## Overview

NaaP fetches five endpoints from `https://leaderboard-api.livepeer.cloud` in parallel on every 60-second poll. All calls originate in `useNetworkCapabilities()` (`developer-web` MFE). The raw rows are aggregated into `NetworkModel[]` objects consumed by the Models tab UI.

```
useNetworkCapabilities()
  ├── GET /api/pipelines            → model catalog (pipeline IDs, model IDs, region codes)
  ├── GET /api/regions              → region code → display name map
  ├── GET /api/gpu/metrics?time_range=1h    → per-GPU FPS, latency, hardware info
  ├── GET /api/sla/compliance?period=24h   → per-orchestrator SLA scores
  └── GET /api/network/demand?interval=1h  → per-gateway sessions, capacity, fees
```

A server-side proxy in `web-next` forwards requests from other NaaP surfaces:  
`GET /api/v1/leaderboard/{path}?{query}` → `https://leaderboard-api.livepeer.cloud/api/{path}?{query}`

---

## Endpoints

### `GET /api/pipelines`

**Params sent:** none (full catalog)

**Response fields used:**

| Field | Type | How it's used |
|-------|------|---------------|
| `id` | `string` | Pipeline ID; key for `PIPELINE_DISPLAY` lookup; becomes `NetworkModel.pipelineId` |
| `models` | `string[]` | Each entry creates one `NetworkModel` (if not excluded) |
| `regions` | `string[]` | Populates `NetworkModel.regionCodes` |

---

### `GET /api/regions`

**Params sent:** none (full list); NaaP filters client-side to `type === 'ai'`

**Response fields used:**

| Field | Type | How it's used |
|-------|------|---------------|
| `id` | `string` | Region code key (e.g. `"FRA"`) |
| `name` | `string` | Display name (e.g. `"Frankfurt"`); used in `NetworkModel.regions` and gateway offer region lists |
| `type` | `string` | Filtered to `"ai"` only |

---

### `GET /api/gpu/metrics?time_range=1h`

**Params sent:** `time_range=1h`

**Response fields used:**

| Field | How it's used |
|-------|---------------|
| `pipeline` / `model_id` | Matched against catalog `(pipelineId, modelId)` via `matchesModel()` |
| `gpu_name` | Groups rows into `GPUHardwareSummary` entries; displayed in ModelCard and GPU fleet table |
| `gpu_id` | Counts distinct GPUs per hardware group (`GPUHardwareSummary.count`) |
| `gpu_memory_total` | Converted bytes → GB for VRAM column in GPU fleet table |
| `avg_output_fps` | Averaged across rows → `NetworkModel.avgFPS`; drives FPS badge, realtime flag (`>= 15 fps`), sort order |
| `p95_output_fps` | Stored in `GPUHardwareSummary.p95FPS` |
| `e2e_latency_ms` | Averaged → `NetworkModel.e2eLatencyMs`; displayed in ModelCard/ModelDetailPanel; used as `latencyGuarantee` fallback in GatewayOfferCard |
| `failure_rate` | Averaged per GPU group → `GPUHardwareSummary.failureRate`; shown in GPU fleet table |

**Available filters not yet applied:** `orchestrator_address`, `pipeline`, `model_id`, `gpu_id`, `region`, `gpu_name`, `runner_version`, `cuda_version`

---

### `GET /api/sla/compliance?period=24h`

**Params sent:** `period=24h`

**Response fields used:**

| Field | How it's used |
|-------|---------------|
| `pipeline` / `model_id` | Matched against catalog via `matchesSLA()` |
| `sla_score` | Session-count-weighted average → `NetworkModel.slaScore`; displayed in ModelCard SLA badge, ModelDetailPanel, CompareDrawer; used in sort order |
| `known_sessions` | Weighting factor for `slaScore` average |
| `orchestrator_address` | Distinct count → `NetworkModel.orchestratorCount` |

**Available filters not yet applied:** `orchestrator_address`, `region`, `pipeline`, `model_id`, `gpu_id`

---

### `GET /api/network/demand?interval=1h`

**Params sent:** `interval=1h`

**Response fields used:**

| Field | How it's used |
|-------|---------------|
| `gateway` | Groups rows by gateway; becomes `GatewayOffer.gatewayName` (displayed in GatewayOfferCard) |
| `region` | Resolved via `regionMap` → `GatewayOffer.regions` (displayed in GatewayOfferCard) |
| `success_ratio` | → `GatewayOffer.slaTier` (gold ≥99.5%, silver ≥98%, bronze <98%) and `uptimeGuarantee` (×100 → %) |
| `missing_capacity_count` / `total_demand_sessions` | Shortage rate → `GatewayOffer.capacity` (high ≤2%, medium ≤10%, low >10%) |
| `fee_payment_eth` / `total_inference_minutes` | → `GatewayOffer.unitPrice` in ETH/min |
| `total_sessions` / `served_sessions` | Intermediate aggregation in `NetworkDemandSummary` |

**Available filters not yet applied:** `gateway`, `region`, `pipeline`

---

## NaaP Data Model

### `NetworkModel`

One entry per `(pipeline, model)` pair from the catalog.

```typescript
interface NetworkModel {
  id:                string;               // "{pipelineId}::{modelId}"
  pipelineId:        string;               // e.g. "live-video-to-video"
  pipelineType:      string;               // display name from PIPELINE_DISPLAY
  modelId:           string;               // e.g. "streamdiffusion-sdxl"
  displayName:       string;               // human-readable name from MODEL_DISPLAY
  regions:           string[];             // display names e.g. ["Frankfurt", "Chicago"]
  regionCodes:       string[];             // API codes e.g. ["FRA", "MDW"]
  gpuHardware:       GPUHardwareSummary[]; // one entry per distinct gpu_name
  orchestratorCount: number;               // distinct orchestrator_address count (from SLA rows)
  avgFPS:            number;               // mean avg_output_fps across matching GPU rows
  e2eLatencyMs:      number | null;        // mean e2e_latency_ms; null if no data
  slaScore:          number | null;        // session-weighted mean sla_score; null if no data
  isRealtime:        boolean;              // avgFPS >= 15
  gatewayOffers?:    GatewayOffer[];       // one per distinct gateway; sorted by capacity desc
}
```

### `GPUHardwareSummary`

```typescript
interface GPUHardwareSummary {
  name:         string;        // gpu_name, e.g. "NVIDIA GeForce RTX 5090"
  count:        number;        // distinct gpu_id count within this gpu_name group
  memoryGB:     number;        // gpu_memory_total / 1e9 rounded (0 if unknown)
  avgFPS:       number;        // mean avg_output_fps for this group
  p95FPS:       number;        // mean p95_output_fps for this group
  avgLatencyMs: number | null; // mean e2e_latency_ms; null if no data
  failureRate:  number;        // mean failure_rate (0–1)
}
```

### `GatewayOffer`

```typescript
interface GatewayOffer {
  gatewayId:        string;        // slug derived from gateway name
  gatewayName:      string;        // raw gateway field from /api/network/demand
  slaTier:          SLATier;       // 'gold' | 'silver' | 'bronze'
  uptimeGuarantee:  number;        // success_ratio × 100 (%)
  latencyGuarantee: number;        // e2e_latency_ms from GPU metrics, or 250ms fallback
  unitPrice:        number;        // fee_payment_eth / total_inference_minutes (ETH/min)
  regions:          string[];      // display names of regions this gateway serves
  capacity:         CapacityLevel; // 'high' | 'medium' | 'low'
}
```

### API Key Scope Note

API key provisioning is scoped to a single billing provider (for example, Daydream). Gateway selection is informational in model detail views and is not part of API key creation or key storage.

### SLA Tier Thresholds

| Tier | `success_ratio` |
|------|----------------|
| Gold | ≥ 0.995 |
| Silver | ≥ 0.98 |
| Bronze | < 0.98 |

### Capacity Level Thresholds

| Level | `missing / total_demand` |
|-------|--------------------------|
| High | ≤ 2% |
| Medium | > 2% and ≤ 10% |
| Low | > 10% |

---

## Display Name Configuration

`apps/workflows/developer-web/src/data/network-config.ts`

### Pipeline IDs

| Pipeline ID | Display Name |
|-------------|-------------|
| `live-video-to-video` | Video-to-Video |
| `llm` | LLM |
| `text-to-image` | Text-to-Image |
| `upscale` | Upscale |

### Model IDs

| Model ID | Display Name |
|----------|-------------|
| `streamdiffusion-sdxl` | SDXL StreamDiffusion |
| `streamdiffusion-sdxl-v2v` | SDXL StreamDiffusion V2V |
| `black-forest-labs/FLUX.1-dev` | FLUX.1 Dev |
| `SG161222/RealVisXL_V4.0_Lightning` | RealVisXL V4 Lightning |
| `meta-llama/Meta-Llama-3.1-8B-Instruct` | Llama 3.1 8B Instruct |
| `glm-4.7-flash` | GLM-4 Flash |
| `llama3.2-vision` | Llama 3.2 Vision |
| `stabilityai/stable-diffusion-x4-upscaler` | SD x4 Upscaler |
| `noop` | _(excluded — benchmark)_ |

---

## Model Matching Logic

GPU metrics and SLA compliance rows use `pipeline` to hold either the parent pipeline ID or the model ID depending on the source. NaaP matches a row to a `(pipelineId, modelId)` pair if any of the following hold:

- `row.model_id === modelId`
- `row.pipeline === modelId`
- `row.pipeline === pipelineId` AND `row.model_id === modelId`

---

## Polling Behavior

All five fetches fire in parallel via `Promise.all`. No staggering or back-off on error.

| Endpoint | Time window | Refresh interval |
|----------|-------------|-----------------|
| `/api/pipelines` | All time | 60 s |
| `/api/regions` | All time | 60 s |
| `/api/gpu/metrics` | Last 1 hour | 60 s |
| `/api/sla/compliance` | Last 24 hours | 60 s |
| `/api/network/demand` | Last 1 hour | 60 s |
