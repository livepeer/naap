# LR v0.9.0 Gap-Closure — Execution Report

**Date:** 2026-07-28
**Plan executed:** [`LR-V0.9.0-GAP-CLOSURE-PLAN.md`](./LR-V0.9.0-GAP-CLOSURE-PLAN.md)
**Operator:** qiang@livepeer.org (gcloud `livepeer-simple-infra`), committing as `seanhanca`
**VM:** `liverunner-staging-1` (external IP `136.66.21.17`)
**Orch wallet (funded, reused):** `0x180859…a6a252`

> All secrets (naap key, composite bearer, m2m secret, daydream `sk_`, keystore password) are held env-only and are **redacted** throughout this report.

---

## TL;DR

| Question | Answer |
|---|---|
| Clean `livepeer/go-livepeer:v0.9.0` live? | **YES** — `liverunner-v09-orch` up on `:8936`, `/discovery` serves 8 static runners. |
| On-chain? | **YES** — orch wallet `0x180859…` registered/active on Arbitrum One. |
| Per-cap priced? | **YES** — 8 runners, per-cap USD→wei prices (7 distinct; 2 caps share $0.02625). |
| In the SDK orchestrator list? | **PARTIAL / BLOCKED** — SDK env already lists all 8 caps, but `LR_ORCH_DISCOVERY` points at `:8935` (no per-cap runners) **and** the deployed SDK image lacks the native client `livepeer_gateway.live_runner.call_runner` (Gap B). Native SDK dispatch cannot work until that ships. |
| Caps registered (agent-discoverable)? | **YES** — generator proves 8× ADD-CAPACITY (0 REGISTER / 0 SYNONYM); MCP `list_capabilities` shows all 8 live & priced. |
| **pymthouse e2e** end-to-end? | **NO** — auth ✅, discovery/price ✅, payment-mint ✅, native 402 challenge ✅, reserve ✅ (already funded) — **generation FAILS** at a **1-line signer bug** (`SegData.manifestId ≠ auth_token.session_id`). Metering not reached. |
| **daydream e2e**? | **PASS (on the daydream plane)** — key found; real flux-schnell asset generated, metered **$0.00320** (per-cap, megapixel × $0.00315). Routes via production daydream/fal infra, **not** `:8936`. |
| Reserve safety gate | **No irreversible spend performed** — payer already funded on-chain (deposit 0.109 ETH + reserve 0.290 ETH). |

**One thing blocks the pymthouse native path from being fully green: a 1-line fix in the pymthouse signer** (bind `SegData.manifestId = auth_token.session_id` on the native live-runner path). Everything upstream of generation is proven working.

---

## What was executed (per plan step)

### Step i — `runners.json` → standard capability schema ✅
- Rewrote all 8 fal runners in `live-runner-v2/runners.json` using the **Storyboard capability descriptor as the single source of truth**, with native `price_info` derived from the descriptor `offering.price` (WEI → USD `display_usd`).
- Added a validating generator `live-runner-v2/scripts/lr-gen-runners.mjs` that (a) runs `validateDescriptor` on each `capability` block, (b) checks native `price_info` ↔ descriptor consistency, and (c) reports the discovery-sync dedup plan against `storyboard-pricing/lib/capabilities/registry.json`.
- Each runner has the required `health_url`.
- **Result:** all 8 schema-valid, native-derived, dedup-clean → **8× ADD-CAPACITY, 0 REGISTER, 0 SYNONYM-SKIP**.

Per-cap prices (native `price_info`, USD `fixed`):

| Cap | USD | Cap | USD |
|---|---|---|---|
| flux-schnell | 0.00315 | veo-t2v | 0.42 |
| flux-dev | 0.02625 | chatterbox-tts | 0.02625 |
| gpt-image | 0.0022 | pixverse-i2v | 0.063 |
| kontext-edit | 0.042 | seedance-mini-i2v | 0.0394 ⚠️ provisional (Gap H) |

### Step ii — deploy ONE clean v0.9.0 orch ✅
- `live-runner-v2/docker-compose.v09.yml` runs `livepeer/go-livepeer:v0.9.0` as `liverunner-v09-orch`, additively, reusing the funded wallet read-only (keystore mount), `-network=arbitrum-one-mainnet`, `-useLiveRunners`, `-liveRunnerConfig`, default `-priceFeedAddr` (Arbitrum ETH/USD).
- **Boot gotcha discovered & fixed:** v0.9.0 self-probes its own `-serviceAddr` over the public IP at boot and **shuts down if unreachable**. Only `:8936` is firewalled (`simple-infra-allow-byoc`). Resolution: deployed v0.9.0 on the canonical firewalled **`:8936`**, replacing the byoc-derived orch there (reversible — see rollback).
- **Evidence:** container `Up`, `GET https://136.66.21.17:8936/discovery` returns `address: https://136.66.21.17:8936` with **8 runners**, each with a non-zero per-cap `PriceInfo`. Deployed file is byte-identical (`sha256 58d68b6…`) to the repo `runners.json`.

### Step iii — on-chain registration ✅ (serviceURI update NOT required)
- Orch wallet `0x180859…` is **registered and active** on Arbitrum One (ServiceRegistry / TicketBroker / Minter resolved; orch shows active with the funded wallet).
- On-chain `serviceURI` was **left unchanged** (still resolves to the prior `:8935` hostname). The v0.9.0 native live-runner path is addressed **directly** by the SDK/discovery endpoint (`136.66.21.17:8936`), so no gas-spending serviceURI update was needed for the native path. Sending one is deferred to the v1-removal decision (below).

### Step iv — remove `liverunner-v1-orch :8935` ⛔ **GATED (not executed)**
- **Finding:** `:8935` is **not a duplicate** of the v0.9.0 caps. It hosts distinct **tool** capabilities (ffmpeg-*, hyperframes-*, blender/manim, yolo, obscura, format-convert) **and** the generic `storyboard/fal-app` single-shot proxy — none of which are served by the per-cap v0.9.0 orch.
- Removing it would **take those tool capabilities offline** and **orphan the on-chain `serviceURI`** that currently points at the `:8935` hostname (Open-Q2 in the plan).
- Per the safety gate ("if a step hard-blocks, STOP and report"), **this step was not executed.** It needs an explicit product decision. `byoc-staging-1` was never touched.

### Step v — add orch to SDK orchestrator list ⚠️ **PARTIAL / BLOCKED (Gap B)**
Read-only inspection of the **deployed** SDK service (`sdk-staging-1`, image `sdk-service:optA-lr-multi-2026-07-23`):
- ✅ `SDK_MULTI_ORCH_ENABLED=1`, `LR_DESCRIPTOR_DISPATCH=1`, `SELECT_PROVIDER_LR_PCT=100`
- ✅ `SELECT_PROVIDER_LR_CAPS` already contains all 8 fal caps (flux-dev, flux-schnell, gpt-image, kontext-edit, chatterbox-tts, veo-t2v, pixverse-i2v, seedance-mini-i2v) + screen-agent.
- ❌ `LR_ORCH_DISCOVERY = https://liverunner-staging-1…:8935/discovery, https://lpt.tail…:8443/discovery` — **points at `:8935`**, which serves only the generic `storyboard/fal-app`, **not** the per-cap apps (`storyboard/fal-flux-schnell`, …) that descriptor-dispatch discovers. The new `:8936` endpoint is **not in the list**.
- ❌ **Gap B confirmed on the live image:** `from livepeer_gateway import live_runner` → **ImportError** (no `live_runner` module, no `call_runner`). So `_dispatch_lr`/`_dispatch_lr_v2` cannot perform native dispatch — they would raise and fall back to BYOC for all 8 caps.

**Decision:** did **not** mutate the shared staging SDK service. Adding `:8936` to `LR_ORCH_DISCOVERY` alone would not help (the image still can't dispatch natively), and mutating a shared service for zero functional gain risks disruption. Required wiring is documented below for the owner.

### Step vi — register capabilities (agent-discoverable) ✅
- Since clean v0.9.0 strips the descriptor from `/discovery` (Gap I), registration is carried by the **local-descriptor sync** path. The generator’s dedup plan proves the 8 caps resolve to **8× ADD-CAPACITY** (they already exist in `registry.json` as scope-priced caps; the orch adds *capacity/serving*, not new definitions).
- MCP `list_capabilities` shows all 8 live and priced. **8/8 discoverable.**

### Step vii — pymthouse e2e (naap key) — NATIVE path vs clean `:8936`
Probes: `scripts/run57-lr-auth-vs-pay.py` (stages 0–2) and `scripts/run60-lr-native-singleshot.py` (native 402 + paid gen).

| Stage | Result | Evidence |
|---|---|---|
| 0. naap key → composite validate | ✅ PASS | composite bearer accepted by signer |
| 1. signer auth (`/sign-orchestrator-info`) | ✅ PASS | recipient `0x180859…`, gRPC `PriceInfo` non-zero (per-cap) |
| 2. payment mint (`/generate-live-payment`) | ✅ PASS | HTTP 200, `net.Payment` minted; sender `0x6cae3c7a…cb7260`, recipient=orch. *(intermittent signer 500 ~1/4 — see Gap C)* |
| 2.5 native 402 challenge (`POST /apps/{runner}/app/generate`) | ✅ PASS | `402` with `payment_params` = `OrchestratorInfo`; per-cap price **1648852084881 / 1 = $0.00315** for flux-schnell. Correct native challenge — NOT the BYOC sig path, NOT a reserve error. |
| — reserve gate | ✅ PASS (already funded) | payer `0x6cae3c7a…` deposit **0.109 ETH** + reserve **0.290 ETH** on Arbitrum One (TicketBroker). No funding needed. |
| 3. paid native generation | ❌ **FAIL** | `403 mismatched manifest and auth token` |
| 4. metering (per-cap debit) | ⛔ not reached | blocked by stage 3 |

**Root cause of stage 3 (the sole blocker):** the signer’s `/generate-live-payment` returns segment credentials whose `SegData.manifestId` is a **fresh id** (`d146754b…`) instead of the challenge’s `auth_token.session_id` (`fff0c537…`). The `auth_token` itself is correct (orch `verifySegCreds` passes). The v0.9.0 orch `reservePaidLiveRunnerSession` requires `SegData.ManifestID == AuthToken.SessionId` for fixed payments → 403.
Tried `SIGNER_TYPE ∈ {lv2v, live, scope}` to coax correct binding — all return signer **500** for this `OrchestratorInfo` context. So `type:"byoc"` is the only accepted type today, and it mis-binds the manifest.

### Step viii — daydream e2e ✅ (on the daydream plane)
- **Key: FOUND** (upgrade from prior "BLOCKED-need-key"): GCP secret `daydream-api-key` + the daydream-keyed MCP bearer (`sk_kzMZKX…`, redacted).
- **Generation: PASS** — `create_media` flux-schnell produced a real asset; **metered $0.00320** = per-cap (megapixel × $0.00315), matching config. **Per-cap metering confirmed** on the daydream/storyboard billing layer.
- **Scope note:** this validates the daydream-key generation + metering plane; it routes via **production daydream/fal infra, not the `:8936` orch**. The daydream **live-video (lv2v)** signer plane (`signer.daydream.live`) is architecturally separate from the `:8936` single-shot fal path and was not exercised against `:8936`.

### Step ix — PASS/FAIL matrix (both paths)

| Stage | pymthouse (naap) → `:8936` native | daydream |
|---|---|---|
| auth | ✅ | ✅ (key) |
| discovery / price | ✅ per-cap ($0.00315…$0.42) | ✅ per-cap |
| payment | ✅ (intermittent 500) | n/a (key-metered) |
| reserve | ✅ already funded | n/a |
| generation | ❌ signer manifestId bug | ✅ real asset |
| metering | ⛔ not reached | ✅ $0.00320 per-cap |
| per-cap vs flat | per-cap challenge confirmed; native charge is flat-per-request at per-cap price | ✅ per-cap |

---

## NOT fully working (prioritized) — gaps, root cause, owner

| # | Gap | Root cause | Blocked on | Owner |
|---|---|---|---|---|
| 1 | **pymthouse native generation → 403** | Signer `/generate-live-payment` sets `SegData.manifestId` to a fresh id instead of `auth_token.session_id`; v0.9.0 requires them equal for fixed payments. **~1-line fix.** | Signer code fix (not reserve, not pricing, not boot) | **pymthouse signer** (John) |
| 2 | **SDK native dispatch impossible** | Deployed SDK image `optA-lr-multi-2026-07-23` lacks `livepeer_gateway.live_runner.call_runner` (Gap B); `_dispatch_lr*` ImportError → BYOC fallback. Also `LR_ORCH_DISCOVERY` omits `:8936`. | Ship `call_runner` in the gateway + add `:8936` to `LR_ORCH_DISCOVERY` | **gateway / SDK** (John) |
| 3 | **Signer reliability** | `/generate-live-payment` intermittent HTTP 500 (~1 in 4). | Signer stability | **pymthouse signer** (John) |
| 4 | **seedance-mini-i2v price provisional** | Registry has null scope price (Gap H); $0.0394 is a derived placeholder. | Confirm real price | **storyboard-pricing** |
| 5 | **v1 `:8935` removal** | `:8935` carries distinct tool caps + the on-chain serviceURI target; removing is destructive + orphans serviceURI (Open-Q2). | Product decision | **user / infra** |
| 6 | **daydream lv2v plane vs `:8936`** | live-video signer plane (`signer.daydream.live`) is separate from the single-shot fal path. | Out of scope for this orch; confirm intended topology | **daydream** |

### Required SDK wiring (for the owner, once Gap B ships)
```
LR_ORCH_DISCOVERY += https://136.66.21.17:8936/discovery   # add the per-cap orch
# (SELECT_PROVIDER_LR_CAPS + SDK_MULTI_ORCH_ENABLED + LR_DESCRIPTOR_DISPATCH already correct)
```
…and the deployed SDK image must expose `livepeer_gateway.live_runner.call_runner`.

### Signer fix sketch (for Gap #1)
On the native live-runner path, when minting from an `OrchestratorInfo` challenge, set:
```
segData.ManifestID = authToken.SessionId   # bind manifest to the challenge session
```
instead of generating a new manifest id.

---

## Infra state (end of run)

| Container | Image | Port | Status | Note |
|---|---|---|---|---|
| `liverunner-v09-orch` | `livepeer/go-livepeer:v0.9.0` | `:8936` | **Up** | clean v0.9.0, 8 per-cap runners, on-chain active |
| `liverunner-v2-orch` | `go-livepeer:3975-singleshot` | (`:8936`) | **Exited(0)** | byoc-derived, **retained for rollback** |
| `liverunner-orch` (v1) | `go-livepeer:3975-singleshot` | `:8935` | **Up (healthy)** | **UNTOUCHED** — tool caps + serviceURI target |
| `liverunner-v2-fal-app` / `liverunner-fal-app` | fal proxy | `:8990` | Up | shared runner backend |
| `byoc-staging-1` | — | — | — | **NEVER touched** |

**Rollback (byoc `:8936`):**
```
docker compose -f docker-compose.deployed.yml up -d orchestrator   # restore byoc-derived on :8936
docker compose -f docker-compose.v09.yml down                      # stop clean v0.9.0
```

> Note: `docker-compose.v09.yml` uses `restart: "no"` (matches the prior deployed compose). For durable go-live, switch to `restart: always`.

---

## Safety gates — how they were honored
- **Reserve funding (irreversible):** checked FIRST — payer `0x6cae3c7a…` already funded (0.109 + 0.290 ETH). **No spend performed.**
- **On-chain serviceURI update:** not required for the native path; deferred (tied to the gated v1 removal). No gas spent.
- **Additive + reversible:** v0.9.0 added on `:8936`; byoc `:8936` stopped-not-deleted; v1 `:8935` untouched; `byoc-staging-1` untouched.
- **Hard-block handling:** stopped at the signer manifestId bug (native gen) and the v1-removal decision rather than looping or reintroducing BYOC.
- **Secrets:** all env-only; redacted here and in commits.
