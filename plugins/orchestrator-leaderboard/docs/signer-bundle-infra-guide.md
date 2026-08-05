# For AI Agents — Signer Bundle Discovery (Daydream vs pymthouse)

> Audience: AI coding / ops agents configuring infra so a **Daydream remote signer**
> or a **pymthouse remote signer** dials the correct orchestrator plane.
>
> Humans: open [`signer-bundle-infra-guide.html`](./signer-bundle-infra-guide.html).
> Broader leaderboard API: [`for-ai.md`](./for-ai.md).

---

## TL;DR

Pick the discovery URL by **signer plane**. NaaP does not auto-detect the signer.

Two equivalent ways (same shortlist):

1. **Public Discovery Plans** (recommended — show up at `/orchestrator-leaderboard/plans`):
   - Daydream → plan `naap-default-daydream-byoc` → `/plans/{id}/python-gateway`
   - pymthouse → plan `naap-default-pymthouse-live-runner` → `/plans/{id}/python-gateway`
2. **Bundle aliases** (flag-gated):
   - `…/bundles/daydream-byoc/python-gateway`
   - `…/bundles/pymthouse-live-runner/python-gateway`

| Signer | Plan `billingPlanId` | Bundle slug | Orchs returned |
| --- | --- | --- | --- |
| **Daydream** remote signer | `naap-default-daydream-byoc` | `daydream-byoc` | BYOC + tool hosts |
| **pymthouse** remote signer | `naap-default-pymthouse-live-runner` | `pymthouse-live-runner` | Live Runner host |

Plans are seeded on deploy (`bin/seed-discovery-plans.ts`) as `visibility: public`.

Response shape (unchanged BPP discovery):

```json
[{ "address": "https://byoc-staging-1.daydream.monster:8935" }]
```

---

## Hard rules

1. **Master flag must be ON** on the NaaP deployment: `SIGNER_BUNDLE_DISCOVERY_ENABLED=true` (or `1`). Default OFF → endpoints return **404**.
2. **Auth required** on both endpoints: `Authorization: Bearer gw_…` (or NaaP session JWT).
3. **Do not mix planes.** Daydream signer + LR discovery (or pymthouse + BYOC discovery) is a misconfig.
4. **Do not change** legacy routes unless asked: `/python-gateway`, `/plans/{id}/python-gateway`, `/storyboard-default/python-gateway`.
5. **Payment type is not chosen by discovery.** Discovery only returns orch addresses. Signer hostname still drives `lv2v` vs `byoc` payment shape upstream.
6. **Never invent new slugs.** Only `daydream-byoc` and `pymthouse-live-runner`.

---

## Decision tree

```
Which remote signer does this node use?
├── Daydream (e.g. signer.daydream.live)
│     → DISCOVERY_URL = …/bundles/daydream-byoc/python-gateway
│     → expect addresses ⊇ byoc-staging-* / tool-staging-*
└── pymthouse per-key DMZ signer
      → DISCOVERY_URL = …/bundles/pymthouse-live-runner/python-gateway
      → expect addresses ⊇ liverunner-staging-*
```

---

## NaaP (platform) config

### Required env (Vercel / host)

```bash
SIGNER_BUNDLE_DISCOVERY_ENABLED=true
```

### Optional env hotfix (JSON overrides, wins over DB)

```bash
SIGNER_BUNDLE_OVERRIDES='{"bundles":[{"slug":"pymthouse-live-runner","topN":50}]}'
```

### Admin API (optional — persist overrides)

```bash
# List resolved bundles (admin JWT)
curl -sS -H "Authorization: Bearer $NAAP_ADMIN_JWT" \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/bundles/config"

# Patch one bundle
curl -sS -X PUT -H "Authorization: Bearer $NAAP_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"bundles":[{"slug":"daydream-byoc","topN":100,"enabled":true}]}' \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/bundles/config"
```

Defaults (when no override):

| Slug | `billingProviderSlug` | Categories | Static fleet (staging baseline) |
| --- | --- | --- | --- |
| `daydream-byoc` | `daydream` | `byoc`, `tool` | `https://byoc-staging-1.daydream.monster:8935`, `https://tool-staging-1.daydream.monster:8935` |
| `pymthouse-live-runner` | `pymthouse` | `lr` | `https://liverunner-staging-1.daydream.monster:8935` |

---

## Resolve plan id (once)

```bash
# List public plans; grab id for the signer plane you need
curl -sS -H "Authorization: Bearer $NAAP_API_KEY" \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/plans" \
  | jq '.data.plans[] | select(.billingPlanId|startswith("naap-default-")) | {billingPlanId,id,name}'
```

---

## Daydream signer path — copy/paste

```bash
export NAAP_API_URL=https://app.naap.io   # or your NaaP origin
export NAAP_API_KEY=gw_xxxxxxxx

# Prefer plan URL (visible in UI at /orchestrator-leaderboard/plans)
export PLAN_ID=$(curl -sS -H "Authorization: Bearer $NAAP_API_KEY" \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/plans" \
  | jq -r '.data.plans[] | select(.billingPlanId=="naap-default-daydream-byoc") | .id')

export DISCOVERY_URL="$NAAP_API_URL/api/v1/orchestrator-leaderboard/plans/$PLAN_ID/python-gateway"
# Equivalent alias (needs SIGNER_BUNDLE_DISCOVERY_ENABLED=true):
# export DISCOVERY_URL="$NAAP_API_URL/api/v1/orchestrator-leaderboard/bundles/daydream-byoc/python-gateway"

# Smoke test
curl -sS -H "Authorization: Bearer $NAAP_API_KEY" "$DISCOVERY_URL" | jq .
# Expect: [{ "address": "https://byoc-staging-1…" }, { "address": "https://tool-staging-1…" }, …]
# Header: X-Discovery-Bundle: daydream-byoc
```

Wire `DISCOVERY_URL` into the SDK node / python-gateway env that talks to the **Daydream** signer. Do **not** point that node at the Live Runner plan.

---

## pymthouse signer path — copy/paste

```bash
export NAAP_API_URL=https://app.naap.io
export NAAP_API_KEY=gw_xxxxxxxx

export PLAN_ID=$(curl -sS -H "Authorization: Bearer $NAAP_API_KEY" \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/plans" \
  | jq -r '.data.plans[] | select(.billingPlanId=="naap-default-pymthouse-live-runner") | .id')

export DISCOVERY_URL="$NAAP_API_URL/api/v1/orchestrator-leaderboard/plans/$PLAN_ID/python-gateway"
# Equivalent alias (needs SIGNER_BUNDLE_DISCOVERY_ENABLED=true):
# export DISCOVERY_URL="$NAAP_API_URL/api/v1/orchestrator-leaderboard/bundles/pymthouse-live-runner/python-gateway"

# Smoke test
curl -sS -H "Authorization: Bearer $NAAP_API_KEY" "$DISCOVERY_URL" | jq .
# Expect: [{ "address": "https://liverunner-staging-1…" }, …]
# Header: X-Discovery-Bundle: pymthouse-live-runner
```

Wire this `DISCOVERY_URL` into the SDK node that uses **pymthouse** `SIGNER_FROM_VALIDATE` / per-key DMZ signer. Do **not** point that node at the Daydream BYOC plan.

---

## Optional query params

| Param | Example | Effect |
| --- | --- | --- |
| `caps` | `?caps=flux-dev` or `?caps=text-to-image/flux-dev` | Filter to one capability (repeatable) |
| `capability` / `model` | `?model=flux-dev` | Same as single `caps` |
| `topN` | `?topN=10` | Cap list length (1..1000) |

---

## Verify isolation (must pass)

```bash
DAY=$(curl -sS -H "Authorization: Bearer $NAAP_API_KEY" \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/bundles/daydream-byoc/python-gateway")
LR=$(curl -sS -H "Authorization: Bearer $NAAP_API_KEY" \
  "$NAAP_API_URL/api/v1/orchestrator-leaderboard/bundles/pymthouse-live-runner/python-gateway")

echo "$DAY" | jq -e 'map(.address) | any(test("byoc|tool"))' >/dev/null
echo "$LR"  | jq -e 'map(.address) | any(test("liverunner"))' >/dev/null
# Cross-contamination check: no shared addresses
comm -12 \
  <(echo "$DAY" | jq -r '.[].address' | sort) \
  <(echo "$LR"  | jq -r '.[].address' | sort) | wc -l   # expect 0
```

---

## Failure modes (agent checklist)

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `404 Not found` | Flag OFF | Set `SIGNER_BUNDLE_DISCOVERY_ENABLED=true` and redeploy |
| `401 Unauthorized` | Missing/invalid `gw_` / JWT | Mint Service Gateway key; pass `Authorization` |
| `[]` empty array | Caps filtered (pymthouse manifest) or bundle `enabled:false` | Check admin config + manifest; confirm static fleet still expected |
| Wrong orch plane | `DISCOVERY_URL` points at the other slug | Swap to the table in TL;DR |
| Still hitting old discovery | Node env not updated | Grep for `DISCOVERY_URL` / `discovery.url` in the node deploy |

---

## What NOT to change

- Do not edit `storyboard-default` flatten bundle for this wiring.
- Do not add Storyboard / Livepeer Agent code for MVP — env on the SDK node is enough.
- Do not call `/plans/refresh` or crawl `{orch}/discovery` from agents.

---

## Source map (repo)

| Concern | Path |
| --- | --- |
| Types / flag | `apps/web-next/src/lib/orchestrator-leaderboard/signer-bundle-types.ts` |
| Defaults | `…/signer-bundle-defaults.ts` |
| Config merge (DB + env) | `…/signer-bundle-config.ts` |
| Builder | `…/signer-bundle-discovery.ts` |
| Route | `apps/web-next/src/app/api/v1/orchestrator-leaderboard/bundles/[slug]/python-gateway/route.ts` |
| Admin config | `…/bundles/config/route.ts` |
| Human HTML guide | `plugins/orchestrator-leaderboard/docs/signer-bundle-infra-guide.html` |
