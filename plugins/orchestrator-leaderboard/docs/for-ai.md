# For AI Agents — Orchestrator Leaderboard Plugin

> Audience: AI coding agents (Claude, Codex, Cursor, Copilot, Gemini, etc.) that
> need to **integrate with** the NaaP Orchestrator Leaderboard API
> programmatically. Optimised for token efficiency, accuracy, and "do the right
> thing without searching the codebase".
>
> If you are a human, prefer [`how-to-guide.md`](./how-to-guide.md). If you need
> the machine contract, use [`openapi.yaml`](./openapi.yaml).

---

## TL;DR — what this plugin does

Discover the **best Livepeer orchestrators** for a workload. The integration is
**plan-driven**:

```
build a plan (JSON)  →  POST /plans  →  GET /plans/{id}/results  →  use orchUri[]
```

A *plan* is a persisted selection policy (capabilities + filters + SLA weights).
*Results* are the latest ranked orchestrator URLs evaluated against the global
dataset, lazily refreshed and server-cached.

---

## Hard rules (do not violate)

1. **Auth is required on every endpoint.** Use `Authorization: Bearer <token>`
   where `<token>` is either a NaaP JWT *or* a Service Gateway API key
   (`gw_…`). External integrations should use `gw_…` keys.
2. **`billingPlanId` is globally unique and immutable.** `POST /plans` with a
   duplicate returns `400`. Use the upsert pattern below.
3. **Response envelope is `{ success, data, error? }`.** For
   `/plans/{id}/results` the payload is **double-nested**:
   `body.data.data.capabilities[<cap>][]`. This is intentional, not a bug.
4. **Plan results are scoped to the caller** (`teamId` + `ownerUserId`).
   Cross-team reads return `404`, never the plan.
5. **Do not poll faster than every 10 seconds per process.** Honour
   `Cache-Control: max-age=10` and the response `meta.refreshIntervalMs`.
6. **Disabled plans return `400 Plan is disabled`** on `/results`. Re-enable
   via `PUT /plans/{id}` with `{ "enabled": true }`.
7. **`capability` strings must match `^[a-zA-Z0-9_-]+$`** and be ≤ 128 chars.
   Always validate against `GET /filters` before creating a plan.
8. **Never call `/plans/refresh` from app code.** It is `CRON_SECRET`-only and
   used by Vercel Cron. Use `/plans/{id}/results` (lazy refresh) instead.

---

## Endpoint cheat-sheet (copy into your context)

Base path: `/api/v1/orchestrator-leaderboard`. Full host comes from the user
(`NAAP_API_URL`, e.g. `https://app.naap.io`).

| Verb     | Path                          | Auth                    | Use it for                                      |
| -------- | ----------------------------- | ----------------------- | ----------------------------------------------- |
| `GET`    | `/filters`                    | JWT or `gw_`            | List warm capabilities (validate plan inputs).  |
| `POST`   | `/plans`                      | JWT or `gw_`            | **Create** a plan. Returns the plan with `id`.  |
| `GET`    | `/plans`                      | JWT or `gw_`            | List caller's plans (for upsert lookup).        |
| `GET`    | `/plans/{id}`                 | JWT or `gw_`            | Read one plan.                                  |
| `PUT`    | `/plans/{id}`                 | JWT or `gw_`            | Partial update (incl. `enabled`).               |
| `DELETE` | `/plans/{id}`                 | JWT or `gw_`            | Permanently delete.                             |
| `GET`    | `/plans/{id}/results`         | JWT or `gw_`            | **Poll** ranked orchestrator URLs.              |
| `POST`   | `/plans/seed`                 | JWT or `gw_`            | Seed 4 demo plans (idempotent). Onboarding.     |
| `POST`   | `/rank`                       | JWT or `gw_`            | Stateless 1-capability rank (avoid in runtime). |
| `GET`    | `/dataset`                    | JWT or `gw_`            | Cached global dataset snapshot.                 |
| `GET`    | `/dataset/config`             | JWT or `gw_`            | Read refresh interval.                          |
| `PUT`    | `/dataset/config`             | JWT (`system:admin`)    | Set refresh interval (1, 4, 8, or 12 hours).    |
| `POST`   | `/dataset/refresh`            | JWT admin / CRON_SECRET | Force global refresh (admin only).              |
| `POST`   | `/plans/refresh`              | CRON_SECRET             | Cron-only bulk refresh. **Never call.**         |
| `GET`    | `/sources`                    | JWT or `gw_`            | List data source priority & status.             |
| `PUT`    | `/sources`                    | JWT (`system:admin`)    | Reorder / enable / disable data sources.        |
| `GET`    | `/audits`                     | JWT or `gw_`            | Recent refresh audit log.                       |

---

## Decision tree

```
Need ranked orchestrator URLs in an SDK / signer?
└── YES → use Discovery Plans:
          1. validate capabilities via GET /filters
          2. upsertPlan() (POST or PUT)
          3. pollResults() with backoff ≥ 10s

Need a one-off ad-hoc query (dashboard / debugging)?
└── YES → POST /rank with capability + optional filters/slaWeights
          (do NOT use this in a runtime loop)

Need to know what capabilities exist?
└── GET /filters

Need to inspect every capability + every orchestrator?
└── GET /dataset

Building admin tooling?
└── /dataset/config (read = any auth, write = admin)
└── /dataset/refresh (admin)
└── /sources (read = any auth, write = admin)
└── /audits (read = any auth)
```

---

## Schemas (canonical, copy-pastable)

### `CreatePlanInput` — request body for `POST /plans`

```ts
type CreatePlanInput = {
  /** Globally unique. Immutable. Use a stable slug or your billing SKU. */
  billingPlanId: string;            // 1..255
  name: string;                     // 1..255
  description?: string;             // ≤ 1000
  /** 1..50 items, each `^[a-zA-Z0-9_-]+$`, ≤ 128 chars. */
  capabilities: string[];
  topN?: number;                    // 1..1000, default 10
  sortBy?: 'slaScore' | 'latency' | 'price' | 'swapRate' | 'avail';
  /** Drop rows whose computed SLA is below this. Use with `slaWeights`. */
  slaMinScore?: number;             // 0..1
  /** Weights are normalised internally; need not sum to 1. */
  slaWeights?: {
    latency?: number;               // 0..1, default 0.4
    swapRate?: number;              // 0..1, default 0.3
    price?: number;                 // 0..1, default 0.3
  };
  /** Hard filters applied before ranking. */
  filters?: {
    gpuRamGbMin?: number;           // ≥ 0
    gpuRamGbMax?: number;           // ≥ 0
    priceMax?: number;              // ≥ 0
    maxAvgLatencyMs?: number;       // ≥ 0
    maxSwapRatio?: number;          // 0..1
  };
};
```

### `UpdatePlanInput` — request body for `PUT /plans/{id}`

Identical to `CreatePlanInput` **without** `billingPlanId`, plus an `enabled`
boolean. All fields optional.

### `DiscoveryPlan` — response shape

```ts
type DiscoveryPlan = CreatePlanInput & {
  id: string;                       // CUID/UUID
  teamId: string | null;
  ownerUserId: string | null;
  enabled: boolean;
  createdAt: string;                // ISO 8601
  updatedAt: string;                // ISO 8601
};
```

### `OrchestratorRow` — element inside results

```ts
type OrchestratorRow = {
  orchUri: string;                  // <-- this is what your SDK dials
  gpuName: string;
  gpuGb: number;
  avail: number;
  totalCap: number;
  pricePerUnit: number;
  bestLatMs: number | null;
  avgLatMs: number | null;
  swapRatio: number | null;         // 0..1, lower is better
  avgAvail: number | null;
  slaScore?: number;                // 0..1, present iff slaWeights configured
};
```

### `PlanResults` — response shape from `/plans/{id}/results`

```ts
type PlanResults = {
  planId: string;
  refreshedAt: string;              // ISO 8601
  capabilities: Record<string, OrchestratorRow[]>;  // already sorted + capped
  plan?: { name: string; description: string | null; capabilities: string[]; topN: number };
  meta: {
    totalOrchestrators: number;
    refreshIntervalMs: number;      // honour this when scheduling polls
    cacheAgeMs: number;
  };
};
```

### Response envelopes

```ts
// success
{ "success": true, "data": <T> }

// error
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND"
          | "UPSTREAM_ERROR" | "GATEWAY_TIMEOUT" | "INTERNAL_ERROR",
    "message": string
  }
}

// /plans/{id}/results is double-wrapped:
{ "success": true, "data": { "data": PlanResults } }
```

---

## Reference implementation (TypeScript, copy-paste safe)

This is the **authoritative pattern**. Reuse it verbatim; don't invent
variations unless the user asks.

```ts
const BASE = `${process.env.NAAP_API_URL}/api/v1/orchestrator-leaderboard`;
const auth = { Authorization: `Bearer ${process.env.NAAP_API_KEY!}` };

type Json = Record<string, unknown>;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...auth, 'Content-Type': 'application/json', ...init.headers },
  });
  const env = (await res.json()) as { success: boolean; data?: T; error?: { code: string; message: string } };
  if (!res.ok || !env.success) {
    const code = env.error?.code ?? `HTTP_${res.status}`;
    throw new Error(`[${code}] ${env.error?.message ?? res.statusText}`);
  }
  return env.data as T;
}

// 1. Validate capabilities exist.
async function listCapabilities(): Promise<string[]> {
  const data = await call<{ capabilities: string[] }>('/filters');
  return data.capabilities;
}

// 2. Idempotent upsert keyed by billingPlanId.
async function upsertPlan(input: CreatePlanInput): Promise<DiscoveryPlan> {
  const list = await call<{ plans: DiscoveryPlan[] }>('/plans');
  const existing = list.plans.find((p) => p.billingPlanId === input.billingPlanId);
  if (!existing) {
    return call<DiscoveryPlan>('/plans', { method: 'POST', body: JSON.stringify(input) });
  }
  const { billingPlanId: _omit, ...patch } = input;
  const out = await call<{ plan: DiscoveryPlan }>(`/plans/${existing.id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...patch, enabled: true }),
  });
  return out.plan;
}

// 3. Poll results (handles the double-nested envelope).
async function getResults(planId: string): Promise<PlanResults> {
  const out = await call<{ data: PlanResults }>(`/plans/${planId}/results`);
  return out.data;
}

// 4. Pick orchestrator URLs for a single capability.
function pickUrls(results: PlanResults, capability: string): string[] {
  return (results.capabilities[capability] ?? []).map((r) => r.orchUri);
}
```

### Polling loop with backoff

```ts
async function pollLoop(planId: string, capability: string, onUrls: (u: string[]) => void) {
  let intervalMs = 30_000; // sane default
  let consecutiveFailures = 0;
  while (true) {
    try {
      const results = await getResults(planId);
      onUrls(pickUrls(results, capability));
      // Respect server-side cadence; never poll faster than 10s.
      intervalMs = Math.max(10_000, results.meta.refreshIntervalMs / 2);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      // Exponential backoff capped at 5 minutes.
      intervalMs = Math.min(300_000, 5_000 * 2 ** consecutiveFailures);
      console.warn(`[leaderboard] poll failed (${consecutiveFailures}):`, err);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
```

---

## Common pitfalls (and how to avoid them)

| Pitfall                                                                   | Fix                                                                          |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Hard-coding capability strings that aren't warm.                          | Validate against `GET /filters` and warn on missing.                         |
| Using `POST /plans` on every restart and getting 400s.                    | Implement `upsertPlan()` (list → find → POST or PUT).                        |
| Reading `body.data.capabilities` on `/results` and getting `undefined`.   | Path is `body.data.data.capabilities` — double `.data`.                      |
| Including `billingPlanId` in `PUT` body.                                  | It's immutable; strip it. Server may 400 or silently ignore.                 |
| Polling once per second.                                                  | Honour `Cache-Control: max-age=10` and `meta.refreshIntervalMs`.             |
| Using `POST /rank` in a runtime loop.                                     | Stateless, less cacheable, less auditable. Use plans instead.                |
| Treating `slaScore` as always present.                                    | Only present when `slaWeights` is set. Guard with `?.toFixed(...)`.          |
| Calling `/plans/refresh` from app code.                                   | That route is CRON_SECRET-only. Use `/plans/{id}/results` for lazy refresh.  |
| Setting `slaWeights` that sum to > 1 and assuming weighting is broken.    | Weights are normalised internally — any positive numbers in `[0,1]` are OK.  |
| Forgetting to set `enabled: true` after disabling.                        | Disabled plans return 400 on `/results`.                                     |
| Treating cross-team 404s as "plan deleted".                               | 404 also means "not visible to caller". Re-check `billingPlanId` ownership.  |

---

## Errors → recovery actions

| Status | `code`               | Recovery                                                                |
| ------ | -------------------- | ----------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`   | Inspect `error.message`, fix the offending field, retry.                |
| 400    | (`Plan is disabled`) | `PUT /plans/{id} { "enabled": true }` then retry `/results`.            |
| 400    | (duplicate billing)  | Switch to `upsertPlan()`; do not retry the POST.                        |
| 401    | `UNAUTHORIZED`       | Token missing/expired/invalid. Refresh JWT or rotate API key.           |
| 403    | `FORBIDDEN`          | Caller lacks `system:admin`. Use a different endpoint or escalate.      |
| 404    | `NOT_FOUND`          | Plan id wrong, deleted, or owned by another team. Do **not** retry.     |
| 502    | `UPSTREAM_ERROR`     | ClickHouse/gateway down. Retry with exponential backoff (rank only).    |
| 504    | `GATEWAY_TIMEOUT`    | Query > 15 s. Reduce `topN`, narrow filters, retry once.                |
| 5xx    | `INTERNAL_ERROR`     | Transient. Backoff + retry; raise an issue if persistent.               |

---

## Configuration sources

What an agent should ask the user (or read from env) before doing anything:

| Variable          | Required | Where it comes from                                |
| ----------------- | -------- | -------------------------------------------------- |
| `NAAP_API_URL`    | yes      | NaaP deployment host (e.g. `https://app.naap.io`). |
| `NAAP_API_KEY`    | yes      | NaaP dashboard → **Service Gateway → API Keys**.   |
| `NAAP_PLAN_ID`    | optional | Returned by `POST /plans`; persist after creation. |

Never write secrets into source files. Read from `process.env`, a `.env`,
or the platform's secret manager.

---

## Worked example — full agent task

**User goal**: "Always send my image generation jobs to the top-5 best-stable
orchestrators with at least 16 GB VRAM."

**Agent steps**:

1. Read `NAAP_API_URL`, `NAAP_API_KEY`. If missing, ask the user.
2. `GET /filters` → confirm `text-to-image` is in the list.
3. Build plan:

   ```json
   {
     "billingPlanId": "user-image-gen-stable",
     "name": "Image Gen — stable",
     "capabilities": ["text-to-image"],
     "topN": 5,
     "sortBy": "slaScore",
     "slaMinScore": 0.6,
     "slaWeights": { "latency": 0.3, "swapRate": 0.5, "price": 0.2 },
     "filters": { "gpuRamGbMin": 16, "maxSwapRatio": 0.2 }
   }
   ```

4. `upsertPlan()` → store the returned `id` (e.g. `NAAP_PLAN_ID`).
5. Wire the SDK / signer:
   - `ORCHESTRATOR_DISCOVERY_URL = ${NAAP_API_URL}/api/v1/orchestrator-leaderboard/plans/${id}/results`
   - `ORCHESTRATOR_DISCOVERY_AUTH = Bearer ${NAAP_API_KEY}`
6. (Optional) Add a healthcheck step that polls `/results` and verifies
   `capabilities['text-to-image'].length > 0` once on startup.

---

## Data sources & audit (admin)

The leaderboard refreshes from **4 pluggable data sources** with configurable
priority. The highest-priority enabled source **owns orchestrator membership**
(defines who is in the set). Lower-priority sources only contribute metric
fields. After each refresh, an audit log records per-source stats, field-level
conflicts, and dropped orchestrators.

### Default source priority

| Priority | Kind                | Owns membership? | Key fields |
| -------- | ------------------- | ---------------- | ---------- |
| 1        | `livepeer-subgraph` | yes              | `ethAddress`, `orchUri`, activation |
| 2        | `clickhouse-query`  | no               | latency, GPU, swap ratio, availability |
| 3        | `naap-discover`     | no               | capabilities, score, liveness |
| 4        | `naap-pricing`      | no               | `pricePerUnit` |

### Endpoints for source management

| Verb  | Path       | Auth                 | Purpose |
| ----- | ---------- | -------------------- | ------- |
| `GET` | `/sources` | JWT or `gw_`         | List enabled/disabled sources with priority |
| `PUT` | `/sources` | JWT (`system:admin`) | Reorder / enable / disable sources |
| `GET` | `/audits`  | JWT or `gw_`         | Recent refresh audit log (`?limit=N&cursor=…`) |

### Agent checklist for source configuration

1. `GET /sources` to see current order.
2. To disable a source: `PUT /sources` with `enabled: false` for that kind.
3. To change priority: `PUT /sources` with updated `priority` values.
4. After changes, trigger `POST /dataset/refresh` (admin) and check
   `GET /audits` to verify the new pipeline produces the expected dataset.

### Audit record shape

```ts
type RefreshAudit = {
  id: string;
  refreshedAt: string;
  refreshedBy: string;     // 'cron' | 'admin:<userId>'
  durationMs: number;
  membershipSource: string;
  totalOrchestrators: number;
  totalCapabilities: number;
  perSource: Record<string, { ok: boolean; fetched: number; durationMs: number; errorMessage?: string }>;
  conflicts: Array<{ orchKey: string; field: string; winner: string; losers: Array<{ source: string; value: unknown }> }>;
  dropped: Array<{ orchKey: string; source: string; reason: string }>;
  warnings: string[];
};
```

---

## When NOT to use this plugin

- For *real-time* per-request orchestrator selection at sub-second latency:
  cache results in your runtime; don't call `/results` per request.
- For non-Livepeer orchestrator networks: this plugin only ranks orchestrators
  ingested into the NaaP global dataset.
- For *creating* orchestrators or capabilities: this is read-only ranking. Use
  the relevant gateway/operator tooling instead.

---

## Related references

- Machine contract — [`openapi.yaml`](./openapi.yaml) (use to generate clients).
- Human reference — [`api-reference.md`](./api-reference.md).
- Human playbook — [`how-to-guide.md`](./how-to-guide.md).
- Reference clients — [`../examples/client-test.ts`](../examples/client-test.ts),
  [`../examples/client-test.sh`](../examples/client-test.sh).
- Plugin manifest — [`../plugin.json`](../plugin.json).

---

## Stable invariants this doc relies on

If any of the following ever changes, this doc is stale and the agent should
re-read [`openapi.yaml`](./openapi.yaml):

- Base path `/api/v1/orchestrator-leaderboard`.
- Auth scheme = `Authorization: Bearer …`.
- Envelope = `{ success, data, error? }`.
- `/plans/{id}/results` payload is double-nested.
- `billingPlanId` immutable; uniqueness enforced platform-wide.
- Plan scoping by `(teamId, ownerUserId)`.
- Refresh-interval enum = `[1, 4, 8, 12]` hours.
- Data source kinds = `livepeer-subgraph`, `clickhouse-query`, `naap-discover`, `naap-pricing`.
- Membership owned by the highest-priority enabled source.
- Hybrid conflict resolution: source-level membership, field-level metric priority.
