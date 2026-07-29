# LR Fixed-Price Single-Shot — Deploy Runbook (for John)

**Owner:** John (orch-infra / gateway / signer). **Type:** deployment/lineage fix — **no product code changes.**
**Basis:** `LR-AUTHOR-INPUTS-INVESTIGATION.md` (native fixed path already exists in `ja/live-runner` + `v0.9.0`).
**Safety:** additive + reversible; `byoc-staging-1` never touched; secrets env-only/redacted.

## The problem (2 lines)
We are running a **pre-`fixed` BYOC/`lv2v` fleet**: the deployed gateway is BYOC-only (no `live_runner.py`) and the deployed signer is `lv2v`-only (pre-`#3999`). So a **fixed-price single-shot is forced through the `lv2v` 720p30 estimator** (min-60s × 720p30 ≈ 1.66e9 px) → `numTickets 2721947758 exceeds maximum of 100` → **HTTP 400** (and, on the manifest side, `403 mismatched manifest`).

## The fix = deploy the correct lineage (nothing to code)
The native path already works on `ja/live-runner` + `v0.9.0` (`#3999` "runner: Add fixed pricing", `2183b675`): gateway maps `unit=fixed → type=fixed`, the v0.9.0 signer bills `billableUnits=1` (`numTickets ~1`), and the v0.9.0 orch 402 challenge binds `manifest_id = AuthToken.SessionId`. We just aren't running it. Four steps:

1. **Gateway/SDK — rebuild `sdk-service` from latest `ja/live-runner`.**
   Replace the stale image on `sdk.daydream.monster` (VM `sdk-staging-1`), currently
   `sdk-service:optA-lr-multi-2026-07-23` (BYOC-only, **no `live_runner.py`**). Build with the vendored
   gateway pinned to **`ja/live-runner`** (tip `9f2bc20`, 2026-07-27) — which ships `live_runner.py` with
   `register_runner(unit=…)` and `_RUNNER_PAYMENT_TYPES_BY_UNIT` (`unit=fixed → type=fixed`).
   **NOT** the BYOC `426f019` / `feat/byoc-inference-capabilities-protobuf`.

2. **Signer — deploy a v0.9.0 (≥`#3999`) remote-signer.  ← THE ONE CRITICAL MISSING PIECE.**
   Replace `ghcr.io/livepeer/go-livepeer:c0e79ccb` (2026-06-10, `lv2v`-only, no `RemoteType_Fixed`) on
   **`signer-staging-1` and `signer-staging-2`** with a **`v0.9.0`** build. **No `v0.9.0`/`#3999` signer is
   deployed anywhere in the fleet today** — until this lands, the fixed path cannot mint `numTickets ~1`.

3. **Discovery — point the SDK at the v0.9.0 orch `:8936`, not the retired BYOC `:8935`.**
   Set `LR_ORCH_DISCOVERY` (+ `LR_OFFERINGS_JSON` per-cap apps) to the native orch
   `liverunner-v09-orch` at `https://136.66.21.17:8936/discovery` (VM `liverunner-staging-1`, running
   `livepeer/go-livepeer:v0.9.0`, on-chain active). Drop the `:8935` BYOC discovery entry.
   (`SDK_MULTI_ORCH_ENABLED=1`, `LR_DESCRIPTOR_DISPATCH=1`, `SELECT_PROVIDER_LR_CAPS` are already correct.)

4. **Runners — confirm `unit=fixed` + USD price (already done).**
   The deployed `runners.json` / `runners.v09.json` already set
   `price_info: { price, currency: "usd", unit: "fixed" }` for the fal/tool runners; the v0.9.0 orch
   accepts it and advertises `PixelsPerUnit=1`. Just verify, don't re-register.

## What each piece is / where it runs
| Piece | VM / host | Now | Target |
|---|---|---|---|
| SDK gateway | `sdk-staging-1` (`sdk.daydream.monster`) | `sdk-service:optA-lr-multi-2026-07-23` (BYOC, no `live_runner.py`) | rebuild from `ja/live-runner` `9f2bc20` |
| Remote signer | `signer-staging-1` **and** `-2` | `go-livepeer:c0e79ccb` (2026-06-10, lv2v-only) | **`go-livepeer:v0.9.0` (≥#3999)** |
| Live-runner orch | `liverunner-staging-1` `:8936` (`136.66.21.17`) | `livepeer/go-livepeer:v0.9.0` ✅ already correct | point discovery here |
| BYOC orch | `byoc-staging-1` `:8935` | tool caps + serviceURI target | **do not touch** |

## Verification (re-run the naap-key native e2e)
Re-run the native single-shot e2e with the real NaaP key (e.g. `scripts/run60-lr-native-singleshot.py`,
`POST /inference` → `flux-schnell`) against `:8936`. **PASS signals, in order:**
- `/keys/validate` → `valid:true`, composite bearer resolves the per-key signer (pymthouse).
- Native dispatch to `:8936` (LR offering-driven dispatch ACTIVE; **not** a BYOC `:8935` fallback).
- **402 fixed challenge** with valid `payment_params` (`OrchestratorInfo`), per-cap price, `PixelsPerUnit=1`.
- Payment mint → **`numTickets ~1`** (NOT `2721947758`; no 400).
- Manifest check passes (challenge `manifest_id == session_id`; **no 403**).
- **Real asset generated** + **per-cap metering** recorded (e.g. flux-schnell ≈ $0.00315/MP).

## Do NOT
- ❌ Don't rebuild or deploy a `#3975-branch` / BYOC image (`426f019`, `3975-singleshot`).
- ❌ Don't reopen or rebase PRs #4006 (go-livepeer) or #49 (gateway) — both closed as wrong-lineage.
- ❌ Don't touch `byoc-staging-1` / the `:8935` orch (distinct tool caps + on-chain serviceURI target).

**Bottom line:** deploy the `ja/live-runner` gateway + a **v0.9.0 signer** and point discovery at `:8936`.
The single blocker is step 2 — **no v0.9.0/#3999 signer exists in the fleet yet.**
