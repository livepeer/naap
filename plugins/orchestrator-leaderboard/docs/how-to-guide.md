# How-To Guide — Orchestrator Leaderboard API

A practical guide for **3rd-party SDKs, gateways, and signers** that need to
discover the best Livepeer orchestrators for a workload via the NaaP
Orchestrator Leaderboard plugin.

You will:

1. Get an API key.
2. **Build a discovery plan** (your selection policy).
3. **Push the plan** to NaaP.
4. **Pull the plan-executed results** (the ranked orchestrator URLs) — and
   wire them into your own caller / signer.

The full machine-readable contract lives in
[`./openapi.yaml`](./openapi.yaml). The narrative reference lives in
[`./api-reference.md`](./api-reference.md). This document is the *integration
playbook*.

---

## 1. Concepts in 30 seconds

| Term | What it is |
|---|---|
| **Capability** | A workflow advertised by orchestrators (e.g. `streamdiffusion-sdxl`, `text-to-image`, `image-to-video`). |
| **Orchestrator** | A node that can run capabilities. We score it by latency, swap-rate, price, and availability. |
| **Discovery Plan** | A persisted policy: "for capabilities X & Y, return top-N orchestrators that pass these filters, ranked by these SLA weights". |
| **Plan Results** | The ranked list produced by evaluating a plan against the latest dataset. Lazily refreshed and cached server-side. |
| **Global Dataset** | The cached snapshot of every capability + orchestrator row, refreshed on a configurable interval (1/4/8/12 hours). |
| **Rank (ad-hoc)** | A stateless single-capability query — useful for dashboards but **not** the recommended SDK path. |

The 3rd-party flow is **plan-driven**: build once, push once, then poll
`/results` from your runtime.

---

## 2. Get an API key

External callers should authenticate with a Service Gateway API key
(`Authorization: Bearer gw_xxx`). Internal browser sessions use a JWT
automatically — you usually don't need to think about it.

1. Sign in to your NaaP deployment.
2. Open **Service Gateway → API Keys**.
3. Create a key and copy it once (it won't be shown again).
4. Store it as `NAAP_API_KEY` in your service's secret manager.

```bash
export NAAP_API_URL=https://app.naap.io
export NAAP_API_KEY=gw_live_xxxxxxxxxxxxxxxxxxxx
```

---

## 3. Discover what capabilities exist

Always start here so your plan only references capabilities the network is
actually serving.

```bash
curl -s -H "Authorization: Bearer $NAAP_API_KEY" \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/filters" | jq
```

```json
{
  "success": true,
  "data": {
    "capabilities": ["noop", "streamdiffusion-sdxl", "streamdiffusion-sdxl-v2v"],
    "fromFallback": false
  }
}
```

> `fromFallback: true` means ClickHouse was unreachable and the platform served
> a hard-coded list. Don't rely on it for production routing decisions.

---

## 4. Build a discovery plan

A plan is just JSON. Here is a minimal valid plan:

```json
{
  "billingPlanId": "my-team-image-pipeline",
  "name": "My Image Pipeline",
  "capabilities": ["text-to-image"]
}
```

Most callers want a fully configured plan. The fields, in order of how often
you'll touch them:

| Field | Type | Required | Notes |
|---|---|---|---|
| `billingPlanId` | string | yes | **Globally unique**. Use your billing SKU or a stable slug. Immutable after create. |
| `name` | string | yes | Human-friendly label shown in the dashboard. |
| `description` | string | no | ≤ 1000 chars. |
| `capabilities` | string[] | yes | 1–50 items, each `^[a-zA-Z0-9_-]+$`. |
| `topN` | integer | no | 1–1000, default `10`. |
| `sortBy` | enum | no | `slaScore` \| `latency` \| `price` \| `swapRate` \| `avail`. |
| `slaWeights` | object | no | `{ latency, swapRate, price }`, each in `[0,1]`. Renormalised internally. |
| `slaMinScore` | number | no | Drop rows with computed SLA below this. Use with `slaWeights`. |
| `filters` | object | no | Hard filters: `gpuRamGbMin/Max`, `priceMax`, `maxAvgLatencyMs`, `maxSwapRatio`. |

A production-quality plan:

```json
{
  "billingPlanId": "prod-stream-v1",
  "name": "Production Stream Diffusion",
  "description": "Latency-sensitive streaming with VRAM floor",
  "capabilities": ["streamdiffusion-sdxl", "streamdiffusion-sdxl-v2v"],
  "topN": 15,
  "sortBy": "slaScore",
  "slaMinScore": 0.6,
  "slaWeights": { "latency": 0.5, "swapRate": 0.3, "price": 0.2 },
  "filters": {
    "gpuRamGbMin": 16,
    "maxAvgLatencyMs": 400,
    "maxSwapRatio": 0.2
  }
}
```

### Picking SLA weights

Lower-is-better metrics (`latency`, `swapRate`, `price`) are normalised across
the candidate set, then combined as a weighted sum. Heuristics:

| Workload | `latency` | `swapRate` | `price` |
|---|---|---|---|
| Real-time streaming | 0.6 | 0.25 | 0.15 |
| Batch image gen | 0.2 | 0.2 | 0.6 |
| Long-form video | 0.35 | 0.4 | 0.25 |
| "Just give me something stable" | 0.34 | 0.33 | 0.33 |

If you don't supply `slaWeights`, the platform falls back to its source-ranked
order (default sort).

---

## 5. Push the plan

```bash
curl -s -X POST \
  -H "Authorization: Bearer $NAAP_API_KEY" \
  -H "Content-Type: application/json" \
  -d @plan.json \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/plans" | jq
```

Successful response:

```json
{
  "success": true,
  "data": {
    "id": "ckxyz123abc",
    "billingPlanId": "prod-stream-v1",
    "name": "Production Stream Diffusion",
    "capabilities": ["streamdiffusion-sdxl", "streamdiffusion-sdxl-v2v"],
    "topN": 15,
    "sortBy": "slaScore",
    "slaMinScore": 0.6,
    "slaWeights": { "latency": 0.5, "swapRate": 0.3, "price": 0.2 },
    "filters": { "gpuRamGbMin": 16, "maxAvgLatencyMs": 400, "maxSwapRatio": 0.2 },
    "enabled": true,
    "createdAt": "2026-05-01T12:00:00.000Z",
    "updatedAt": "2026-05-01T12:00:00.000Z"
  }
}
```

**Persist the `id`** — that's the plan handle you'll use forever after.

> Re-posting the same `billingPlanId` returns `400` with
> `A plan with this billingPlanId already exists`. Treat creates as one-shot
> and use `PUT /plans/{id}` for changes.

### Update / disable / delete

```bash
# Tweak SLA weights without recreating
curl -X PUT -H "Authorization: Bearer $NAAP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slaWeights":{"latency":0.7,"swapRate":0.2,"price":0.1}}' \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/plans/$PLAN_ID"

# Pause without losing the plan definition
curl -X PUT -H "Authorization: Bearer $NAAP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}' \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/plans/$PLAN_ID"

# Permanently delete
curl -X DELETE -H "Authorization: Bearer $NAAP_API_KEY" \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/plans/$PLAN_ID"
```

---

## 6. Get plan-executed results

This is the hot path your runtime calls.

```bash
curl -i -s \
  -H "Authorization: Bearer $NAAP_API_KEY" \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/plans/$PLAN_ID/results" | jq
```

Body:

```json
{
  "success": true,
  "data": {
    "data": {
      "planId": "ckxyz123abc",
      "refreshedAt": "2026-05-01T12:00:14.512Z",
      "capabilities": {
        "streamdiffusion-sdxl": [
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
        ],
        "streamdiffusion-sdxl-v2v": [ /* ... */ ]
      },
      "plan": {
        "name": "Production Stream Diffusion",
        "description": "Latency-sensitive streaming with VRAM floor",
        "capabilities": ["streamdiffusion-sdxl", "streamdiffusion-sdxl-v2v"],
        "topN": 15
      },
      "meta": {
        "totalOrchestrators": 23,
        "refreshIntervalMs": 14400000,
        "cacheAgeMs": 4521
      }
    }
  }
}
```

### Cache headers

| Header | What it tells you |
|---|---|
| `Cache-Control: private, max-age=10` | Safe to cache for 10s in your client. |
| `X-Cache-Age` | Milliseconds since the cached evaluation was produced. |
| `X-Refresh-Interval` | Configured server refresh interval (ms). |

> **Disabled plans return `400`** (`Plan is disabled`). Re-enable via
> `PUT /plans/{id}` with `{ "enabled": true }`.

---

## 7. Wire it into your SDK / signer

The minimal contract your code should implement:

```ts
async function pickOrchestrators(
  planId: string,
  capability: string,
): Promise<string[]> {
  const res = await fetch(
    `${NAAP_API_URL}/api/v1/orchestrator-leaderboard/plans/${planId}/results`,
    { headers: { Authorization: `Bearer ${NAAP_API_KEY}` } },
  );
  if (!res.ok) throw new Error(`leaderboard ${res.status}`);
  const env = await res.json();
  const rows = env.data.data.capabilities[capability] ?? [];
  return rows.map((r: { orchUri: string }) => r.orchUri);
}
```

A complete TypeScript reference client (with client-side caching, ad-hoc rank,
SLA-weighted variants, and URL extraction) lives in
[`../examples/client-test.ts`](../examples/client-test.ts) and a Bash variant
in [`../examples/client-test.sh`](../examples/client-test.sh).

### Full example: build a plan from scratch (TypeScript)

End-to-end: discover capabilities → build a plan → upsert it → pull executed
results. Drop into a file and run with `NAAP_API_KEY=gw_xxx npx tsx build-plan.ts`.

```ts
const NAAP_API_URL = process.env.NAAP_API_URL ?? 'https://app.naap.io';
const NAAP_API_KEY = process.env.NAAP_API_KEY;
if (!NAAP_API_KEY) throw new Error('Set NAAP_API_KEY');

const BASE = `${NAAP_API_URL}/api/v1/orchestrator-leaderboard`;
const authHeader = { Authorization: `Bearer ${NAAP_API_KEY}` };

// ---------------------------------------------------------------------------
// 1. (Optional) Discover capabilities so we only target what's actually live.
// ---------------------------------------------------------------------------
async function listCapabilities(): Promise<string[]> {
  const res = await fetch(`${BASE}/filters`, { headers: authHeader });
  if (!res.ok) throw new Error(`filters ${res.status}`);
  const env = await res.json();
  return env.data.capabilities as string[];
}

// ---------------------------------------------------------------------------
// 2. Build the plan from scratch.
//    Pick fields to match YOUR workload — comments explain the trade-offs.
// ---------------------------------------------------------------------------
type SLAWeights = { latency: number; swapRate: number; price: number };
type Filters = {
  gpuRamGbMin?: number;
  gpuRamGbMax?: number;
  priceMax?: number;
  maxAvgLatencyMs?: number;
  maxSwapRatio?: number;
};
type CreatePlanInput = {
  billingPlanId: string;
  name: string;
  description?: string;
  capabilities: string[];
  topN?: number;
  sortBy?: 'slaScore' | 'latency' | 'price' | 'swapRate' | 'avail';
  slaMinScore?: number;
  slaWeights?: SLAWeights;
  filters?: Filters;
};

const plan: CreatePlanInput = {
  billingPlanId: 'prod-stream-v1',           // globally unique, immutable
  name: 'Production Stream Diffusion',
  description: 'Latency-sensitive streaming with VRAM floor',
  capabilities: ['streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v'],
  topN: 15,                                  // 1..1000
  sortBy: 'slaScore',                        // or latency | price | swapRate | avail
  slaMinScore: 0.6,                          // drop weak orchestrators
  slaWeights: { latency: 0.5, swapRate: 0.3, price: 0.2 },
  filters: {
    gpuRamGbMin: 16,                         // hard VRAM floor
    maxAvgLatencyMs: 400,                    // hard latency ceiling
    maxSwapRatio: 0.2,                       // hard stability ceiling (0..1)
  },
};

// ---------------------------------------------------------------------------
// 3. Push the plan. Idempotent on (billingPlanId): retries return 400.
//    Use upsertPlan() to handle reruns gracefully.
// ---------------------------------------------------------------------------
type DiscoveryPlan = CreatePlanInput & {
  id: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

async function createPlan(input: CreatePlanInput): Promise<DiscoveryPlan> {
  const res = await fetch(`${BASE}/plans`, {
    method: 'POST',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const env = await res.json();
  if (!res.ok || !env.success) {
    throw new Error(env.error?.message ?? `create ${res.status}`);
  }
  return env.data as DiscoveryPlan;
}

async function upsertPlan(input: CreatePlanInput): Promise<DiscoveryPlan> {
  // Look for an existing plan with the same billingPlanId (per-caller scope).
  const list = await fetch(`${BASE}/plans`, { headers: authHeader }).then((r) => r.json());
  const existing = (list.data?.plans as DiscoveryPlan[] | undefined)?.find(
    (p) => p.billingPlanId === input.billingPlanId,
  );
  if (!existing) return createPlan(input);

  const { billingPlanId, ...patch } = input; // billingPlanId is immutable
  const res = await fetch(`${BASE}/plans/${existing.id}`, {
    method: 'PUT',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...patch, enabled: true }),
  });
  const env = await res.json();
  if (!res.ok || !env.success) throw new Error(env.error?.message ?? `update ${res.status}`);
  return env.data.plan as DiscoveryPlan;
}

// ---------------------------------------------------------------------------
// 4. Pull executed results — the URLs your SDK / signer will hit.
// ---------------------------------------------------------------------------
async function getResults(planId: string) {
  const res = await fetch(`${BASE}/plans/${planId}/results`, { headers: authHeader });
  const env = await res.json();
  if (!res.ok || !env.success) throw new Error(env.error?.message ?? `results ${res.status}`);
  return env.data.data as {
    planId: string;
    refreshedAt: string;
    capabilities: Record<string, Array<{ orchUri: string; gpuName: string; slaScore?: number }>>;
    meta: { totalOrchestrators: number; refreshIntervalMs: number; cacheAgeMs: number };
  };
}

// ---------------------------------------------------------------------------
// 5. Tie it together.
// ---------------------------------------------------------------------------
async function main() {
  const caps = await listCapabilities();
  const missing = plan.capabilities.filter((c) => !caps.includes(c));
  if (missing.length) console.warn(`Heads-up: not currently warm: ${missing.join(', ')}`);

  const saved = await upsertPlan(plan);
  console.log(`Plan ready: id=${saved.id} billingPlanId=${saved.billingPlanId}`);

  const results = await getResults(saved.id);
  for (const [cap, rows] of Object.entries(results.capabilities)) {
    console.log(`\n${cap} (${rows.length} orchestrators):`);
    for (const r of rows) {
      console.log(`  ${r.orchUri}  ${r.gpuName}  sla=${r.slaScore?.toFixed(3) ?? 'n/a'}`);
    }
  }
  console.log(
    `\nmeta: refreshIntervalMs=${results.meta.refreshIntervalMs} cacheAgeMs=${results.meta.cacheAgeMs}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Key takeaways from this example:

- **`upsertPlan()`** is the safe re-run pattern. `POST /plans` rejects duplicate
  `billingPlanId`s with `400`, so check the list first and `PUT` if it exists.
- **`billingPlanId` is immutable** — strip it from update payloads.
- **`results.data.data.capabilities[<cap>]`** is the per-capability ranked
  array; `.orchUri` is what your caller / signer dials.
- **Honor `meta.refreshIntervalMs`** and the response `Cache-Control: max-age=10`
  when deciding how often to re-poll.

For Livepeer signers specifically:

1. Copy the plan-results URL from the dashboard (or build it as
   `${NAAP_API_URL}/api/v1/orchestrator-leaderboard/plans/${planId}/results`).
2. Set it as your signer's `ORCHESTRATOR_DISCOVERY_URL` env var.
3. Provide the API key as `ORCHESTRATOR_DISCOVERY_AUTH=Bearer gw_xxx`.

---

## 8. Operational notes

### Caching strategy (multi-layer)

1. **Client cache** — respect `Cache-Control: max-age=10` (results) and
   `max-age=60` (capabilities).
2. **Plan results cache** — server-side, lazily evaluated per plan. Survives
   for `refreshIntervalMs` (1–12 hours, admin-configured).
3. **Global dataset** — populated by Vercel Cron and (manually) by admins.
   Powers all plan evaluations.
4. **Per-capability ClickHouse cache** — 10 seconds, used by `POST /rank`.

### Polling cadence

If your runtime needs a current list, poll the plan results no faster than
**once every 10 seconds per process** (matching the response `Cache-Control`).
For most workloads, 30–60 s is plenty.

### Error model

All errors use the envelope:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

| Status | Code | Common cause |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid `capability`, `topN`, `filters`, or duplicate `billingPlanId`. |
| 401 | `UNAUTHORIZED` | Missing/invalid API key or JWT. |
| 403 | `FORBIDDEN` | Trying to call admin endpoints without `system:admin`. |
| 404 | `NOT_FOUND` | Plan id doesn't exist *or* isn't owned by the caller (scoped per `teamId`/`ownerUserId`). |
| 502 | `UPSTREAM_ERROR` | ClickHouse / gateway unreachable (rank only). |
| 504 | `GATEWAY_TIMEOUT` | ClickHouse query exceeded 15 s (rank only). |

### Authentication scope

Plans are scoped by `teamId` **and** `ownerUserId`. With an API key (`gw_xxx`)
the caller is the team that owns the key — that team can list/update/delete
its plans only. Cross-team reads return `404`, never the plan.

### Rate limits & quotas

The platform enforces standard rate limits via the Service Gateway. If you
expect bursty traffic, batch capabilities into a single plan rather than
issuing one rank request per capability per call.

---

## 9. Reference: ad-hoc ranking (when *not* to use plans)

If you genuinely need a one-shot, no-state query (e.g. building a debugging
dashboard), use `POST /rank` directly:

```bash
curl -X POST -H "Authorization: Bearer $NAAP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "streamdiffusion-sdxl",
    "topN": 5,
    "filters": { "gpuRamGbMin": 16, "maxAvgLatencyMs": 500 },
    "slaWeights": { "latency": 0.5, "swapRate": 0.3, "price": 0.2 }
  }' \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/rank" | jq
```

Trade-offs vs plans:

| | Plan results | Ad-hoc rank |
|---|---|---|
| Caches per request | yes (per plan) | yes (per capability, 10 s) |
| Multi-capability in one call | yes | no |
| Per-caller ownership | yes | no — anyone with auth can run any capability |
| Auditable (visible in dashboard) | yes | no |
| Recommended for SDK runtime | **yes** | no |

---

## 10. Quickstart end-to-end

```bash
export NAAP_API_URL=https://app.naap.io
export NAAP_API_KEY=gw_live_xxxxxxxxxxxx

# 1. List capabilities you can target
curl -s -H "Authorization: Bearer $NAAP_API_KEY" \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/filters" | jq -r '.data.capabilities[]'

# 2. Build & push a plan
PLAN_ID=$(curl -s -X POST -H "Authorization: Bearer $NAAP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "billingPlanId":"quickstart-1",
    "name":"Quickstart",
    "capabilities":["streamdiffusion-sdxl"],
    "topN":5,
    "slaWeights":{"latency":0.5,"swapRate":0.3,"price":0.2}
  }' \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/plans" | jq -r '.data.id')

echo "Plan id: $PLAN_ID"

# 3. Pull executed results — the URLs your SDK will hit
curl -s -H "Authorization: Bearer $NAAP_API_KEY" \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/plans/$PLAN_ID/results" \
  | jq '.data.data.capabilities["streamdiffusion-sdxl"][].orchUri'
```

---

## 11. Going further

- Machine-readable contract: [`openapi.yaml`](./openapi.yaml) — render in
  Swagger UI, Redoc, Stoplight, or generate clients with `openapi-generator`.
- Endpoint reference: [`api-reference.md`](./api-reference.md).
- Reference clients: [`../examples/client-test.ts`](../examples/client-test.ts),
  [`../examples/client-test.sh`](../examples/client-test.sh).
- Dashboard UI: `/orchestrator-leaderboard` in the NaaP shell — useful for
  visually validating plans you create via API.
- Demo plans: `POST /plans/seed` creates 4 ready-made plans for the caller
  (idempotent), great for first-run demos.

If you find a gap in the spec (missing response code, undocumented field,
unclear error), open an issue against
[`livepeer/naap`](https://github.com/livepeer/naap) tagged
`area:orchestrator-leaderboard`.
