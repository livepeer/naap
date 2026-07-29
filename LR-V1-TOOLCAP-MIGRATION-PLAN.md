# LR v1 Tool-Cap Migration Plan — retire `:8935`, keep tool caps + serviceURI alive

**Status:** PLAN ONLY — read-only investigation. **Nothing was executed, deployed, funded, or removed.**
**Date:** 2026-07-28 · **Branch:** `docs/pricing-scope-simplified` · **Author:** seanhanca
**Goal:** move the distinct **tool** capabilities hosted on `liverunner-v1-orch` (`:8935`, VM
`liverunner-staging-1`) onto the clean v0.9.0 one-orch-many-runner orchestrator
(`liverunner-v09-orch`, `:8936`), then safely retire `:8935` **without** breaking those tool caps
or orphaning the on-chain `serviceURI`.

**Read-only sources (this pass):** live VM inspection (`gcloud compute ssh liverunner-staging-1`,
`us-west1-b`) — `docker ps`, `docker inspect`, `/discovery`, `~/live-runner/{docker-compose.yml,
compose.onchain.yml,Caddyfile}`, the three tool handlers + `tool-runner/base.py`; the v0.9.0
source in the on-VM build (`ai/runner/live_runner.go`, `cmd/livepeer/starter/{flags,starter}.go`);
`live-runner-v2/{docker-compose.v09.yml,runners.json,scripts/lr-gen-runners.mjs}`;
`storyboard-pricing/lib/capabilities/{descriptor.ts,registry.json}`;
`apps/web-next/.../storyboard-default-plan.ts`; the ServiceRegistry resolved on-chain from the v09
boot log. Prior reports [`LR-V0.9.0-EXECUTION-REPORT.md`](./LR-V0.9.0-EXECUTION-REPORT.md) +
[`LR-V0.9.0-GAP-CLOSURE-PLAN.md`](./LR-V0.9.0-GAP-CLOSURE-PLAN.md).

> ### SAFETY RAIL #0 — `byoc-staging-1` is OUT OF SCOPE
> `byoc-staging-1` (a **separate** orchestrator on a **separate** VM) is **never** touched, read,
> redeployed, refunded, reconfigured, or referenced as a target by any step in this plan. No step
> below mentions it as anything other than "leave alone".

---

## 0. TL;DR — what maps, what needs work, the serviceURI, the retire path

| Question | Answer |
|---|---|
| What does `:8935` actually serve? | **4 dynamically self-registered runners**: `storyboard/fal-app` (single-shot, generic fal proxy) + 3 **persistent** tool apps `storyboard/ffmpeg-app`, `storyboard/blender-app`, `storyboard/hyperframes-app`. All flat-priced **100 WEI** (not per-cap). |
| Do the tool caps map cleanly onto v0.9.0 live-runner? | **Partially.** `ffmpeg-concat` + `ffmpeg-export` map **YES-with-work** (prices exist, `unit_kind=call`). `ffmpeg-trim`, `hyperframes-render`, `blender-headless` are **NEEDS-WORK** (registry price is `null`). The generic `fal-app` is **N/A** — already **superseded** by the 8 per-cap v0.9.0 fal runners; it retires with v1. |
| Central gap? | **Granularity mismatch.** The registry defines tool caps **per verb** (`ffmpeg-concat`, `ffmpeg-trim`, …), but a live-runner exposes **one** `storyboard/ffmpeg-app` with the verb in the POST body. One app → many caps. Splitting into per-verb static runners needs a **constant-verb injection** in the descriptor `io.inputs` (`default`) + the dispatch layer honoring it. |
| `yolo` / `obscura` / `pillow` / `cad` / `format-convert`? | **NOT on `:8935`.** They exist in `registry.json` but are served by the separate **`tool-staging-1`** orch, not the live-runner. The prior brief's "`:8935` hosts …yolo, obscura" is **imprecise** — see §1 correction. Out of scope here. |
| serviceURI handling? | On-chain `serviceURI` lives in **ServiceRegistry `0xC92d3A360b8f9e083bA64DE15d95Cf8180897431`** (Arbitrum One), keyed by the **shared** orch wallet `0x180859…`. v1 and v09 **share the same wallet ⇒ the same serviceURI**. Boot writes it **in memory only** (never on-chain). **Retire path = repoint the Caddy vhost `liverunner-staging-1.daydream.monster` from `localhost:8935`→`localhost:8936`** — **no gas, no on-chain tx, no downtime.** An on-chain `SetServiceURI` tx is needed **only** if a *new* hostname is wanted for v09 (owner = orch-wallet key holder; ~cents on Arbitrum). |
| Ordered retire path | (1) prices for the 3 null caps → (2) author per-verb static runners in `runners.json` → (3) make tool-app containers reachable on the v09 network → (4) redeploy v09 with the augmented `runners.json` (additive, v1 still up) → (5) verify `/discovery` + `applyDiscoverySync` (ADD-CAPACITY) + MCP → (6) repoint Caddy → (7) stop v1 (reversible). |
| Irreversible steps? | **None** in the tool-cap migration. All config/compose/Caddy changes are reversible; v1 stop is `docker start`. (No sender-reserve funding is involved in *this* plan.) |

---

## 1. Inventory — exactly what `:8935` serves today

`liverunner-orch` (`:8935`) runs `go-livepeer:3975-singleshot` with **`-useLiveRunners` and NO
`-liveRunnerConfig`** (`-pricePerUnit=0`, wallet `0x180859…`, `serviceAddr
liverunner-staging-1.daydream.monster:8935`). Because there is no static config, **every runner is
registered dynamically**: each app container (from `~/live-runner/docker-compose.yml`) calls
`register_runner(orchestrator, secret=abcdef, runner_url, app, mode="persistent", price, unit,
capacity)` (`tool-runner/base.py` → `livepeer_gateway.live_runner`) on startup. Dynamic
registration is allowed because the orch has a non-empty `-orchSecret` (`abcdef`).

**Live `GET https://localhost:8935/discovery` (captured this pass):**

| # | `app` (runner) | mode | cap | price_info | container / `runner_url` | verbs (from handler) | I/O |
|---|---|---|---|---|---|---|---|
| 1 | `storyboard/fal-app` | single-shot | 4 | `100/1 WEI` | `liverunner-fal-app` `:8990` | model_id per call (generic fal proxy) | `/app…` → media url |
| 2 | `storyboard/ffmpeg-app` | persistent | 2 | `100/1 WEI` | `liverunner-ffmpeg-app` `:8991` | `concat`, `trim`, `export` | POST `/run {verb,inputs[]/source_url,…}` → `{url}` (mp4) |
| 3 | `storyboard/blender-app` | persistent | 2 | `100/1 WEI` | `liverunner-blender-app` `:8992` | `render` (`.blend`+`frame`, or procedural) | POST `/run {blend_url?,frame?}` → `{url}` (png) |
| 4 | `storyboard/hyperframes-app` | persistent | 2 | `100/1 WEI` | `liverunner-hyperframes-app` `:8993` | `render` (HTML→video, SSRF-guarded) | POST `/run {html,fps,duration,width,height}` → `{url}` (mp4) |

**Correction to the prior brief.** The running `:8935` serves **only** the 4 apps above. **`yolo`,
`obscura`, `pillow`, `cad`, `format-convert` are NOT hosted on `:8935`** — no such containers run
(`docker ps` shows only ffmpeg/blender/hyperframes/fal apps) and they are absent from its
`/discovery`. Those names exist in `storyboard-pricing/registry.json` and are served by the separate
**`tool-staging-1`** orch (`STORYBOARD_DEFAULT_PLAN.tool.staticOrchestrators =
['https://tool-staging-1.daydream.monster:8935']`). They are **out of scope** for retiring the
live-runner `:8935`.

**How they're registered / discovered today.** Dynamic heartbeat registration to the v1 orch (no
descriptor, flat 100 WEI). The Storyboard `registry.json` already holds the per-verb identities
(below), so the agent "knows" the caps; the live-runner side only proves *serving*, not per-cap
pricing.

### Registry identities + pricing for the caps `:8935` actually serves

| `:8935` runner + verb | registry `name` | `kind` | `semantic_key` | `unit_kind` | `display_price_usd` |
|---|---|---|---|---|---|
| `ffmpeg-app` `verb=concat` | `ffmpeg-concat` | `tool` | `tool:concat:ffmpeg:-` | `call` | **$0.00013** ✅ |
| `ffmpeg-app` `verb=trim` | `ffmpeg-trim` | `tool` | `tool:trim:ffmpeg:-` | `null` | **`null`** ⚠️ |
| `ffmpeg-app` `verb=export` | `ffmpeg-export` | `tool` | `tool:export:ffmpeg:-` | `call` | **$0.00026** ✅ |
| `hyperframes-app` `verb=render` | `hyperframes-render` | `tool` | `tool:render:hyperframes:-` | `null` | **`null`** ⚠️ |
| `blender-app` `verb=render` | `blender-headless` | **`ai`** | `ai:tool:blender:headless` | `null` | **`null`** ⚠️ |
| `fal-app` (generic) | — (8 fal caps) | `ai` | — | — | **superseded** by the 8 per-cap v0.9.0 runners |

> ⚠️ **Identity gotcha:** `blender-headless` (and `format-convert`) have `kind:"ai"`, `modality:"tool"`
> in the registry — **not** `kind:"tool"`. A migrating descriptor must pin `kind:ai, modality:tool,
> family:blender, variant:headless` to dedup to **ADD-CAPACITY**; using `kind:"tool"` would mint a
> **SYNONYM** (new identity) — a regression.

---

## 2. Can each tool cap be a v0.9.0 live-runner runner? (honest mapping)

**v0.9.0 supports both modes statically.** In the on-VM v0.9.0 build, `StaticLiveRunnerConfigEntry`
has a `Mode` field and `mode ∈ {persistent, single-shot}` (`ai/runner/live_runner.go`
`LiveRunnerModePersistent`/`LiveRunnerModeSingleShot`; `buildStaticRunner` **requires `health_url`**).
So the tool apps *can* be authored as static runners. **single-shot is recommended** for these tools
(each `/run` call = one synchronous job returning a URL — exactly single-shot semantics, and it
matches the 8 fal caps).

**v0.9.0 `:8936` already has `-orchSecret=abcdef`** (`docker-compose.v09.yml`) ⇒ dynamic registration
is **also** enabled there. That gives a **bridge option** (re-point the tool apps' `--orchestrator`
at the v09 orch and let them self-register) — but that keeps the flat 100-WEI, descriptor-less model
and does **not** satisfy the schema-conformance requirement. The **target** is static, descriptor-
priced runners (below); the bridge is only a fallback.

**The central gap — 1 app ↔ N caps.** The registry is per-verb; the runner is per-app. To express
each verb as its own schema-conformant cap, author **one static runner per verb**, all sharing
`runner_url` + `endpoint:/run`, each descriptor injecting a **constant verb**. The descriptor
`InputSpecSchema` supports this: `from` is optional and `default` is allowed, e.g.
`"verb": { "wire": "verb", "default": "concat", "required": false }`. **Caveat (owner: gateway/SDK):**
the dispatch layer must actually **inject `default` into the wire body** when `from` is absent —
confirm before relying on it; otherwise the caller must always pass `verb` (works, but not "clean").

| Cap (verb) | Maps to v0.9.0 live-runner? | Why / what's needed |
|---|---|---|
| `ffmpeg-concat` | **YES — needs work** | Price exists ($0.00013, `unit_kind=call`→native `unit:"fixed"`). Needs per-verb static entry + constant-verb injection. |
| `ffmpeg-export` | **YES — needs work** | Price exists ($0.00026). Same per-verb authoring. |
| `ffmpeg-trim` | **NEEDS-WORK** | Registry `display_price_usd/unit_kind = null` → **pricing owner** must finalize before schema-complete. |
| `hyperframes-render` | **NEEDS-WORK** | Price `null` → **pricing owner**. Otherwise maps (single-shot `/run`, output mp4 url). |
| `blender-headless` | **NEEDS-WORK** | Price `null` → **pricing owner**; **and** pin `kind:ai, modality:tool` identity (not `tool`). |
| `fal-app` (generic) | **N/A — superseded** | The 8 per-cap fal runners already serve these on v09; the generic proxy is retired with v1, not migrated. |
| `ffmpeg-overlay/audio-mix/loop/burn-subtitles/grid/mux`, `pillow-*`, `obscura-*`, `yolo-*`, `cad-*`, `format-convert` | **NOT on `:8935`** | Served by `tool-staging-1`. Out of scope; do not add to v09 as part of retiring `:8935`. |

**Runners that do NOT auto-migrate → owners:**
- `ffmpeg-trim`, `hyperframes-render`, `blender-headless` prices are `null` → **storyboard-pricing**
  (finalize `display_price_usd` + `unit_kind` + `quantity_source`), same shape as the seedance gap H.
- Constant-verb injection in dispatch → **gateway/SDK (John)** (confirm `InputSpec.default` is
  honored, or agree callers always pass `verb`).
- The 6 unserved ffmpeg verbs (overlay/audio-mix/loop/burn-subtitles/grid/mux) and
  caption/lower-third are **not implemented** in the deployed `ffmpeg-app`/`hyperframes-app` — if LR
  parity for them is wanted, the app handlers must add those verbs → **live-runner app owner**.

---

## 3. serviceURI — how `:8935` owns it and what must change

**Facts (verified this pass):**
- ServiceRegistry (Arbitrum One) = **`0xC92d3A360b8f9e083bA64DE15d95Cf8180897431`** (resolved from the
  v09 boot log: `Controller 0xD8E8…6ee4` → `ServiceRegistry 0xC92d…7431`). serviceURI is keyed by the
  orchestrator **wallet address** `0x180859c337d14eDF588C685f3f7AB4472AB6a252`.
- **v1 (`:8935`) and v09 (`:8936`) use the *same* wallet** ⇒ there is exactly **one** on-chain
  serviceURI for both. Removing v1 does **not** by itself change on-chain identity.
- v1 advertises `ServiceAddr = liverunner-staging-1.daydream.monster:8935`; the public
  `liverunner-staging-1.daydream.monster` (`:443`) is fronted by **Caddy** →
  `reverse_proxy https://localhost:8935` (the v1 orch). That is the endpoint the on-chain serviceURI
  hostname currently resolves to.
- Boot calls `SetServiceURI` **in memory only** (`starter.go`) — it never sends an on-chain tx. So
  neither the v09 image swap nor stopping v1 mutates the stored serviceURI.
- *(Exact stored string not decoded this pass: a raw `eth_call getServiceURI(address)` returned
  `execution reverted` — selector/proxy quirk. Confirm the exact value with `livepeer_cli` → "Get
  orchestrator info", or a correct-ABI call, before cutover. The **hostname it resolves to** —
  `liverunner-staging-1.daydream.monster` via Caddy — is what matters operationally and is verified.)*

**What must change so a single v0.9.0 orch owns the serviceURI, no downtime:**
- **Preferred (no gas, no tx, no downtime):** **repoint the Caddy vhost** on the VM so
  `liverunner-staging-1.daydream.monster` reverse-proxies to **`localhost:8936`** (v09) instead of
  `:8935`. The same on-chain serviceURI keeps resolving to a live, healthy orch. Reversible by
  reverting the Caddyfile.
- **On-chain `SetServiceURI` tx — needed ONLY if** you want a *distinct* hostname for v09 (e.g. a new
  DNS record). Cost: one Arbitrum One tx (~cents). Owner: holder of the `0x180859…` orch key
  (infra / John). **Not required** for this retire if you keep the existing hostname + repoint Caddy.
- **Open nuance (§7):** v09's own advertised `ServiceAddr` is the **IP** `136.66.21.17:8936` (it
  self-probes that at boot and only `:8936` is firewalled). The native LR path uses **direct**
  `LR_ORCH_DISCOVERY` addressing (per the execution report), so on-chain gRPC-discovery
  hostname↔IP parity is **not** on the critical path — but any pure on-chain-discovery consumer
  should be confirmed before assuming the Caddy repoint fully covers it.

---

## 4. Step-by-step migration (each step: change · command · expected · rollback · ✅ checkpoint)

> Additive-first: v09 keeps running the 8 fal caps throughout; tool caps are **added** to v09 and
> only **then** is v1 removed — never a coverage gap. All commands are for **infra/John on the VM**;
> nothing here was executed.

### Step 1 — Finalize prices for the 3 null tool caps *(CFG · storyboard-pricing)*
- **Change:** in `storyboard-pricing/registry.json`, set `display_price_usd`, `unit_kind` (`call`),
  `quantity_source` (`const_1`) for `ffmpeg-trim`, `hyperframes-render`, `blender-headless` (align
  `blender-headless` identity as `kind:ai, modality:tool, family:blender, variant:headless`).
- **Expected:** each of the 3 rows has a non-null `display_price_usd` + `unit_kind`.
- **Rollback:** `git checkout registry.json`.
- **✅ CHECKPOINT 1:** 5 target caps (concat/export already priced + trim/hyperframes-render/blender)
  all have finalized USD prices. *(concat/export can proceed without this; the other 3 are gated.)*

### Step 2 — Author per-verb tool runners in `runners.json` (source-of-truth descriptors) *(CFG · me + storyboard-pricing)*
- **Change:** add static entries to `live-runner-v2/runners.json`, one per verb, each with an embedded
  `capability` descriptor (single source of truth) + derived native `price_info:{price,currency:"usd",
  unit:"fixed"}`, `mode:"single-shot"`, `endpoint:"/run"`, `health_url`, and a constant-verb input.
  Example (`ffmpeg-concat`):

```json
{
  "label": "ffmpeg-concat",
  "app": "storyboard/ffmpeg-app",
  "runner_url": "http://ffmpeg-app:8991",
  "health_url": "http://ffmpeg-app:8991/health",
  "healthy_status_code": 200,
  "mode": "single-shot",
  "capacity": 2,
  "price_info": { "price": "0.00013", "currency": "usd", "unit": "fixed" },
  "capability": {
    "kind": "tool", "name": "ffmpeg-concat",
    "family": "ffmpeg", "modality": "concat", "variant": null,
    "semantic_key": "tool:concat:ffmpeg:-", "output_kind": "tool",
    "io": {
      "endpoint": "/run",
      "inputs": {
        "verb":   { "wire": "verb", "default": "concat", "required": false, "type": "string" },
        "inputs": { "wire": "inputs", "from": "source_urls", "required": true, "type": "array" }
      },
      "output": { "kind": "url", "fields": ["url"], "primary": "url" }
    },
    "offering": {
      "app": "storyboard/ffmpeg-app", "mode": "single-shot", "capacity": 2,
      "price": { "unit": "USD", "display_usd": 0.00013, "display_unit": "call",
                 "unit_kind": "call", "quantity_source": "const_1" }
    }
  }
}
```
  Repeat for `ffmpeg-trim` (`verb:"trim"`, inputs `source_url`+`start`+`duration`), `ffmpeg-export`
  (`verb:"export"`, `width`/`height`), `hyperframes-render` (`app:storyboard/hyperframes-app`,
  `runner_url http://hyperframes-app:8993`, inputs `html`/`fps`/`duration`/`width`/`height`), and
  `blender-headless` (`app:storyboard/blender-app`, `runner_url http://blender-app:8992`,
  `kind:ai, modality:tool, variant:headless`, inputs `blend_url`/`frame`).
- **Validate:** `STORYBOARD_CAPS=$PWD/lib/capabilities RUNNERS_JSON=…/runners.json npx tsx
  live-runner-v2/scripts/lr-gen-runners.mjs` → each new block **descriptor-valid**, native
  `price_info` derived-consistent, and dedups to **ADD-CAPACITY** (0 SYNONYM, 0 invalid).
- **Rollback:** `git checkout live-runner-v2/runners.json`.
- **✅ CHECKPOINT 2:** generator prints `N ADD-CAPACITY, 0 SYNONYM-SKIP, 0 invalid` for the tool
  entries (alongside the existing 8 fal caps). **Do not proceed on any entry that isn't ADD-CAPACITY.**

### Step 3 — Make the tool-app containers reachable from the v09 orch *(CFG · John, on VM)*
- **Why:** the tool apps (`liverunner-ffmpeg-app` etc.) are on the v1 compose network
  (`live-runner_default`); the v09 orch is on `live-runner-v2_default`. Static `runner_url`s like
  `http://ffmpeg-app:8991` must resolve from the v09 orch's network.
- **Change (reversible, additive):** attach the 3 tool-app containers to the v09 network, e.g.
  `sudo docker network connect live-runner-v2_default liverunner-ffmpeg-app` (repeat for
  blender/hyperframes). *(Alternative: declare them in a v2 compose file so they come up on the v2
  network; keep the v1 compose restorable.)*
- **Verify (RO):** from the v09 orch container, `getent hosts ffmpeg-app` resolves; the orch's
  static-runner health check passes at boot (Step 4).
- **Rollback:** `sudo docker network disconnect live-runner-v2_default liverunner-ffmpeg-app`.
- **✅ CHECKPOINT 3:** v09 orch can reach `ffmpeg-app:8991`, `blender-app:8992`, `hyperframes-app:8993`.

### Step 4 — Redeploy v09 with the augmented `runners.json` (additive; v1 still up) *(CFG · John)*
- **Change:** copy the augmented `runners.json` to the VM and re-up **only** the v09 orch:
  `sudo docker compose -f docker-compose.v09.yml up -d orchestrator-v09` (image unchanged,
  `livepeer/go-livepeer:v0.9.0`; wallet read-only; `:8936` unchanged). **v1 `:8935` stays up.**
- **Expected boot log:** `Registered <8+N> static live runners from /etc/livepeer/runners.json`, no
  `error registering -liveRunnerConfig`, no `buildStaticRunner` health error.
- **Verify (RO):** `curl -sk https://136.66.21.17:8936/discovery | jq '.[0].runners[]|{app,mode,price_info}'`
  → the 8 fal caps **plus** the tool runners, each with a non-zero per-cap `price_info`.
- **Rollback:** restore the prior `runners.json` + `docker compose -f docker-compose.v09.yml up -d
  orchestrator-v09` (or `docker-compose.deployed.yml` per the execution report's byoc-`:8936`
  rollback). v1 unaffected either way.
- **✅ CHECKPOINT 4:** v09 `/discovery` shows the tool runners priced; v1 `:8935` still healthy.

### Step 5 — Register + verify the caps are agent-discoverable *(CFG · agent/registry + gateway John)*
- **Change:** clean v0.9.0 strips the descriptor from `/discovery` (gap I), so register via the
  **local source of truth**: extract the tool `capability` blocks from `runners.json` →
  `applyDiscoverySync(descriptors)` (operator cap-sync entrypoint), exactly as the 8 fal caps.
- **Verify:** (a) discovery-sync report = `ADD-CAPACITY` for each tool cap (0 REGISTER/SYNONYM);
  (b) Storyboard MCP `list_capabilities` shows `ffmpeg-concat`/`ffmpeg-export` (+ the priced 3) live;
  (c) one `run_capability` per cap dispatches to v09 and returns a real URL (verb injected correctly).
- **Rollback:** none needed (read-model); if a cap mis-registers, drop its `runners.json` entry (Step 2).
- **✅ CHECKPOINT 5:** tool caps discoverable + priced on v09 + at least one real tool generation via v09.

### Step 6 — Repoint the serviceURI front to v09 *(CFG · John, on VM — no gas)*
- **Change:** edit `~/Caddyfile` so `liverunner-staging-1.daydream.monster` reverse-proxies
  `https://localhost:8936` (v09) instead of `:8935`; reload Caddy
  (`sudo docker exec liverunner-caddy caddy reload --config /etc/caddy/Caddyfile` or restart the
  caddy container). The on-chain serviceURI (unchanged) now resolves to the v09 orch.
- **Expected:** `curl -sk https://liverunner-staging-1.daydream.monster/discovery` returns the **v09**
  runner set (8 fal + tool caps).
- **Rollback:** revert the Caddyfile (`localhost:8935`) + reload.
- **✅ CHECKPOINT 6:** the public serviceURI hostname serves v09; no on-chain tx sent.

### Step 7 — Retire `:8935` (reversible) *(CFG · John, on VM)*
- **Change:** stop **only** the v1 orch: `sudo docker stop liverunner-orch`. Optionally stop the now-
  redundant `liverunner-fal-app` (superseded). **Keep the v1 compose + images on disk** so it is
  restorable. Do **not** delete the keystore, and do **not** touch `byoc-staging-1`.
- **Expected:** exactly one live-runner orch (v09 `:8936`) serving fal + tool caps; serviceURI healthy
  (Step 6); v1 container `Exited`.
- **Rollback:** `sudo docker start liverunner-orch` + revert Caddy (Step 6) → back to v1 in seconds.
- **✅ CHECKPOINT 7:** v1 stopped, tool caps + fal caps + serviceURI all green on v09; v1 restorable;
  `byoc-staging-1` untouched.

---

## 5. Risks + explicit safety rails

- **`byoc-staging-1` UNTOUCHED** — never referenced as a target. ✅
- **No downtime for tool caps:** tool runners are **added** to v09 and verified (Steps 2–5) **before**
  v1 is stopped (Step 7); the serviceURI is repointed (Step 6) before retire. Additive-first.
- **No irreversible steps in this plan:** all changes are config/compose/Caddy (git/redeploy/reload
  reversible) or `docker stop` (→ `docker start`). **No funding, no on-chain tx** is required for the
  tool-cap migration (the Caddy repoint avoids `SetServiceURI` gas entirely).
- **Boot-break risk (mitigated):** a bad `runners.json` schema → `glog.Exit` at boot; Step 2's
  generator + Step 4's additive verify (v1 still up) contain it.
- **Network-reachability risk:** if Step 3 is skipped, v09's static runners fail their health check
  and won't register → caught at Checkpoint 4 before any retire.
- **Verb-injection risk:** if the dispatch layer does not honor `InputSpec.default`, per-verb runners
  won't auto-fill `verb` → caught at Checkpoint 5 (generation returns wrong/again verb). Fallback:
  callers pass `verb` explicitly.
- **serviceURI hostname↔IP nuance:** repointing Caddy covers hostname resolution; pure on-chain
  gRPC-discovery consumers (if any) should be confirmed (Open-Q 3). The native LR path is unaffected.
- **Secrets:** keystore/passphrase/`FAL_KEY`/`ORCH_SECRET` stay VM-only / env-only / redacted. None
  in the repo.

---

## 6. Owners for anything that can't auto-migrate

| Item | Owner |
|---|---|
| Finalize `ffmpeg-trim`, `hyperframes-render`, `blender-headless` USD price + `unit_kind`/`quantity_source` | **storyboard-pricing** |
| Confirm dispatch honors `InputSpec.default` for constant-verb injection (or agree callers always send `verb`) | **gateway / SDK (John)** |
| Attach tool-app containers to the v09 network / restructure compose | **infra (John)** |
| Repoint Caddy vhost → `:8936` (Step 6) and stop v1 (Step 7) | **infra (John)** |
| On-chain `SetServiceURI` tx (only if a new v09 hostname is chosen) — orch-wallet key holder | **infra (John)** |
| Implement the 6 unserved ffmpeg verbs + hyperframes caption/lower-third on LR (if LR parity wanted) | **live-runner app owner** |

---

## 7. Open questions for the user

1. **Which tool caps ship?** Confirm the migration set = `ffmpeg-concat`, `ffmpeg-export` (priced),
   plus `ffmpeg-trim`, `hyperframes-render`, `blender-headless` (once priced). Or ship only the two
   priced ffmpeg caps first and defer the null-priced three?
2. **Mode:** author the tool runners as **single-shot** (recommended — matches the 8 fal caps and the
   `/run`-returns-URL semantics) or preserve their current **persistent** mode?
3. **serviceURI:** keep the existing hostname `liverunner-staging-1.daydream.monster` and **repoint
   Caddy → `:8936`** (no gas, preferred), or mint a new v09 hostname + on-chain `SetServiceURI` tx?
   And are there any **on-chain gRPC-discovery** consumers that need the advertised address (IP vs
   hostname) reconciled?
4. **Verb injection:** is the Storyboard dispatch layer confirmed to inject `InputSpec.default` into
   the wire body when `from` is absent? If not, is "callers always pass `verb`" acceptable?
5. **`fal-app` retire:** confirm the generic `storyboard/fal-app` proxy on v1 is safe to retire
   (it is superseded by the 8 per-cap v09 fal runners) — anything still calling the generic app?
6. **`blender-headless` identity:** confirm the registry should keep `kind:ai, modality:tool` (vs
   normalizing to `kind:tool`) — the descriptor must match to dedup as ADD-CAPACITY.

---

*Plan only. No commands from this document were executed. `byoc-staging-1` was never touched or
referenced as a target. All VM interaction was read-only inspection.*
