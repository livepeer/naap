# LR Fixed-Price Single-Shot — Deploy Runbook (for John)

**Owner:** John (orch-infra / gateway / signer). **Type:** deployment/lineage fix — **no product code changes.**
**Basis:** `LR-AUTHOR-INPUTS-INVESTIGATION.md` (native fixed path already exists in `ja/live-runner` + `v0.9.0`).
**Safety:** additive + reversible; `byoc-staging-1` never touched; secrets env-only/redacted.

## The problem (2 lines)
We are running a **pre-`fixed` BYOC/`lv2v` fleet**: the deployed gateway is BYOC-only (no `live_runner.py`) and the deployed signer is `lv2v`-only (pre-`#3999`). So a **fixed-price single-shot is forced through the `lv2v` 720p30 estimator** (min-60s × 720p30 ≈ 1.66e9 px) → `numTickets 2721947758 exceeds maximum of 100` → **HTTP 400** (and, on the manifest side, `403 mismatched manifest`).

## The fix = deploy the correct lineage (nothing to code)
The native path already works on `ja/live-runner` + `v0.9.0` (`#3999` "runner: Add fixed pricing", `2183b675`): gateway maps `unit=fixed → type=fixed`, the `v0.9.0` signer logic bills `billableUnits=1` (`numTickets ~1`), and the v0.9.0 orch 402 challenge binds `manifest_id = AuthToken.SessionId`. We just aren't running it. Four steps below — **note the signer must be a _merged_ image (`v0.9.0` + `/sign-byoc-job`), not a raw `v0.9.0`** (see step 2 + Regression guardrails):

1. **Gateway/SDK — rebuild `sdk-service` from latest `ja/live-runner`.**
   Replace the stale image on `sdk.daydream.monster` (VM `sdk-staging-1`), currently
   `sdk-service:optA-lr-multi-2026-07-23` (BYOC-only, **no `live_runner.py`**). Build with the vendored
   gateway pinned to **`ja/live-runner`** (tip `9f2bc20`, 2026-07-27) — which ships `live_runner.py` with
   `register_runner(unit=…)` and `_RUNNER_PAYMENT_TYPES_BY_UNIT` (`unit=fixed → type=fixed`).
   **NOT** the BYOC `426f019` / `feat/byoc-inference-capabilities-protobuf`.

2. **Signer — deploy a MERGED signer = `v0.9.0` fixed-pricing + `/sign-byoc-job`.  ← THE ONE CRITICAL MISSING PIECE.**
   Replace `ghcr.io/livepeer/go-livepeer:c0e79ccb` (2026-06-10, `lv2v`-only, no `RemoteType_Fixed`) on
   **`signer-staging-1` and `signer-staging-2`** with a **merged/combined image**, NOT a raw `v0.9.0`:
   - **`v0.9.0` base** — has `RemoteType_Fixed` → `billableUnits=1`, `numTickets ~1`, and binds
     `manifest_id = session_id`. This is what unblocks the fixed single-shot path.
   - **PLUS the `POST /sign-byoc-job` handler** (`SignBYOCJobRequest`, cherry-picked from
     `feat/add-byoc-signing`). **Required** because `signer-staging-1/2` = the shared `signer.daydream.live`
     that serves ALL ~137 `byoc-staging-1` caps; `byoc.py` hard-codes `{signer}/sign-byoc-job` and
     `simple-infra/environments/shared/signers.yaml` states the image MUST include it. A **raw `v0.9.0`**
     dropped this route → deploying it would **break all BYOC inference** (`404 /sign-byoc-job`,
     "Could not verify job creds").

   **⚠️ NO single existing ref has both.** `v0.9.0` and `feat/add-byoc-signing` **diverged at `cbd29d89`
   (2026-06-30)** — neither is an ancestor of the other. The merged image = **v0.9.0 base + cherry-pick the
   byoc-signing commit(s)**. A separate LR-only signer is **NOT** viable because `app.py` resolves a single
   `SIGNER_URL` (`_effective_signer`) for both the LR and BYOC paths — no per-cap signer routing exists.
   **No `v0.9.0`/`#3999` signer is deployed anywhere in the fleet today** — until this merged image lands,
   the fixed path cannot mint `numTickets ~1`. See `LR-DEPLOY-REGRESSION-ASSESSMENT.md` (surface #4).

3. **Discovery — point the SDK at the v0.9.0 orch `:8936`, not the retired BYOC `:8935`.**
   Set `LR_ORCH_DISCOVERY` (+ `LR_OFFERINGS_JSON` per-cap apps) to the native orch
   `liverunner-v09-orch` at `https://136.66.21.17:8936/discovery` (VM `liverunner-staging-1`, running
   `livepeer/go-livepeer:v0.9.0`, on-chain active). Drop the `:8935` BYOC discovery entry.
   (`SDK_MULTI_ORCH_ENABLED=1`, `LR_DESCRIPTOR_DISPATCH=1`, `SELECT_PROVIDER_LR_CAPS` are already correct.)
   **Caveat (verified-safe, keep it that way):** the repoint is additive — byoc caps still route to
   `byoc-staging-1` via `ORCH_URL`/`CAPABILITY_ORCH_MAP`. Just **ensure no LR cap NAME collides with any of
   the ~137 byoc cap names** in `SELECT_PROVIDER_LR_CAPS`/`LR_OFFERINGS_JSON` — a collision would divert that
   byoc cap to `:8936`.

4. **Runners — confirm `unit=fixed` + USD price (already done).**
   The deployed `runners.json` / `runners.v09.json` already set
   `price_info: { price, currency: "usd", unit: "fixed" }` for the fal/tool runners; the v0.9.0 orch
   accepts it and advertises `PixelsPerUnit=1`. Just verify, don't re-register.

## What each piece is / where it runs
| Piece | VM / host | Now | Target |
|---|---|---|---|
| SDK gateway | `sdk-staging-1` (`sdk.daydream.monster`) | `sdk-service:optA-lr-multi-2026-07-23` (BYOC, no `live_runner.py`) | rebuild from `ja/live-runner` `9f2bc20` |
| Remote signer (shared `signer.daydream.live`) | `signer-staging-1` **and** `-2` | `go-livepeer:c0e79ccb` (2026-06-10, lv2v-only) | **MERGED `v0.9.0` + `/sign-byoc-job`** (NOT raw v0.9.0) |
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

## Regression guardrails (per `LR-DEPLOY-REGRESSION-ASSESSMENT.md` → **GO-WITH-MITIGATIONS**)
- **Merged signer is a TRANSITIONAL requirement.** The shared `signer.daydream.live` (`signer-staging-1/2`)
  **must retain `/sign-byoc-job`** as long as `byoc-staging-1` is live. Drop it **only** at the byoc retire
  window — never before, or all ~137 byoc caps fail on-chain. Ship `v0.9.0` + `/sign-byoc-job` merged; a raw
  `v0.9.0` here is a **hard BYOC regression** (NO-GO).
- **Other steps are verified safe (keep AS-IS):**
  - Gateway = raw `livepeer-python-gateway` `ja/live-runner` (`9f2bc20`) — already carries **both**
    `call_runner` **and** all byoc symbols; **NO merge needed**.
  - Discovery repoint to `:8936` is **additive** — byoc caps still route to `byoc-staging-1` (keep LR cap
    names from colliding with byoc cap names).
  - Daydream **lv2v survives** (`/generate-live-payment` retained in `v0.9.0`).
  - `byoc-staging-1` orch **untouched** (iff the shared signer keeps `/sign-byoc-job`).
- **Verdict pointer:** GO-WITH-MITIGATIONS — the single mitigation is the merged signer (step 2). See
  `LR-DEPLOY-REGRESSION-ASSESSMENT.md`.

## Do NOT
- ❌ Don't rebuild or deploy a `#3975-branch` / BYOC image (`426f019`, `3975-singleshot`).
- ❌ Don't reopen or rebase PRs #4006 (go-livepeer) or #49 (gateway) — both closed as wrong-lineage.
- ❌ Don't touch `byoc-staging-1` / the `:8935` orch (distinct tool caps + on-chain serviceURI target).
- ❌ Don't deploy a **raw `v0.9.0`** signer to `signer-staging-1/2` — it drops `/sign-byoc-job` and breaks all BYOC.

**Bottom line:** deploy the `ja/live-runner` gateway + a **MERGED signer (`v0.9.0` + `/sign-byoc-job`)** and
point discovery at `:8936`. The single blocker is step 2 — **no signer with BOTH `RemoteType_Fixed` and
`/sign-byoc-job` exists in the fleet yet** (v0.9.0 and `feat/add-byoc-signing` diverged at `cbd29d89`).
