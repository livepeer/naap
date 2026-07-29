# LR v1 Tool-Cap Migration & `:8935` Retire — EXECUTION REPORT

**Status:** EXECUTED (additive + reversible). **Date:** 2026-07-28 · **Author:** seanhanca
**VM:** `liverunner-staging-1` (GCP `livepeer-simple-infra`, `us-west1-b`, IP `136.66.21.17`)
**Plan:** [`LR-V1-TOOLCAP-MIGRATION-PLAN.md`](./LR-V1-TOOLCAP-MIGRATION-PLAN.md)

> **SAFETY RAIL #0 — `byoc-staging-1` was NEVER touched, read, or referenced as a target.**
> `tool-staging-1` (yolo/obscura/etc.) was also left untouched.

## TL;DR

- **All 5 tool caps migrated** onto the clean v0.9.0 orch `liverunner-v09-orch` (`:8936`) as per-verb
  static Live-Runner runners, priced, healthy, and advertised in `/discovery`.
- **v1 `:8935` (`liverunner-orch`) is RETIRED** — `docker stop`ped (Exited 0), config + images kept
  on disk (restorable with `docker start`). Only **ONE** live-runner orch (`:8936`) now serves.
- **Public serviceURI hostname** `liverunner-staging-1.daydream.monster` repointed (Caddy) from
  `:8935` → `:8936` — **no on-chain tx, no gas.**
- **Routing verified as far as auth/dispatch allows:** every tool runner reaches the v09 native
  payment layer (HTTP 402); a direct app smoke (blender procedural) returned a real render URL
  (HTTP 200). Full metered generation is gated on the **payment-signer** fix — the *same* gap that
  gates the 8 fal caps, owned by the signer worker (not this migration).

---

## Step 1 — Provisional prices (registry `display_price_usd`)

Edited `storyboard-pricing/lib/capabilities/registry.json` (branch
`feat/pricing-discovery-registry-parity`). The 2 already-priced ffmpeg caps are unchanged. The 3
null-priced caps got **PROVISIONAL** USD prices (flagged for storyboard-pricing to confirm):

| cap | `display_price_usd` | `unit_kind` | basis |
|---|---|---|---|
| `ffmpeg-concat` | **$0.00013** (unchanged) | call | existing |
| `ffmpeg-export` | **$0.00026** (unchanged) | call | existing |
| `ffmpeg-trim` | **$0.00007** ⚠️ PROVISIONAL | call | compute-time: p50≈6s at ≈$1.19e-5/s derived from concat/export; cheapest ffmpeg verb (pure stream-copy) |
| `hyperframes-render` | **$0.0003** ⚠️ PROVISIONAL | call | parity-above ffmpeg-export ($0.00026) — HTML→video render+encode |
| `blender-headless` | **$0.002** ⚠️ PROVISIONAL | call | compute-heavy headless 3D render; ≈parity with a mid image-gen cap (gpt-image $0.0022) |

`blender-headless` identity kept as `kind:ai, modality:tool, family:blender, variant:headless`
(`ai:tool:blender:headless`) so it dedups to ADD-CAPACITY (not a synonym).

> ⚠️ **The 3 prices above are PROVISIONAL** — owner **storyboard-pricing** to confirm/replace.

## Step 2 — Per-verb static runners in `runners.json`

Added 5 entries to `live-runner-v2/runners.json` (NaaP repo, branch `docs/pricing-scope-simplified`),
each an embedded Storyboard capability descriptor (single source of truth) + derived native
`price_info:{price,currency:"usd",unit:"fixed"}`, `mode:"single-shot"`, `endpoint:"/run"`,
`health_url`, and a **constant-verb** `default` in `io.inputs`. The 3 ffmpeg verbs share one
`app:"storyboard/ffmpeg-app"` (`http://ffmpeg-app:8991`) with distinct constant verbs.

WEI `price_per_unit` derived with the same ETH reference the committed fal caps use
(`K = 4.07647199e14 WEI/USD`, `pixels_per_unit=1048576`, `quantity_source=const_1`):
`concat 52994135883 · trim 28535303937 · export 105988271766 · hyperframes 122294159730 · blender 815294398200`.

**Validation** (the exact `validateDescriptor` + `planDiscoverySync` discovery-sync uses):

```
STORYBOARD_CAPS=$PWD/lib/capabilities RUNNERS_JSON=…/live-runner-v2/runners.json \
  npx tsx …/live-runner-v2/scripts/lr-gen-runners.mjs
→ SYNC PLAN: 0 REGISTER, 13 ADD-CAPACITY, 0 SYNONYM-SKIP, 0 invalid/failed
  ✓ ffmpeg-concat / ffmpeg-trim / ffmpeg-export / hyperframes-render / blender-headless: ADD-CAPACITY
```

**✅ Checkpoint 2:** all 5 tool caps ADD-CAPACITY, 0 SYNONYM, 0 invalid.

## Step 3 — InputSpec.default verb-injection dispatch check  ⚠️ FINDING

**The dispatch layer does NOT honor the descriptor's `InputSpec.default`.** Details:

- `run_capability` (storyboard MCP) → SDK `POST /inference` → `_dispatch_lr_v2`
  (`simple-infra/sdk-service-build/app.py`) → `build_lr_payload` (`lr_offerings.py`).
- `build_lr_payload` builds the runner wire body from a **separate** offering table
  (`LR_OFFERINGS_JSON` env: `app`/`endpoint`/`model_id`/`defaults`/`input_map`), **not** from the
  Storyboard `capability.io.inputs` descriptor. The descriptor's `io.inputs[].default` only feeds
  `synthesizeUsage` (the `describe_capability` card / example args), **not** the wire dispatch.
- **Minimal fix = CONFIG, no code change.** `build_lr_payload` already injects constants via the
  offering's `defaults` map (`out.setdefault(key,value)`). So a per-verb tool cap routes correctly
  once its `LR_OFFERINGS_JSON` entry carries `defaults:{verb:"…"}` + `endpoint:"/run"` + the right
  `app`. `_dispatch_lr_v2` also filters discovery to `mode=="single-shot"` → our runners are
  single-shot (satisfied). Native base-url is `…/apps/<runner>/app` + `endpoint` → `/app/run`
  (the orch app-proxy forwards the subpath, same mechanism as fal's `/app/generate`).

**Exact `LR_OFFERINGS_JSON` additions required to route these 5 caps to v09** (owner to apply):

```json
{
  "ffmpeg-concat":{"app":"storyboard/ffmpeg-app","endpoint":"/run","mode":"single-shot","defaults":{"verb":"concat"},"input_map":{"inputs":"source_urls"}},
  "ffmpeg-trim":{"app":"storyboard/ffmpeg-app","endpoint":"/run","mode":"single-shot","defaults":{"verb":"trim"},"input_map":{"source_url":"source_url","start":"start","duration":"duration"}},
  "ffmpeg-export":{"app":"storyboard/ffmpeg-app","endpoint":"/run","mode":"single-shot","defaults":{"verb":"export"},"input_map":{"width":"width","height":"height"}},
  "hyperframes-render":{"app":"storyboard/hyperframes-app","endpoint":"/run","mode":"single-shot","defaults":{"verb":"render"},"input_map":{"html":"html","fps":"fps","duration":"duration","width":"width","height":"height"}},
  "blender-headless":{"app":"storyboard/blender-app","endpoint":"/run","mode":"single-shot","defaults":{"verb":"render"},"input_map":{"blend_url":"source_url","frame":"frame"}}
}
```

> **OWNER GAP (gateway/SDK — John):** applying the above is on the **shared** `sdk-staging-1` service
> (`LR_OFFERINGS_JSON` + adding the caps to `SELECT_PROVIDER_LR_CAPS`). Per `LR-NATIVE-DISPATCH.md`,
> changing the shared SDK env affects other consumers → **owner approval required**, so it was NOT
> applied here. No code change is needed — this is config only. **Also note:** these 5 caps route to
> **`tool-host` (tool-staging-1)** today (`orch-map.reference.json`), so making the agent prefer v09
> for them is this same owner-gated config change.

## Step 4 — Tool-app containers reachable on the v09 network

The 3 tool apps were on `live-runner_default` only. Connected each to `live-runner-v2_default`
**with the compose alias** (default alias would be the container name, which the static
`runner_url` does not use):

```
docker network connect --alias ffmpeg-app      live-runner-v2_default liverunner-ffmpeg-app
docker network connect --alias blender-app     live-runner-v2_default liverunner-blender-app
docker network connect --alias hyperframes-app live-runner-v2_default liverunner-hyperframes-app
```

Chosen: keep the tool apps as **persistent containers** (long-running) but authored the runner
`mode` as **single-shot** (each `/run` = one synchronous job → matches the 8 fal caps AND is required
by `_dispatch_lr_v2`'s single-shot discovery filter). Reachability verified from the v09 network —
all 3 `/health` returned `{"status":"ok"}`. **✅ Checkpoint 3.**

## Step 5 — Redeploy v09 additively

**File-path gotcha (fixed):** the VM `docker-compose.v09.yml` mounts **`./runners.v09.json`** (the
repo copy mounts `./runners.json` — a drift, see Open Items). The augmented 13-runner file was
written to `~/live-runner-v2/runners.v09.json` (old 8-cap file backed up), then:

```
docker compose -f docker-compose.v09.yml up -d --force-recreate orchestrator-v09
→ "Registered 13 static live runners from /etc/livepeer/runners.json"  (all healthy=true)
```

`/discovery` on `:8936` (v1 still up at this point) — **13 runners, each priced non-zero WEI**:

| app | runners | example WEI price |
|---|---|---|
| 8× `storyboard/fal-*` | 8 | flux-schnell 1641836036628 |
| `storyboard/ffmpeg-app` | 3 (concat/trim/export) | 67758312622 / 36485245258 / 135516625245 |
| `storyboard/hyperframes-app` | 1 | 156365336821 |
| `storyboard/blender-app` | 1 | 1042435578811 |

WEI ratios match the USD ratios exactly (e.g. export 0.00026 = 2× concat 0.00013).
**✅ Checkpoint 4/5:** v09 shows 8 fal + 5 tool priced; v1 still healthy at this stage.

## Step 6 — Register (ADD-CAPACITY) + MCP

- **ADD-CAPACITY proof:** the generator runs the exact pure `planDiscoverySync` planner against the
  committed registry → **13 ADD-CAPACITY, 0 SYNONYM, 0 invalid** (Step 2). For ADD-CAPACITY the sync
  makes **no registry write** (offering-only; the identities already exist as `status:active`), so
  `applyDiscoverySync` is a registry no-op here — the value delivered is the v09 `/discovery`
  offering (Step 5).
- **MCP `list_capabilities` (kind=tool):** all 5 live — `ffmpeg-concat`, `ffmpeg-trim`,
  `ffmpeg-export`, `hyperframes-render`, `blender-headless`. (MCP reads the deployed registry; the 3
  provisional prices are in the storyboard-pricing branch and reflect once that PR deploys.)

**✅ Checkpoint 5.**

## Step 7 — Retire `:8935` (reversible)

1. **Caddy repoint (no gas):** `~/Caddyfile` vhost `liverunner-staging-1.daydream.monster`
   `reverse_proxy https://localhost:8935` → `:8936`; backed up; applied via **container restart**
   (a plain `caddy reload` did NOT swap the route — restart was required). Public hostname then
   served **v09 (13 runners)** vs the prior **v1 (4 self-registered apps)**.
2. **Stop v1:** `docker stop liverunner-orch` → **Exited (0)**. Compose + images + keystore kept
   (restorable: `docker start liverunner-orch` + revert Caddyfile). `:8935` now connection-refused.

**✅ Checkpoint 6/7:** exactly one live-runner orch (`liverunner-v09-orch`, Up) serving; v1 stopped
and restorable; `byoc-staging-1` untouched.

## Step 8 — End-state verification

| check | result |
|---|---|
| Single live-runner orch | ✅ `liverunner-v09-orch` Up (`:8936`); `liverunner-orch` Exited(0) |
| Public hostname serves v09 | ✅ `…daydream.monster/discovery` → 13 runners |
| `/discovery` = 8 fal + 5 tool priced | ✅ all non-zero WEI |
| MCP lists the 5 tool caps | ✅ |
| Tool-cap routing reaches runner | ✅ all 5 v09 native `/apps/<runner>/app/run` → **HTTP 402 "invalid live runner payment signer address"** (route exists; reaches payment layer) |
| Direct app functionality | ✅ blender-app `/run` (procedural) → **HTTP 200** real PNG URL (`v3b.fal.media/.../render-….png`) |
| Full metered generation | ⏸ gated on the **payment-signer** fix (same gap as the 8 fal caps) — owner: signer worker |
| `byoc-staging-1` | ✅ untouched / never referenced |

## on-chain serviceURI (no tx sent)

`ServiceRegistry.getServiceURI(0x180859…)` on Arbitrum One (`0xC92d…7431`) =
**`https://34.169.235.70:8935`** — a **stale IP** (the VM's current IP is `136.66.21.17`; the value
is also `:8935`, not the Caddy hostname). So on-chain gRPC-discovery already did **not** resolve to
this VM before the migration (pre-existing, not a regression). The live paths use **direct**
addressing (`LR_ORCH_DISCOVERY=https://136.66.21.17:8936/discovery`) + the Caddy-fronted hostname —
both now point at v09. Pointing the on-chain serviceURI at v09 (`https://136.66.21.17:8936`) would
require an on-chain `SetServiceURI` tx (fund-spending, owner = orch-wallet holder) — **NOT sent**
(not required for the current dispatch, and it was already stale). Flagged for owner decision.

## Open items / owners

| item | owner |
|---|---|
| Confirm/replace the 3 PROVISIONAL prices (`ffmpeg-trim` $0.00007, `hyperframes-render` $0.0003, `blender-headless` $0.002) | storyboard-pricing |
| Apply `LR_OFFERINGS_JSON` (above) + add caps to `SELECT_PROVIDER_LR_CAPS` on shared `sdk-staging-1` so the agent routes these 5 to v09 (config only, no code) | gateway/SDK (John) |
| Payment-signer fix ("invalid live runner payment signer address" / numTickets) that gates ALL native metered generation (fal + tool) | signer worker |
| On-chain `SetServiceURI` → `https://136.66.21.17:8936` if on-chain discovery is wanted (needs gas + approval) | infra (John) |
| Repo/VM drift: repo `docker-compose.v09.yml` mounts `./runners.json`; VM mounts `./runners.v09.json` — reconcile to one filename | infra |

## Reversal (if needed)

```
# restore v1 + serviceURI front
ssh liverunner-staging-1
docker start liverunner-orch
sed -i 's#localhost:8936#localhost:8935#' ~/Caddyfile && docker restart liverunner-caddy
# (optional) revert v09 runner set
cp ~/live-runner-v2/runners.v09.json.bak.pre-toolcaps.* ~/live-runner-v2/runners.v09.json
docker compose -f ~/live-runner-v2/docker-compose.v09.yml up -d --force-recreate orchestrator-v09
docker network disconnect live-runner-v2_default liverunner-ffmpeg-app   # + blender/hyperframes
```
