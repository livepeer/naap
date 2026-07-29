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

---

## `type=fixed` (+`inPixels`) re-run addendum (2026-07-28, PM / run62) — STILL `400 invalid job type`

**Goal:** run ONE fresh test-only e2e through the pymthouse signer path against the
clean v0.9.0 orch `:8936` (`liverunner-v09-orch`, VM `liverunner-staging-1`, IP
`136.66.21.17`) with payment **`type=fixed`** + **`inPixels:1`**, and capture the
**EXACT** `/generate-live-payment` response verbatim. Re-detect any signer build
drift since run61 (`400 invalid job type`). **READ/TEST-only** — no deploy/rebuild/
mutation of any signer/orch/infra; **`byoc-staging-1` never touched**;
**`sdk-staging-1` never touched** (DIRECT native probe, method (a) — no SDK
container). Secrets env-only/redacted.

Probe: [`scripts/run62-lr-fixed-inpixels-probe.py`](./scripts/run62-lr-fixed-inpixels-probe.py)
(gateway checkout `fix/live-runner-fixed-price-inpixels` @`63cecd6`; native 402
challenge → `type=fixed`+`inPixels:1` mint, raw status+body+headers captured;
`type=fixed` w/o `inPixels`, `byoc`, `lv2v` mints recorded for build-drift).

### THE ANSWER — exact pymthouse signer response to `type=fixed` (VERBATIM)

- **HTTP status:** `400`
- **Response body (exact):** `{"error":{"message":"invalid job type"}}`
- **Notable response headers:**
  `content-type: application/json`,
  `server: railway-hikari`,
  `content-length: 41`,
  `x-railway-edge: ord1`,
  `x-railway-request-id: nqC-m3HfSgu8FdRD55So4g`,
  `date: Wed, 29 Jul 2026 04:22:55 GMT`
- Identical response **with and without** `inPixels:1` → the `inPixels` field is
  irrelevant; the signer rejects the `fixed` job **type** before reading it.

### Verdict: ❌ **`type=fixed` is REJECTED — `HTTP 400 {"error":{"message":"invalid job type"}}`. RemoteType_Fixed still NOT supported.**

No asset generated; no payment minted; no on-chain spend.

### PASS/FAIL per stage

| Stage | Endpoint | Result | Evidence (verbatim) |
|---|---|---|---|
| A. native 402 challenge | `POST :8936/apps/runner_riljdzgh/app/generate` (flux-schnell) | ✅ **PASS** | `HTTP 402`, `payment_params` **len 392** = `net.OrchestratorInfo`; per-cap **price `1666807772086/1` (≈ $0.00315 fixed)**; `session_id=2e5c1503`, `manifest_id=2e5c1503` (**now equal**); `ticket_params=True`; recipient `0x180859c3…a6a252`. Funded payer `0x6CAE3C7a…cb7260`. |
| B. **`/generate-live-payment` `type=fixed` + `inPixels:1`** | `POST {signer}/generate-live-payment` | ❌ **FAIL (decisive)** | **`HTTP 400`  body=`{"error":{"message":"invalid job type"}}`** — signer has no `RemoteType_Fixed` handler. |
| B′. `type=fixed` w/o `inPixels` (control) | same | ❌ **FAIL** | **`HTTP 400`  `{"error":{"message":"invalid job type"}}`** (identical). |
| C. generation | (native paid re-POST) | ⛔ **not reached** | blocked by stage B (no payment/segCreds minted). |
| C. metering | per-cap debit | ⛔ **not reached** | blocked by stage B. |

### Build-drift matrix — `/generate-live-payment` mint, flux-schnell, `pymthouse-signer-test-production`

| `type` | HTTP | Body (verbatim) | vs run61 |
|---|---|---|---|
| **`fixed`** (this run's target) | **400** | **`{"error":{"message":"invalid job type"}}`** | same (`invalid job type`) |
| `byoc` | 400 | `{"error":{"message":"numTickets 101 exceeds maximum of 100"}}` | **CHANGED** (run61 was `500 Internal Server Error`) |
| `lv2v` (real native gateway path) | 400 | `{"error":{"message":"numTickets 2765034077 exceeds maximum of 100"}}` | same class (`numTickets >100`; value scales w/ challenge: 2738510093 → 2765034077) |

### Did the signer build change since run61 (`sha-4214202f`)? Is `type=fixed` now supported?

- **`/healthz` Last-Modified `Mon, 27 Jul 2026 02:30:30 GMT`** (`etag "3-6578e8181bd80"`)
  — **UNCHANGED vs run61**. No version/commit endpoint (`/version` `/info` `/status`
  `/build` `/commit` → `404`), so the build is not HTTP-discoverable.
- **Behavioral drift IS present:** the `byoc` mint moved from run61's `500 Internal
  Server Error` to **`400 numTickets 101 exceeds maximum of 100`** — a different,
  numTickets-computing code path. So *something* on the signer changed even though
  the static `/healthz` file did not. The `:8936` flux-schnell runner id is stable
  at `runner_riljdzgh`.
- **`type=fixed` support: NO — still not added.** Whatever build is live, it returns
  the **identical `400 invalid job type`** for `fixed` (with and without `inPixels`).
  **`RemoteType_Fixed` has NOT been deployed.** None of the three usable mint types
  (`fixed` → `400 invalid job type`; `byoc` → `400 numTickets 101`; `lv2v` → `400
  numTickets 2765034077`) produce a valid fixed payment.

### One-line conclusion

> **Fixed path is NOT green.** The pymthouse signer still **REJECTS `type=fixed`
> with `HTTP 400 {"error":{"message":"invalid job type"}}`** (unchanged from run61;
> `inPixels` makes no difference) on the healthy `:8936` per-cap flux-schnell
> challenge (402 + per-cap price `1666807772086/1` + ticket params + funded reserve
> all PASS). The native fixed e2e remains **blocked solely on the merged
> `fixed`+`byoc` signer deploy** — a signer-side change owned by John / pymthouse.

### Safety

- **No spend:** every mint failed → zero payment/ticket generated → no on-chain spend.
- **Test-only:** only hit `:8936` `/discovery` + `/apps/.../app/generate` and the
  signer `/generate-live-payment` webhook + `/healthz`. **No deploy/rebuild; no
  signer/orch/Caddy/runners mutation; `sdk-staging-1` untouched (DIRECT probe, no
  container); `byoc-staging-1` NEVER touched.** `:8936` healthy (13 runners) throughout.
- Secrets env-only; redacted here.

---

## `type=fixed` on the **PRODUCTION** signer (2026-07-29 / run62+run63) — ✅ **HANDLED (`RemoteType_Fixed` accepted, 200 mint)**

**Goal:** run ONE fresh test-only e2e through the pymthouse signer path against the
clean v0.9.0 orch `:8936` (`liverunner-v09-orch`, VM `liverunner-staging-1`, IP
`136.66.21.17`) with payment **`type=fixed`**, but pointed at the **PRODUCTION DMZ
signer `https://pymthouse-production.up.railway.app`** (NOT the
`pymthouse-signer-test-production` service that run61/run62 previously hit).
Determine whether `type=fixed` behaves differently there. **READ/TEST-only** — no
deploy/rebuild/mutation of any signer/orch/infra; **`byoc-staging-1` never touched**;
**`sdk-staging-1` never touched** (DIRECT native probe — no SDK container). Secrets
env-only/redacted.

Probes: [`scripts/run62-lr-fixed-inpixels-probe.py`](./scripts/run62-lr-fixed-inpixels-probe.py)
(signer base overridden to `pymthouse-production`; `type=fixed`+`inPixels:1` mint +
drift matrix) and [`scripts/run63-lr-fixed-e2e-prodsigner.py`](./scripts/run63-lr-fixed-e2e-prodsigner.py)
(carries the fixed mint through to paid generation). Gateway checkout
`livepeer-python-gateway/src`.

### Proof of WHICH signer answered (host + railway headers)

Both Railway services are **distinct** (different origin IP, `/healthz` etag, and
`Last-Modified`):

| Signer host | `remote_ip` | `/healthz` `Last-Modified` | `etag` | `x-railway-edge` / `server` |
|---|---|---|---|---|
| **`pymthouse-production.up.railway.app`** (target, authoritative) | **`69.46.46.126`** | **`Wed, 29 Jul 2026 05:00:17 GMT`** | `"3-657b8d4db3a40"` | `ord1` / `railway-hikari` |
| `pymthouse-signer-test-production.up.railway.app` (prior runs) | `69.46.46.1` | `Wed, 29 Jul 2026 04:59:57 GMT` | `"3-657b8d3aa0d40"` | `ord1` / `railway-hikari` |

Every `type=fixed` mint response below carried `server: railway-hikari`,
`x-railway-edge: ord1`, and a live `x-railway-request-id` (e.g. `NJqYk2W8QU-w_Rfy21mRUA`)
from the **`pymthouse-production`** host. **Confirmed: the production signer answered.**

**NAAP-key validate resolution:** per stage 0 above, `/keys/validate` already
resolves this key's per-key signer to **`pymthouse-production.up.railway.app`** — i.e.
the authoritative signer for this key IS the one we probed directly here (they agree).

**Signer state (no drift-hiding):** no version/commit endpoint
(`/version` `/info` `/status` `/build` `/commit` → `404`); `/healthz` → static `OK`.
`/generate-live-payment` GET → `405 Method Not Allowed` (POST-only). The `:8936`
flux-schnell runner is `runner_riljdzgh`, price `1646584719803 wei fixed` (≈ $0.00315).

### THE ANSWER — exact PRODUCTION signer response to `type=fixed` (VERBATIM)

- **HTTP status:** `200`
- **Notable response headers:**
  `content-type: application/json`, `server: railway-hikari`,
  `content-length: 1715`, `x-railway-edge: ord1`,
  `x-railway-request-id: NJqYk2W8QU-w_Rfy21mRUA`,
  `date: Wed, 29 Jul 2026 18:41:50 GMT`
- **Response body (exact, `type:"fixed"` + `inPixels:1`):**

```json
{"payment":"CooBChQYCFnDN9FO31iMaF8/erRHKraiUhIHCK67d3WgABofGtDhHqmPfYpcod4gzJsHlXlERY3H54fMLZ+MonPwACIgBrdwfEK/XFZ1HZgfNgJxeyCybqgCzwPGpUwS/O2NoB4qINud7qQT8QHVEF8iDLUEnxGjQ3Hqge7B/KmDI4jPOcdaMgQBhz3IEhRsrjx6oJrfhMDtHDpTRlNkzstyYBolCLwhEiBIIgb3RG6oKR9CalktG0LdbFjXadu+FRLIh5Olrtg9eyJFCAESQVoxdlRstu1bu7Vq4Lkgoo3dwECdTf2sjxvCGHVry3X+ASOwVT79JxQIQx7mZ1ElTfYTUTi/u+NiRZPZ1inLGE4cIkUIAhJBKZKLYyseZedSvrLpj3Tzh5pkeXMNo3t2tPsGbbz2NXcFEyIPVTbJZBR+nuxQZdpM9kbUX9nqA2ZJCAxL4K1xTRwqCQi70+OA9i8QAQ==","segCreds":"CggzYzMwZDBlYhogxdJGAYb3IzySfn2y3McDwOUAtlPKgic7e/rYBF2FpHAiB2ludmFsaWQqQc1K432xxE0eJQtxD5BjMYREIzDtw56/s9856orSHzNNb21sbuDqwD+aUvUC61ny+guecS3bWR9zjrG/aagIOZsbOiAaBAglEAEqGBIWCCUSEgoQCgxmbHV4LXNjaG5lbGwSAEIyCiCAUFzmnBHbOJnYjxFIr9DYu88QEn8IFa2d4GSjT5t+bBIIODVjY2NiNzkY+KCp0wY=","state":{"State":"...(base64 signer state; Type:fixed, InitialPricePerUnit:1646584719803, InitialPixelsPerUnit:1, OrchestratorAddress:0x180859c3...a6a252, AuthID:app_98575870...:owner:d3642304-...)...","Sig":"DD6GSOlACMaGdCJAgh/RV3xZBod0S9fbJT7o/ty9PS4GAnjG041gzypIO2kcQM4QB5n4S/OGa/lf/8L5+3YU6Bw="}}
```

(Identical `200` mint **with and without** `inPixels:1`; the raw full-length body is
in `/tmp/run62_fixed.json`.)

**Decoded `net.Payment` (fixed):** sender `0x6cae3c7aa09adf84c0ed1c3a53465364cecb7260`
(funded payer), `expected_price 1646584719803/1` (== orch per-cap price),
**`numTickets = 2`** (`ticket_sender_params` entries — ~1, WELL under the 100 cap),
`state.Type = "fixed"`, `OrchestratorAddress = 0x180859c3…a6a252` (== challenge recipient).

### Is `type=fixed` / `RemoteType_Fixed` HANDLED on the production signer?

> **YES.** `pymthouse-production` **accepts `type=fixed`** and mints a well-formed
> `{payment, segCreds, state}` with `Type:"fixed"` and a correctly-sized
> **`numTickets = 2`** (the fixed path sizes tickets correctly — it does NOT blow the
> 100-cap the way the `lv2v` path does). `RemoteType_Fixed` is deployed here.

### How it differs from the `test-production` signer

The two services are **inverted** on `fixed` vs `byoc` — decisive proof they run
different builds. Same live `:8936` flux-schnell challenge, both signers, fresh mints:

| `type` | **`pymthouse-production`** (authoritative) | `pymthouse-signer-test-production` (prior runs) |
|---|---|---|
| **`fixed`** (+`inPixels`) | ✅ **`200`** `{payment,segCreds,state}` — `numTickets 2`, `Type:fixed` | ❌ **`400`** `{"error":{"message":"invalid job type"}}` |
| `byoc` | ❌ `400` `{"error":{"message":"invalid job type"}}` | ✅ `200` `{payment,...}` |
| `lv2v` | ❌ `400` `{"error":{"message":"numTickets 2731486460 exceeds maximum of 100"}}` | ❌ `400` `{"error":{"message":"numTickets 2731486460 exceeds maximum of 100"}}` |

So the earlier "`type=fixed` → `400 invalid job type`" verdict was a property of the
**test-production** signer only. **The PRODUCTION signer behaves differently: it
supports `fixed` (and, conversely, rejects `byoc`).** Both still fail `lv2v` on the
`numTickets > 100` cap.

### But the fixed e2e still does NOT complete — generation stops at `403`

Carrying the accepted fixed mint through to paid native generation
(`scripts/run63-lr-fixed-e2e-prodsigner.py`):

| Stage | Endpoint | Result | Evidence (verbatim) |
|---|---|---|---|
| A. native 402 challenge | `POST :8936/apps/runner_riljdzgh/app/generate` | ✅ **PASS** | `HTTP 402`, `payment_params` len 392; per-cap `1646584719803/1`; `session_id`/`manifest_id` equal; recipient `0x180859c3…a6a252`; funded payer `0x6CAE3C7a…cb7260`. |
| B. `/generate-live-payment` `type=fixed`+`inPixels:1` | `POST pymthouse-production/…` | ✅ **PASS** | **`HTTP 200`** `{payment,segCreds,state}`; `numTickets 2`; `Type:fixed`; `expected_price 1646584719803/1`. |
| C. paid native generation | `POST :8936/apps/.../app/generate` (`Livepeer-Payment`+`Livepeer-Segment`) | ❌ **FAIL** | **`HTTP 403`  body=`mismatched manifest and auth token`** (`content-length: 35`). |
| C. metering / debit | per-cap debit | ⛔ **not reached** | blocked by stage C 403; no asset, no debit. |

> ### ⛑️ CORRECTION (2026-07-29, post-#4006 investigation) — the 403 below is a PROBE-HARNESS ARTIFACT, not a signer bug
>
> The "signer mis-binds `segCreds.manifestId`" attribution in the paragraph
> immediately below is **WRONG** and is retracted. The 403 was produced because
> `run63` (L92) **hand-built the sign request and OMITTED the `ManifestID`
> field** — the *only* condition under which the signer falls back to
> `RandomManifestID()` (`server/remote_signer.go` ~L401/L437), yielding the fresh
> `8d6eea88` that mismatched `session_id 381b5a15`. The real SDK forwards
> `ManifestID = challenge.session_id` (`live_runner.py` L851 →
> `remote_signer.py` L298) and the signer **copies `req.ManifestID`**, so the
> 403 does not arise on the SDK path. **PR #4006 is NOT required to clear this
> 403.** See [`PR4006-NECESSITY-INVESTIGATION.md`](./PR4006-NECESSITY-INVESTIGATION.md)
> (verdict A) and the [Run 64 section](#run-64--fixed-manifest-echo-confirming-probe-code-level-verdict-a) below. The retracted signer
> bug report is [`SIGNER-MANIFEST-403-BUGREPORT-FOR-JOHN.md`](./SIGNER-MANIFEST-403-BUGREPORT-FOR-JOHN.md).
> Evidence status: **e2e-CONFIRMED** (2026-07-29) — the run64 echo probe was
> executed against the PRODUCTION signer with the naap composite bearer:
> `segCreds.manifestId` decoded to `bfe42c1d == session_id bfe42c1d` (echoed) and
> Stage C returned an unrelated `400 model_id is required`, **not** the `403
> mismatched manifest`. See the Run 64 section below.

**Root cause of the 403 (proven by decode):** the signer sets the fixed mint's
`SegData.manifestId` to a **fresh random id**, not the challenge's
`auth_token.session_id`:

- challenge `auth_token.session_id` = **`381b5a15`**
- minted `segCreds.manifestId` = **`8d6eea88`**  (also ≠ `state.StateID` `9a75aa82`)
- `manifestId == session_id` → **False** → orch rejects with `403 mismatched manifest and auth token`.

~~This is the same manifest-binding defect noted earlier~~ **[CORRECTED — see the
correction box above: this is a probe-harness artifact, because `run63` omitted the
`ManifestID` field, forcing the signer's `RandomManifestID()` branch. It is NOT a
signer defect and does NOT require #4006.]** Production *accepts* the `fixed`
mint (200); the `8d6eea88` id arose only because the native probe never sent
`ManifestID`. (test-production never gets past the mint for `fixed`.)

### PASS/FAIL summary

- **Stage 0 (validate → prod signer):** ✅ PASS — key resolves to `pymthouse-production`.
- **Stage 1 (discovery/price):** ✅ PASS — `runner_riljdzgh`, `1646584719803 wei fixed`.
- **Stage 2 (native 402):** ✅ PASS.
- **Stage 3 (`type=fixed` mint):** ✅ **PASS — `HTTP 200`, `RemoteType_Fixed` HANDLED, `numTickets 2`.**
- **Stage 4 (generation):** ❌ FAIL — `403 mismatched manifest and auth token` (signer `segCreds.manifestId` ≠ challenge `session_id`).
- **Stage 5 (metering/debit):** ⛔ not reached; no asset; **no spend**.

### One-line conclusion

> **`type=fixed` IS handled on the PRODUCTION signer** (`pymthouse-production`,
> IP `69.46.46.126`): it returns **`HTTP 200`** with a valid `{payment,segCreds,state}`
> fixed mint (`numTickets 2`) — the exact opposite of `pymthouse-signer-test-production`,
> which returns **`400 invalid job type`**. The native fixed e2e still can't finish:
> generation hits **`403 mismatched manifest and auth token`** because the signer
> mis-binds `segCreds.manifestId` (`8d6eea88`) instead of echoing the challenge
> `session_id` (`381b5a15`) — a signer-side manifest-binding fix owned by John / pymthouse.

### Safety

- **No spend:** the only mint that succeeded (`fixed`, 200) was rejected by the orch
  at seg-verification (`403`) **before** `ProcessPayment`/ticket redemption → zero
  on-chain spend. All other mints failed. Well under the ~$3 cap ($0.00 actual).
- **Test-only:** hit only `:8936` `/discovery` + `/apps/.../app/generate` and the two
  signer `/generate-live-payment` + `/healthz` webhooks. **No deploy/rebuild; no
  signer/orch/Caddy/runners mutation; `sdk-staging-1` untouched (DIRECT probe, no
  container); `byoc-staging-1` NEVER touched.** `:8936` healthy (13 runners) throughout.
- Secrets env-only; redacted here.

---

## Run 64 — `fixed` manifest-echo confirming probe (code-level verdict A)

**Purpose:** empirically settle whether the deployed PRODUCTION signer
(`pymthouse-production.up.railway.app`, `69.46.46.126`) *echoes* a **populated**
`ManifestID`, thereby proving the Stage-C 403 in the addendum above was a
**probe-harness artifact** (run63 omitted `ManifestID`) rather than a signer bug.

**Script:** [`scripts/run64-lr-fixed-manifest-echo-probe.py`](./scripts/run64-lr-fixed-manifest-echo-probe.py)
— an exact copy of `run63`. **The only substantive change vs run63:** the Stage-B
sign request is built with `ManifestID` explicitly **populated** to the challenge
`session_id` (the same value the real SDK forwards), instead of omitting it:

```python
# run63 (L92) — OMITS ManifestID  -> signer randomizes -> 8d6eea88 -> 403
payload = {"orchestrator": pp, "type": "fixed", "capabilities": caps_b64, "inPixels": 1}

# run64 — POPULATES ManifestID = session_id  -> signer should echo it -> 200/pass
payload = {"orchestrator": pp, "type": "fixed", "capabilities": caps_b64,
           "inPixels": 1, "ManifestID": session_id}
```

It then decodes `segCreds` (`net.SegData`) and asserts
`segCreds.manifestId == challenge session_id`, before (fail-safe) carrying the
mint to paid generation. A hard `MAX_TICKETS` guard (default 5) aborts Stage C
before any spend if the mint is unexpectedly large; the fixed path mints ~2.

### Execution status — ✅ RUN e2e 2026-07-29 — verdict (A) EMPIRICALLY CONFIRMED

**The run64 echo probe was executed e2e against the PRODUCTION signer** with the
naap composite bearer (`app_…_pmth_…`, secret — not recorded here) on
`https://pymthouse-production.up.railway.app` via orch `:8936`
(`https://136.66.21.17:8936/apps/runner_riljdzgh/app/generate`), funded payer
`0x6cae3c7aa09adf84c0ed1c3a53465364cecb7260`. Verbatim stage results:

| Stage | Endpoint | Result | Evidence (verbatim) |
|---|---|---|---|
| A. native 402 challenge | `POST :8936/apps/runner_riljdzgh/app/generate` | ✅ **PASS** | `HTTP 402`, `payment_params(len=392)`; challenge `manifest_id = bfe42c1d`; decoded `session_id = bfe42c1d` (equal). |
| B. `/generate-live-payment` `type=fixed`+`inPixels:1` **WITH `ManifestID=session_id`** | `POST pymthouse-production/…` | ✅ **PASS** | **`HTTP 200`** `keys=['payment','segCreds','state']`; `sender=0x6cae3c7aa09adf84c0ed1c3a53465364cecb7260`; `numTickets=2`; `expected_price=1641786221713/1`; `server: railway-hikari`, `x-railway-request-id: N-Y1-dawSGKDF4ABEuroCg`, `x-railway-edge: ord1`. |
| B. **decisive decode** | decode `segCreds` (`net.SegData`) | ✅ **ECHOED** | `segCreds.manifestId = b'bfe42c1d'`; `segCreds.auth.session_id = bfe42c1d`; challenge `session_id = bfe42c1d`. **Decoded value equality: `bfe42c1d == bfe42c1d` → TRUE.** |
| C. paid native generation | `POST :8936/apps/.../app/generate` (`Livepeer-Payment`+`Livepeer-Segment`) | ✅ **403 GONE** | **`HTTP 400` body=`model_id is required`** (`server: Python/3.12 aiohttp/3.14.1`) — a **DIFFERENT, non-manifest** downstream error. The `403 mismatched manifest and auth token` **did NOT recur**. |
| C. metering / debit | per-cap debit | ⛔ not reached | 400 at runner request-validation, before `ProcessPayment`/ticket redemption. **No asset, no debit, $0.00 on-chain spend.** |

#### ⚠️ Reading the probe's raw `manifestId == session_id ? False` — it is a type artifact, NOT a value mismatch

The probe printed `[B DECODE] manifestId == session_id ? False` and, on that raw
boolean, its canned line flagged "NOT ECHOED". **That boolean is a Python
`bytes`-vs-`str` comparison artifact, not a refutation.** `net.SegData.manifestId`
is a proto **`TYPE_BYTES`** field (confirmed: `SegData.DESCRIPTOR.fields_by_name
['manifestId'].type == TYPE_BYTES (12)`), so `sd.manifestId` decodes to
`b'bfe42c1d'` (bytes) while `session_id` is `'bfe42c1d'` (str). In Python
`b'bfe42c1d' == 'bfe42c1d'` is `False`, but `b'bfe42c1d'.decode() == 'bfe42c1d'`
is `True`. **The byte content is identical** — `segCreds.manifestId` decodes
exactly to the challenge `session_id` `bfe42c1d`, which also equals the
`segCreds.auth_token.session_id` `bfe42c1d`. (The probe also raised a
`TypeError: Object of type bytes is not JSON serializable` when dumping the
bytes field to `/tmp/run64_fixed_echo.json`, for the same underlying reason; this
did not affect the stdout evidence above.)

Two independent lines of evidence therefore both point the same way:
1. **Decode:** `segCreds.manifestId` (decoded) `= bfe42c1d == session_id bfe42c1d`
   → the signer **echoed** the supplied `ManifestID`.
2. **Orch check:** Stage C returned `400 model_id is required`, **not** `403
   mismatched manifest and auth token` — i.e. the orch's
   `segData.ManifestID == segData.AuthToken.SessionId` check (`ai_http.go` L284)
   **PASSED**. The 400 is an unrelated runner-app request-validation error (the
   native probe sends `{"prompt": …}` but the runner requires `model_id`), which
   per the interpretation rubric still confirms the manifest 403 is resolved.

Contrast with **run63** (same script, `ManifestID` **omitted**): there
`segCreds.manifestId = 8d6eea88` was a *genuinely different value* from
`session_id 381b5a15` (the `RandomManifestID()` fallback), producing the real
`403`. With `ManifestID` populated (run64), the value is echoed and the 403 is gone.

### Verdict — (A) EMPIRICALLY CONFIRMED

The deployed PRODUCTION signer (`pymthouse-production`, `69.46.46.126`) **echoes a
populated `ManifestID`** (`segCreds.manifestId == challenge session_id ==
segCreds.auth session_id == bfe42c1d`), and the orch's manifest check passes end
to end (the 403 is replaced by an unrelated `400 model_id is required`). This
closes the one link §7 of `PR4006-NECESSITY-INVESTIGATION.md` marked
"inferred, not directly e2e-tested". **go-livepeer PR #4006's signer-side manifest
binding is NOT necessary** for the SDK-driven `fixed` live-runner flow; run63's
403 was purely the harness omission of `ManifestID`. #4006 remains at most
defense-in-depth hardening.

### Safety / spend

- **$0.00 on-chain spend.** The successful fixed mint carried `numTickets=2`
  (under the `MAX_TICKETS=5` fail-safe). Stage C returned `400` at runner
  request-validation **before** `ProcessPayment`/ticket redemption → no asset,
  no debit.
- **No deploy/rebuild/mutation.** Hit only `:8936` `/apps/.../app/generate` and
  the signer `/generate-live-payment`. `byoc-staging-1` / `sdk-staging-1`
  untouched (direct native probe, no SDK container). No PRs reopened/closed.
- Secrets env-only (composite bearer never echoed/logged/committed).

### To run it (when the naap composite bearer is available)

```bash
GWPY=../livepeer-python-gateway/.venv/bin/python
# derive COMPOSITE_BEARER from the naap key (endpoint-form validate):
export COMPOSITE_BEARER="$(curl -sS -X POST "$NAAP_VALIDATE_URL" \
  -H "Authorization: Bearer $NAAP_KEY" | jq -r '.data.signerSession.headers.Authorization')"
export BYOC_SIGNER_URL="https://pymthouse-production.up.railway.app"
export RUNNER_APP_URL="https://136.66.21.17:8936/apps/runner_riljdzgh/app"
export PAYER_ADDRESS="0x6cae3c7aa09adf84c0ed1c3a53465364cecb7260"   # funded test payer
export GATEWAY_SRC="../livepeer-python-gateway/src"
"$GWPY" scripts/run64-lr-fixed-manifest-echo-probe.py   # writes /tmp/run64_fixed_echo.json
```

Expected (verdict A): `[B DECODE] manifestId == session_id ? True` and Stage C
returns `200` (or a *different*, non-manifest downstream error). If instead
`segCreds.manifestId != session_id` even with a populated field, verdict (A) is
refuted and #4006 (or equivalent) IS needed — the script flags this loudly.
