# LR SDK-Only Deploy — Verification (deploy the `ja/live-runner` gateway ALONE, touch NOTHING else)

**Type:** investigation only — read-only. No code / infra / deploy changes. `byoc-staging-1` inspected read-only, **never touched**.
**Question:** If we deploy the latest SDK `ja/live-runner` gateway build **without changing any signer, orch, or discovery-target**, does the user's claim set (a)–(f) hold? What (if anything) breaks, and what is the safest no-regression plan to reach 137-cap live-runner parity while keeping `byoc-staging-1` alive?

**Verdict in one line:** **Deploying the SDK/gateway ALONE does NOT make the live-runner path work.** The `ja/live-runner` gateway emits `type=fixed` for the fixed single-shot runners, and **NEITHER currently-deployed signer defines `RemoteType_Fixed`** — both hit the `else if req.Type != "" { "invalid job type" }` branch and return **HTTP 400 "invalid job type"**. **BYOC + daydream do NOT regress** — precisely because the signers are untouched, so both retain `lv2v` and `/sign-byoc-job`.

---

## 0. TRUE/FALSE table for claims (a)–(f)

| Claim | Verdict | Evidence + exact failure mode |
|---|---|---|
| **(a)** daydream signer (no change) → works, no regression | ✅ **TRUE** | `ja/live-runner` retains the daydream `lv2v` dispatch. `byoc.py:199` still sends `"type":"lv2v"`; the shared signer's `/generate-live-payment` + `RemoteType_LiveVideoToVideo` are untouched → daydream lv2v survives. Gateway swap is additive (both `call_runner` and byoc symbols present in `ja/live-runner`). **No regression.** |
| **(b)** pymthouse signer (no change) → works for the live-runner-orch signing | ❌ **FALSE** | `ja/live-runner` maps `unit=fixed → type=fixed` (`live_runner.py:45-51` `_RUNNER_PAYMENT_TYPES_BY_UNIT`). The deployed pymthouse DMZ signer `go-livepeer:sha-4214202f` (Jul-11) defines only `RemoteType_LiveVideoToVideo`/`RemoteType_BYOC` — **no `RemoteType_Fixed`**. Its `GenerateLivePayment` branch (`remote_signer.go:700-712`): `type=fixed` is neither `byoc` nor `lv2v` nor `""` → **`errors.New("invalid job type")` → HTTP 400**. **The LR single-shot payment can never mint.** |
| **(c)** byoc-staging-1 (no change) → still works | ✅ **TRUE** | Signers untouched ⇒ shared `signer.daydream.live` keeps `POST /sign-byoc-job`; pymthouse signer keeps `/sign-byoc-job` + `RemoteType_BYOC`. `ja/live-runner` retains the full byoc symbol set + `byoc.py:250` `{signer}/sign-byoc-job` dispatch. `byoc-staging-1` orch untouched. **No regression.** (The hard BYOC regression only occurs if you swap a signer to **raw v0.9.0**, which drops `/sign-byoc-job` — this hypothesis does NOT change the signer.) |
| **(d)** liverunner-orch v0.9.0 on `:8936` → no change, works | ✅ **TRUE (orch needs no change)** | `liverunner-staging-1` is onchain and already runs the v0.9.0-class single-shot stack (advertises `PixelsPerUnit=1`, 402 challenge per #4000/#3992). No orch change required. Caveat: the orch is fine, but the **end-to-end** LR billed path is still blocked by the signer gap in (b) — not by the orch. |
| **(e)** later, 137 fal caps on a 2nd LR orch (one-orch+many-runner) → everything works | ⚠️ **CONDITIONAL / PARTLY TRUE** | Topology is config-deployable now (one runner per cap, per-cap price via `runners.json`; see `LR-ONE-ORCH-MANY-RUNNER-SETUP.md`). **But real blockers beyond authoring descriptors:** (1) the **same `type=fixed` signer gap as (b)** must be fixed first; (2) **per-unit USD metering gap** — fixed-per-call is exact only for per-image caps; per-MP/second/char caps bill a flat reference amount; (3) **not all 137 caps are single-shot-fixed** — streaming/lv2v caps (e.g. `live-video-to-video/scope`) stay on `lv2v`, and tool caps (blender/ffmpeg) / non-image modalities don't cleanly map to the fixed single-shot model; (4) `model_id` drift (`gpt-image`) + `seedance-mini-i2v` price gap. |
| **(f)** keeping byoc-staging-1, **BOTH** the daydream-signer path AND the pymthouse-signer path work | ✅ **TRUE for BYOC / ❌ FALSE for live-runner** | **BYOC + daydream** work on **both** signer paths with zero regression (signers untouched; both retain `lv2v` + `/sign-byoc-job`). **The live-runner leg of the pymthouse path is FALSE** — that is exactly claim (b): `type=fixed` → "invalid job type" 400. So "both signer paths work" is TRUE only for the byoc/daydream (`lv2v`/`byoc`) workloads, not the fixed single-shot LR workload. |

---

## 1. Signer inventory (build + supported payment types)

Two distinct signers are in play. Neither is touched by this hypothesis.

### (i) Daydream / shared signer — `signer.daydream.live` = `signer-staging-1` + `signer-staging-2`
- **What/where:** simple-infra `environments/shared/signers.yaml` — `owner_stack: staging`, `managed_by: pulumi`, HA pair, both `domain: signer.daydream.live`. This is the **default static `SIGNER_URL`** for every non-canary node and the signer that `byoc-staging-1`'s ~137 on-chain caps and the daydream lv2v flow use.
- **Build:** `signers.yaml` `defaults.image` = `livepeer/go-livepeer:pr-3899` (config); prior field investigation reports the **running** build as `c0e79ccb` (Jun-10). Exact running byte-identity is **not** discoverable without VM SSH (no `/version`), but both are `lv2v`-only.
- **Supported payment types / routes (verified at `c0e79ccb`, `server/remote_signer.go`):**
  - `RemoteType_LiveVideoToVideo = "lv2v"` ✅ (the **only** named type at this build)
  - `POST /sign-orchestrator-info` ✅, `POST /generate-live-payment` ✅, **`POST /sign-byoc-job` ✅**, `GET /discover-orchestrators` ✅
  - `RemoteType_Fixed` / `type=fixed` ❌ → `else if req.Type != "" { "invalid job type" }` → **HTTP 400**

### (ii) Pymthouse DMZ signer — `pymthouse-signer-test-production` (Railway, per-key remote signer)
- **What/where:** the per-key signer NaaP returns as `signerSession.{url,headers}` when `per_key_remote_signer` is ON and the node runs `SIGNER_FROM_VALIDATE=1`. Deployed via `pymthouse/docker-compose.clearinghouse.railway.yml` + `config/railway/stack.json`.
- **Build (pinned):** `config/railway/stack.json:28` → **`livepeer/go-livepeer:sha-4214202f4458cda90bd030a0bbdddf7b3a1f52a5`** (committed **2026-07-11**); compose default `sha-469cf754…` (2026-07-10). Both **predate v0.9.0** (2026-07-25) and postdate the `cbd29d89` fixed↔byoc divergence (2026-06-30).
- **Supported payment types / routes (verified at `sha-4214202f`, `server/remote_signer.go` via GitHub):**
  - `RemoteType_LiveVideoToVideo = "lv2v"` ✅
  - `RemoteType_BYOC = "byoc"` ✅ (+ a `useByocPricing` per-cap tariff branch, `remote_signer.go:690-699`)
  - **`POST /sign-byoc-job` (`SignBYOCJobRequest`) ✅** (`remote_signer.go:148`)
  - `RemoteType_Fixed` / `type=fixed` ❌ → `else if req.Type != "" { "invalid job type" }` (`remote_signer.go:708-711`) → **HTTP 400**

**Net:** the pymthouse signer supports **more** than the shared signer (it has `byoc` per-cap pricing too), but **neither** signer supports `type=fixed`. This is the entire blocker.

---

## 2. The crux, traced end-to-end (claim (b))

```
ja/live-runner gateway (9f2bc20)
  discovery price_info.unit = "fixed"   (v0.9.0 single-shot fal runners)
  → _runner_payment_type()  →  _RUNNER_PAYMENT_TYPES_BY_UNIT["fixed"] = "fixed"   (live_runner.py:45-51, 890-912)
  → LivePaymentSession(type="fixed").get_payment()
  → POST {pymthouse_signer}/generate-live-payment  { "type":"fixed", ... }
        │
        ▼
pymthouse signer sha-4214202f (lv2v + byoc, NO fixed)
  GenerateLivePayment:
     if useByocPricing || req.Type=="byoc": ...      ← no
     else if req.Type=="lv2v":            ...         ← no
     else if req.Type != "":  errors.New("invalid job type") → HTTP 400   ← HERE
```

**Exact failure = `HTTP 400 "invalid job type"`** at `/generate-live-payment`.

> **Correction to the prior "numTickets explosion" framing:** that failure (`numTickets 2721947758 exceeds maximum of 100`) belonged to the **older** gateway that sent `type="lv2v"` + the 720p30 estimator. The **current** `ja/live-runner` gateway sends `type="fixed"`, which is rejected **earlier** (at the type switch, before any ticket math) with **"invalid job type" 400**. Both are FALSE for (b); the precise mode is now "invalid job type", not a ticket blow-up.

**For contrast — what a `type=fixed`-capable signer does (verified at `v0.9.0`, `remote_signer.go:470-494`):** `RemoteType_Fixed` sets `billableUnits = 1` → `fee = calculateFee(1, initialPrice)` → **`numTickets ~1`**. That is the target behavior, and it exists **only** in v0.9.0/#3999 lineage.

---

## 3. Precise answer

> **Deploying the SDK/gateway alone WITHOUT signer changes WILL NOT make the live-runner path work**, because the `ja/live-runner` gateway sends `type=fixed` for the fixed single-shot runners and **no currently-deployed signer implements `RemoteType_Fixed`** (shared `signer.daydream.live` = lv2v-only `c0e79ccb`; pymthouse DMZ = lv2v+byoc `sha-4214202f`). Both return **HTTP 400 "invalid job type"** at `/generate-live-payment`.
>
> **BYOC and daydream are TRUE and non-regressing**, precisely **because the signers are untouched**: both signers retain `lv2v` and `/sign-byoc-job`, and the `ja/live-runner` gateway carries the full byoc symbol set alongside `call_runner`. The single thing broken is the live-runner leg, and it is a **signer `type=fixed` gap**, not a gateway, orch, or discovery problem.

---

## 4. Best no-regression deployment plan (goal: keep byoc-staging-1 alive to 137-cap parity)

### 4.1 The contradiction and how `_effective_signer` forces the resolution
- To make the **LR path** work you need a signer with **`RemoteType_Fixed`** (v0.9.0 / #3999).
- To keep **BYOC** working you need **`POST /sign-byoc-job`** — which **raw v0.9.0 dropped** (verified: v0.9.0 registers only `/sign-orchestrator-info`, `/generate-live-payment`, `/discover-orchestrators`).
- **No single existing ref has both** (v0.9.0 and `feat/add-byoc-signing` diverged at `cbd29d89`, 2026-06-30).
- `app.py` resolves **one** `(signer_url, signer_headers)` per request via `_effective_signer` (`app.py:904-923`) and feeds it to **both** the LR dispatch (`app.py:1332`) **and** the byoc dispatch (`app.py:1373`). There is **no per-cap signer routing**.

### 4.2 Minimal signer topology (which signer needs what)

| Signer | Serves | Needs `type=fixed`? | Needs `/sign-byoc-job`? | Action |
|---|---|---|---|---|
| **Shared `signer.daydream.live`** (`signer-staging-1/2`) | `byoc-staging-1`'s 137 on-chain caps + daydream `lv2v` (static `SIGNER_URL`) | **No** (byoc caps never send `fixed`) | **Yes** (137 byoc caps) | **NO CHANGE.** Leave on `c0e79ccb`/`pr-3899`-class. Zero regression. |
| **Pymthouse DMZ signer** (`SIGNER_FROM_VALIDATE=1`, naap path) | the naap billed path — which under `_effective_signer` serves **both** LR caps **and** any byoc cap a naap key requests | **Yes** (LR fixed single-shot) | **Yes**, as long as naap keys may also hit byoc caps through this signer | **Upgrade to a MERGED image** = `RemoteType_Fixed` (v0.9.0/#3999) **+** `SignBYOCJobRequest`/`/sign-byoc-job` **+** `byoc` per-cap pricing (it already has the last two at `sha-4214202f`). |

**Why the pymthouse signer must be MERGED, not raw v0.9.0:** because `_effective_signer` returns it for byoc jobs too, a raw v0.9.0 there would 404 `/sign-byoc-job` for any naap-key byoc cap — a regression on the naap path. Since `sha-4214202f` already carries `byoc` + `/sign-byoc-job`, the cleanest artifact is **"pymthouse signer lineage + cherry-pick `RemoteType_Fixed`"** (equivalently, v0.9.0 + cherry-pick `/sign-byoc-job`). Result: one image supporting **`lv2v` + `byoc`/`sign-byoc-job` + `fixed`**.

> **Scope-narrowing option (only if confirmed safe):** if the naap/live-runner path will serve **only** LR caps and byoc caps are guaranteed to route via the shared signer / a different key class, then the pymthouse signer needs **only `type=fixed`** (raw v0.9.0 would suffice). The **no-regression default** is the merged image, because it preserves today's working pymthouse-path byoc.

### 4.3 Gateway + discovery (both verified safe/additive)
- **Gateway = raw `livepeer-python-gateway` `ja/live-runner` (`9f2bc20`)** — no merge; it already ships both `call_runner` and the full byoc symbol set. `submit_byoc_job` signature is call-site compatible with `app.py`.
- **Discovery additive:** `LR_ORCH_DISCOVERY → :8936` feeds **only** the LR dispatch; byoc caps still route to `byoc-staging-1` via `ORCH_URL`/`CAPABILITY_ORCH_MAP` (`:8935`). LR failure is **fail-open back to BYOC** (`app.py:1349`).

### 4.4 Sequencing that guarantees zero BYOC/daydream regression at each step
1. **Deploy the `ja/live-runner` gateway/SDK image.** Byoc + daydream unchanged (signers untouched). The LR path merely returns "invalid job type" 400 until step 3 — **no regression to any working path** (fail-open to BYOC).
2. **Add LR discovery additively** (`LR_ORCH_DISCOVERY → :8936`, `LR_OFFERINGS_JSON`). Verify **no LR cap NAME collides with any of the 137 byoc cap names** (a collision would divert a byoc cap to `:8936`).
3. **Upgrade ONLY the pymthouse DMZ signer** to the merged (`fixed` + `/sign-byoc-job` + `byoc`) image. **Do NOT touch `signer.daydream.live`** → `byoc-staging-1` + daydream can't regress. Roll it out to one canary key first.
4. **Verify:** LR single-shot mints `numTickets ~1` (no 400); byoc still works on **both** signer paths; daydream `lv2v` intact.
5. **Later (parity):** stand up the 2nd LR orch with per-cap runners for the 137 caps (`LR-ONE-ORCH-MANY-RUNNER-SETUP.md`); migrate incrementally; **only after full parity** consider dropping `/sign-byoc-job` and retiring `byoc-staging-1` — never before, or all 137 caps fail on-chain.

---

## 5. Cap-name collision + other caveats
- **Cap-name collision (highest-risk footgun):** any LR cap name in `SELECT_PROVIDER_LR_CAPS`/`LR_OFFERINGS_JSON` that matches one of the 137 byoc cap names will divert that byoc cap to `:8936`. Keep LR names disjoint from byoc names.
- **Not all 137 caps are single-shot-fixed:** streaming/`lv2v` caps (`live-video-to-video/scope`) stay on `lv2v`; tool caps (blender/ffmpeg) and non-image modalities may not map to the fixed single-shot model. Enumerate before migrating.
- **Per-unit metering gap:** the fixed single-shot path bills a flat per-call amount — exact only for per-image caps (`gpt-image`, `kontext-edit`). Per-MP/second/char caps (flux-*, video, tts) over/under-charge until a per-unit USD metering seam lands.
- **Data gaps:** `model_id` drift (`openai/gpt-image` in the pricing table vs fal's `fal-ai/gpt-image-1/text-to-image` at the runner); `seedance-mini-i2v` price missing from the pricing table/wire.
- **Signer build observability:** neither signer exposes `/version`; the pymthouse running build is asserted from the pinned `sha-4214202f`, which is behaviorally consistent with the observed "invalid job type" for `fixed`.
- **G1 (byoc gRPC parity):** `GetCapabilitiesPrices` still ignores the LR registry even on v0.9.0, so the byoc gRPC `capabilities_prices[]` stays empty for LR caps. Only matters if you drive LR via the byoc gRPC path; the LR-native `/generate-live-payment` `type=fixed` path does not need it.

---

## Appendix — evidence index (all read-only)

- **Gateway `type=fixed` mapping:** `livepeer-python-gateway` `origin/ja/live-runner` (`9f2bc20`, 2026-07-27) `src/livepeer_gateway/live_runner.py:45-51` (`_RUNNER_PAYMENT_TYPES_BY_UNIT` incl. `"fixed":"fixed"`), `:890-912` (`_runner_payment_type`), `:866-889` (`_get_runner_payment`); `byoc.py:199` (`type:"lv2v"`), `:247-268` (`{signer}/sign-byoc-job`).
- **Deployed shared signer:** `go-livepeer` `c0e79ccb` `server/remote_signer.go:35` (`RemoteType_LiveVideoToVideo` only), `:143-152` (routes incl. `POST /sign-byoc-job`), `:525-535` (`type==lv2v` else `type!="" → "invalid job type"`).
- **v0.9.0 signer:** `go-livepeer` tag `v0.9.0` `server/remote_signer.go:35-37` (`live`/`lv2v`/`fixed`), `:82-90` (routes — **no `/sign-byoc-job`**), `:470-494` (`RemoteType_Fixed → billableUnits=1`).
- **Pymthouse DMZ signer:** `pymthouse` `config/railway/stack.json:28` (`go-livepeer:sha-4214202f`), `docker-compose.clearinghouse.railway.yml:55,61`; `go-livepeer` `sha-4214202f` (2026-07-11) `server/remote_signer.go:36-37` (`lv2v`+`byoc`, **no `fixed`**), `:148` (`POST /sign-byoc-job`), `:690-711` (`byoc`/`lv2v`/`"invalid job type"`).
- **Single-signer resolution:** `simple-infra/sdk-service-build/app.py:904-923` (`_effective_signer`), `:1322-1373` (`signer_url_eff` feeds both LR `:1332` and byoc `:1373`), `:1349` (fail-open to BYOC).
- **Shared signer config:** `simple-infra/environments/shared/signers.yaml` (`pr-3899` default image; "Image MUST include /sign-byoc-job…"; `signer.daydream.live` HA pair; per-key remote signer note).
- **Divergence:** `v0.9.0` vs `feat/add-byoc-signing` diverged at `cbd29d89` (2026-06-30) — no single ref has both `fixed` + `/sign-byoc-job`.
- **Cross-refs:** `LR-DEPLOY-REGRESSION-ASSESSMENT.md`, `LR-JOHN-DEPLOY-RUNBOOK.md`, `LR-SINGLESHOT-VS-LV2V-ASSESSMENT.md`, `LR-V0.9.0-ONCHAIN-ASSESSMENT.md`, `LR-ONE-ORCH-MANY-RUNNER-SETUP.md`.
