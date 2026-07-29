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
| In the SDK orchestrator list? | **RESOLVED (dispatch fix shipped)** — Gap B closed: `call_runner` is **source-present** (`livepeer-python-gateway` `feat/byoc-inference-capabilities-protobuf` @`426f019`); the deployed image merely vendored a BYOC-only gateway checkout without `live_runner.py`. Rebuilt + pushed additive image `sdk-service:lr-call-runner-2026-07-28`, repointed `LR_ORCH_DISCOVERY`→`:8936` + `LR_OFFERINGS_JSON`→per-cap apps. **Validated on an isolated instance: the NaaP key now dispatches natively to `:8936`** (402 + native mint attempted), no longer BYOC-fallback. See [Dispatch-fix addendum](#dispatch-fix-addendum-2026-07-28). |
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
| 2 | ~~**SDK native dispatch impossible**~~ **RESOLVED 2026-07-28** | `call_runner` was **source-present** all along (`feat/byoc-inference-capabilities-protobuf` @`426f019`); the deployed image just vendored a BYOC-only gateway. Rebuilt image with that ref + repointed discovery/offerings to `:8936`. Native dispatch to `:8936` proven on an isolated instance. | ~~gateway~~ — done; **config apply to shared staging** gated on owner approval | **infra** |
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

---

## Dispatch-fix addendum (2026-07-28) — Gap B closed, native `:8936` dispatch proven

Follow-up run to close **Gap B** (SDK native dispatch). Scope: make the NaaP-key
path route the 8 fal caps to the clean v0.9.0 orch on `:8936` via the native
`/apps/{runner}/app/generate` path instead of BYOC `:8935`.

### 1. `call_runner` — SOURCE-PRESENT (no porting needed)

`app.py` (`_dispatch_lr` / `_dispatch_lr_v2`) calls
`from livepeer_gateway.live_runner import call_runner`. That symbol **exists in
the gateway source** — `feat/byoc-inference-capabilities-protobuf` @`426f019`,
`live_runner.py:624`, exported from `__init__.py`. The deployed SDK image lacked
it only because the **vendored** gateway (`sdk-service-build/livepeer-gateway/`,
git-ignored plain files) was a BYOC/tool checkout with **no `live_runner.py`**.
So the fix is a **rebuild with a gateway ref that has it** — not a port.

`426f019` also satisfies every other symbol `app.py` imports (`submit_byoc_job`,
`start_lv2v`, `StartJobRequest`, `remote_signer.get_orch_info_sig`,
`errors.SkipPaymentCycle`, `media_publish.MediaPublish`, …) — verified by a clean
`import app` inside the rebuilt image.

### 2. Image + config changed

| What | Where | Safe? |
|---|---|---|
| Rebuilt SDK image, gateway pinned to `426f019` (has `call_runner`) | pushed **additively** as `us-docker.pkg.dev/…/sdk-service:lr-call-runner-2026-07-28` (digest `sha256:a3696cb5…`) | ✅ new tag; running staging (`merit-precise-2026-07-20`) untouched |
| `LR_ORCH_DISCOVERY=https://136.66.21.17:8936/discovery` | env (isolated instance) | ✅ additive/reversible |
| `LR_OFFERINGS_JSON` → per-cap apps (`storyboard/fal-flux-schnell`, …) | env (isolated instance) | ✅ additive; unset ⇒ today's `:8935` behavior |
| Recipe committed | `simple-infra` `fix/lr-native-dispatch-call-runner` (`sdk-service-build/LR-NATIVE-DISPATCH.md`) | ✅ doc only |

**Validation was done on an isolated LOCAL container** (not the shared
`sdk-staging-1`): the two env vars above are the only delta vs. shared staging,
and applying them to the shared service would affect other fal-cap consumers, so
that apply is **gated on owner approval** (safety gate honored — did not mutate
the shared service).

### 3. Evidence — NaaP key now dispatches natively to `:8936`

Drove the real NaaP key through `POST /inference` (`flux-schnell`) on the
isolated instance. Server log:

```
LR offering-driven dispatch ACTIVE: 8 offerings [chatterbox-tts, flux-dev, flux-schnell, …]
LR dispatch failed for flux-schnell (HTTP 400 from endpoint
  (url=…pymthouse-signer…/generate-live-payment); body='numTickets 2721947758 exceeds maximum of 100')
  — falling back to BYOC
```

Chain proven: NaaP key → `/keys/validate` (returns endpoint-form per-key signer =
pymthouse + composite) → `_effective_signer` → `_dispatch_lr_v2` → `call_runner`
→ discovered the `:8936` per-cap runner → **native `POST /apps/.../app/generate`
→ 402 challenge received & parsed → native payment mint attempted** at the
signer. (A 402 without valid `payment_params` would have raised
"missing payment_params" before the signer call; instead the signer's
`/generate-live-payment` was reached and returned the mint error — so a real
`:8936` challenge was in hand.) Raw `:8936` per-cap endpoint independently
returns `HTTP 402` (payment-gated). **Before the fix, `call_runner` ImportError'd
→ instant BYOC fallback, never touching `:8936`.**

### 4. How far it got / remaining dependency (signer fix)

Reached the **native payment-mint** step, then failed **inside the pymthouse
signer** — `HTTP 400 numTickets 2721947758 exceeds maximum of 100` on the native
`type:"lv2v"` mint (`_get_runner_payment`). This is a **signer-side** payment
computation bug (ticket faceValue sizing vs. the fixed per-cap price), a sibling
of the previously-logged `SegData.manifestId ≠ auth_token.session_id` 403
(Gap #1). **Both are owned by the separate pymthouse-signer worker**, downstream
of dispatch. The dispatch plane is now correct end-to-end; **full green is gated
solely on the signer fix.**

---

## Re-test addendum (2026-07-28, PM) — after John's NEW signer deploy: STILL FAILS at payment-mint

**Goal:** confirm whether John's latest deployment (expected: the go-livepeer
remote-signer fix for the `manifestId`/`numTickets` bugs) makes the pymthouse
**naap-key native single-shot e2e** green end-to-end on the clean v0.9.0 orch
`:8936`. **READ/TEST-only** — no orch/signer/Caddy/runners mutation;
`byoc-staging-1` **never touched**. Secrets env-only/redacted.

### Verdict: ❌ **FAIL — still blocked at payment-mint (stage 3b). The `400 numTickets … exceeds maximum of 100` bug is NOT fixed.**

Native generation + metering are **not reached**. No real asset generated. No
on-chain spend (mint never produced a payment).

### PASS/FAIL per stage

| Stage | Result | Evidence |
|---|---|---|
| 0. naap key → `/keys/validate` → composite | ✅ **PASS** | `valid:true`; endpoint-form `signerSession {url,headers}`; composite bearer **byte-identical** to the supplied `app_…_pmth_…`. Validate now resolves the per-key signer to **`pymthouse-production.up.railway.app`** (distinct Railway service from the supplied `pymthouse-signer-test-production`). |
| 1. discovery / per-cap price | ✅ **PASS** | `:8936` `/discovery` up, serves **8 runners** incl. `storyboard/fal-flux-schnell` → `runner_dou3fwcx`, `price 1640834633716 wei fixed` (≈ $0.00315). `get_pricing flux-schnell` = **$0.00315/MP**. |
| 2. native 402 challenge (`POST /apps/runner_dou3fwcx/app/generate`) | ✅ **PASS** | `402` with `payment_params` (len 392) = `OrchestratorInfo` on **every** attempt (4/4 across probes). Orch healthy throughout (migration worker had not disrupted flux-schnell). |
| 3. payment-mint (`/generate-live-payment`) | ❌ **FAIL** | See error matrix below — **`400 numTickets 2721947758 exceeds maximum of 100`** on the real native `type:"lv2v"` path, **both** signers. |
| 4. generation | ⛔ **not reached** | blocked by stage 3. |
| 5. metering (per-cap vs flat) | ⛔ **not reached** | blocked by stage 3. |

### Error matrix — `/generate-live-payment` mint, flux-schnell, both signers × both types

| Signer | `type:"byoc"` | `type:"lv2v"` (real native path) |
|---|---|---|
| `pymthouse-production` (naap-key-derived, authoritative) | `400 invalid job type` | **`400 numTickets 2721947758 exceeds maximum of 100`** |
| `pymthouse-signer-test-production` (user-supplied) | `500 Internal Server Error` | **`400 numTickets 2721947758 exceeds maximum of 100`** |

The real gateway native dispatch (`call_runner`) mints with `type:"lv2v"` — this
probe reproduces that path exactly, and the error is **byte-identical** to the
one logged in the prior [Dispatch-fix addendum](#dispatch-fix-addendum-2026-07-28)
(`numTickets 2721947758`). The constant `2721947758` is challenge-independent →
a **signer-side payment-sizing constant** (ticket faceValue/winProb vs. the fixed
per-cap price), not a per-request artifact.

### Are the two prior blockers gone?

- **`400 numTickets … exceeds maximum of 100` — NO, STILL PRESENT.** Identical
  value on both signers, on the real native `type:"lv2v"` mint. John's deploy did
  **not** fix it. **This is the sole hard blocker of the native e2e today.**
- **`403 mismatched manifest and auth token` — not observable (moot on the native
  path).** That 403 was a **generation-stage (3c)** symptom of the `type:"byoc"`
  mint mis-binding `SegData.manifestId`. The flow now hard-stops one stage earlier
  at **payment-mint (3b)**, so generation is never reached and the 403 cannot fire.
  On the `type:"byoc"` path the signer no longer even accepts the mint
  (`invalid job type` on the derived signer; `500` on test-production), and the
  real native path uses `type:"lv2v"` anyway. So the 403 is **not the native-path
  blocker** — `numTickets` is.

### Remaining error → stage → likely owner

- **Error:** `HTTP 400 {"error":{"message":"numTickets 2721947758 exceeds maximum of 100"}}`
- **Stage:** payment-mint, `POST /generate-live-payment`, `type:"lv2v"`.
- **Owner:** **pymthouse signer (John).** Signer payment computation sizes
  `numTickets` from a faceValue/winProb that is orders of magnitude too small for
  the fixed per-cap price, blowing past the 100-ticket cap. Fix is signer-side and
  independent of the orch (`:8936` challenge + pricing + reserve are all correct).

### Signer version note

The signer exposes no version/commit endpoint (`/version`,`/info`,`/status` →
404; `/healthz` → static `OK`), so the deployed build was **not HTTP-discoverable**.
Deploy status was therefore inferred from behavior: the identical `numTickets`
error on both signers indicates **the numTickets fix is not live on either**.

### Safety

- **No spend:** mint never produced a payment → zero on-chain ticket generation.
- **READ/TEST-only:** only hit `:8936` `/discovery` + `/apps/.../app/generate` and
  the two signer webhooks. **`byoc-staging-1` NEVER touched.** No orch/signer/Caddy/
  runners.json mutation. `:8936` stayed healthy (8 runners) throughout.
- Secrets env-only; redacted here.

---

## `type=fixed` decisive addendum (2026-07-28, PM) — CONFIRMED: signer REJECTS `type=fixed`

**Goal:** run ONE e2e through the pymthouse signer path against the clean v0.9.0
orch `:8936` (`liverunner-v09-orch`, VM `liverunner-staging-1`, IP `136.66.21.17`)
using payment **`type=fixed`**, and confirm empirically whether the deployed
pymthouse DMZ signer accepts `RemoteType_Fixed` or rejects it — and catch any new
John deploy. **READ/TEST-only** — no deploy/rebuild/mutation of any signer/orch/
infra; **`byoc-staging-1` never touched**; `sdk-staging-1` never touched (DIRECT
native probe, method (a) — no SDK container). Secrets env-only/redacted.

Probe: [`scripts/run61-lr-fixed-probe.py`](./scripts/run61-lr-fixed-probe.py)
(native 402 challenge → `type=fixed` mint, raw status+body captured; `byoc`/`lv2v`
mints recorded for build-drift comparison).

### Verdict: ❌ **`type=fixed` is REJECTED — `HTTP 400 {"error":{"message":"invalid job type"}}`.**

This **confirms the prior analysis empirically**: the deployed
`pymthouse-signer-test-production` does **NOT** support `RemoteType_Fixed`. The
fixed path is still **blocked pending the merged `fixed`+`byoc` signer deploy**.
No asset generated; no payment minted; no on-chain spend.

### PASS/FAIL per stage

| Stage | Endpoint | Result | Evidence (verbatim) |
|---|---|---|---|
| A. native 402 challenge | `POST :8936/apps/runner_riljdzgh/app/generate` (flux-schnell) | ✅ **PASS** | `HTTP 402`, `payment_params` **len 392** = `net.OrchestratorInfo`; per-cap **price `1650818680214/1` (≈ $0.00315 fixed)**; `session_id=caf76760`; `ticket_params=True`; recipient `0x180859c3…a6a252`. Required the funded payer `0x6CAE3C7a…cb7260` (a random payer → `500 insufficient sender reserve`, proving the reserve gate is live and funded). |
| B. **`/generate-live-payment` `type=fixed`** | `POST {signer}/generate-live-payment` | ❌ **FAIL (decisive)** | **`HTTP 400`  body=`{"error":{"message":"invalid job type"}}`** — signer has no `RemoteType_Fixed` handler. |
| C. generation | (native paid re-POST) | ⛔ **not reached** | blocked by stage B (no payment/segCreds minted). |
| C. metering | per-cap debit | ⛔ **not reached** | blocked by stage B. |

### Build-drift matrix — `/generate-live-payment` mint, flux-schnell, `pymthouse-signer-test-production`

| `type` | HTTP | Body |
|---|---|---|
| **`fixed`** (this run's target) | **400** | **`{"error":{"message":"invalid job type"}}`** |
| `byoc` | 500 | `{"error":{"message":"Internal Server Error"}}` |
| `lv2v` (real native gateway path) | 400 | `{"error":{"message":"numTickets 2738510093 exceeds maximum of 100"}}` |

The `lv2v` `numTickets` value is now `2738510093` (vs `2721947758` in the prior
re-test) — i.e. it **scales with the challenge/faceValue** rather than being a
fixed constant, but the `>100` cap is still blown → **still broken**. `byoc`
→ `500`, `fixed` → `400 invalid job type`. **None of the three usable mint types
produce a valid fixed payment** on the deployed test-production signer.

### Current pymthouse signer build (changed vs `sha-4214202f`?)

- **No version/commit endpoint** (`/version` `/info` `/status` `/build` `/commit`
  → `404`; `/healthz` → static `OK`), so the build is **not HTTP-discoverable**.
- **Indirect signal:** `/healthz` is a static file whose `Last-Modified` is
  **`Mon, 27 Jul 2026 02:30:30 GMT`** (`etag "3-6578e8181bd80"`) — this
  **post-dates `sha-4214202f` (Jul-11)**, consistent with John having redeployed
  the service since then. The `:8936` flux-schnell runner id also rotated
  (`runner_dou3fwcx` → **`runner_riljdzgh`**), another sign of infra churn.
- **Behavioral verdict (authoritative):** whatever build is live, it **still
  rejects `type=fixed` (`400 invalid job type`)**. So even if the image changed
  since `sha-4214202f`, **`RemoteType_Fixed` support has NOT been added yet.**

### One-line conclusion

> **Fixed path is NOT green.** The pymthouse signer **REJECTS `type=fixed` with
> `HTTP 400 invalid job type`** on the live `:8936` per-cap flux-schnell challenge
> (which itself is healthy: 402 + per-cap price + ticket params + funded reserve
> all PASS). The native fixed e2e remains **blocked solely on the merged
> `fixed`+`byoc` signer deploy** — an orch/reserve-independent, signer-side change
> owned by John / pymthouse.

### Safety

- **No spend:** every mint failed → zero payment/ticket generated → no on-chain spend.
- **Test-only:** only hit `:8936` `/discovery` + `/apps/.../app/generate` and the
  signer `/generate-live-payment` webhook. **No deploy/rebuild; no signer/orch/
  Caddy/runners mutation; `sdk-staging-1` untouched (DIRECT probe, no container);
  `byoc-staging-1` NEVER touched.** `:8936` healthy (13 runners) throughout.
- Secrets env-only; redacted here.
