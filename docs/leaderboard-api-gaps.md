# Leaderboard API — Gaps and Future Development

**Status:** Draft  
**Date:** 2026-02-25  
**Related:** [leaderboard-api-data-contract.md](./leaderboard-api-data-contract.md)

This document captures known limitations, unused data, and missing leaderboard API capabilities that would be needed to fully support NaaP's goals.

---

## 1. Data Warehouse / API Changes Needed

### 1.1 `model_id` Consistency in ClickHouse Views

`model_id` is nullable in both `v_api_gpu_metrics` and `v_api_sla_compliance`. NaaP works around this by fuzzy-matching against the `pipeline` field, which risks false matches as the network grows.

**Needed:** Consistent population of `model_id` in both ClickHouse views so that every row can be unambiguously attributed to a model.

---

### 1.2 Response Row Cap (200 rows)

All three ClickHouse-backed endpoints (`/api/gpu/metrics`, `/api/sla/compliance`, `/api/network/demand`) return at most 200 rows. At scale (many orchestrators × pipelines × regions), NaaP will silently see incomplete data with no indication rows were dropped.

**Needed:** Pagination support, a configurable `limit` parameter, or server-side pre-aggregation that reduces cardinality before returning results to the client.

---

### 1.3 Active Capacity vs. Historical Catalog

`/api/pipelines` reflects all `(pipeline, model)` pairs that have *ever* submitted a test job. A model with no active orchestrators today still appears in the catalog.

**Needed:** A `currently_active` flag, a minimum recent session count, or a `since` filter that NaaP can use to show only models with live capacity.

---

### 1.4 Gateway Identity and Operator Metadata

The `gateway` field in `/api/network/demand` is a raw string identifier (e.g. `cloud-spe-ai-live-video-tester-mdw`). There is no mapping to a wallet address, operator name, service URI, or verification status.

**Needed:** A `/api/gateways` endpoint (or enriched gateway data) that exposes operator metadata so NaaP can display verified gateway identities and link to on-chain records.

---

### 1.5 Latency Data on Network Demand Rows

`/api/network/demand` has no latency field. NaaP currently uses the averaged `e2e_latency_ms` from GPU metrics as the `latencyGuarantee` on a `GatewayOffer`, which is an observed average — not a declared SLA.

**Needed:** A gateway-reported latency field on demand rows, or a separate gateway configuration endpoint with declared latency SLAs.

---

### 1.6 Pricing Currency

`GatewayOffer.unitPrice` is computed as `fee_payment_eth / total_inference_minutes` (ETH/min). The UI currently labels this as `$x.xxx/min`, which is incorrect.

**Needed:** Either an ETH/USD conversion rate from the API (or a separate price feed), or update the UI label to `Ξ/min` until USD pricing is available.

---

### 1.7 Historical / Trend Data

NaaP only fetches the most recent window (`1h` for GPU metrics, `24h` for SLA). There are no bucketed time-series arrays in any response.

**Needed:** Multiple time buckets in a single response, or a dedicated time-series endpoint, to support trend charts (e.g. FPS or SLA score over 7 days).

---

### 1.8 Datasets Endpoint is a Static Stub

`GET /api/datasets` returns hard-coded data with no database backing.

**Needed:** A database-backed implementation before NaaP can expose load test datasets to developers.

---

## 2. Unused API Response Fields

Fields currently returned by the API but not consumed by NaaP. Included here as candidates for future UI features.

### `/api/gpu/metrics`

| Field | Potential use |
|-------|---------------|
| `jitter_coeff_fps` | FPS consistency — quality signal for live video |
| `prompt_to_first_frame_ms` | Cold-start latency — relevant for interactive use cases |
| `startup_time_ms` / `startup_time_s` | Model warm-up time — warm vs cold performance differentiation |
| `p95_e2e_latency_ms` | P95 latency — more robust than mean for SLO definition |
| `p95_prompt_to_first_frame_ms` | P95 cold-start — SLA tier input |
| `swap_rate` | Session swap rate — quality signal |
| `runner_version` | Version-filtered views, upgrade tracking |
| `cuda_version` | Hardware compatibility filtering |
| `status_samples` | Could weight reliability of metric averages |

### `/api/sla/compliance`

| Field | Potential use |
|-------|---------------|
| `success_ratio` | Display separately from composite `sla_score` |
| `no_swap_ratio` | Session continuity — live video stability signal |
| `excused_sessions` | Show share of failures that were network-excused |
| `unexcused_sessions` | Key input for SLA enforcement |
| `swapped_sessions` | Swap count as a distinct quality dimension |
| `region` | Per-region SLA breakdown (e.g. "Gold in FRA, Silver in MDW") |
| `gpu_id` | Per-GPU SLA — identify unhealthy GPU slots |

### `/api/network/demand`

| Field | Potential use |
|-------|---------------|
| `total_streams` | Distinct streams vs sessions — multi-session stream economics |
| `avg_output_fps` | Gateway-reported FPS — validate against orchestrator-reported FPS |
| `total_inference_minutes` | Absolute demand volume — capacity planning |
| `unserved_sessions` | Quantifies unmet demand — capacity planning signal |
| `unexcused_sessions` | Gateway-side unexcused failure rate |
| `swapped_sessions` | Session swap rate from gateway perspective |

---

## 3. Unused API Endpoints

Leaderboard API endpoints not consumed in the current `wip/metrics` integration.

| Endpoint | Description | Potential NaaP use |
|----------|-------------|-------------------|
| `GET /api/aggregated_stats` | Legacy Postgres-backed orchestrator scores | Orchestrator detail views |
| `GET /api/raw_stats` | Per-test-job raw payloads | Debug / transparency views |
| `GET /api/top_ai_score` | Best region + score for an orchestrator | Orchestrator onboarding recommendations |
| `GET /api/datasets` | Load test dataset catalog | Developer tooling |
| `GET /api/health` | Postgres + ClickHouse health | NaaP status page |

---

## 4. NaaP-Side Display Name Gaps

`network-config.ts` must be kept in sync with the leaderboard API catalog manually. Any pipeline or model ID not present in the config will fall back to displaying its raw API string.

**Pipeline IDs with no display name mapping:**

| Pipeline ID | Status |
|-------------|--------|
| `audio-to-text` | Unmapped |
| `image-to-image` | Unmapped |
| `image-to-video` | Unmapped |
| `segment-anything-2` | Unmapped |

**Impact:** If the leaderboard API adds a new model or pipeline, it will appear in the NaaP catalog with its raw ID until `network-config.ts` is updated.
