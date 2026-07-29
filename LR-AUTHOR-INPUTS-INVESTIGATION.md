# LR Fixed-Price Single-Shot — Author Inputs Investigation

**Mode:** Read-only investigation. No code/PR/deploy/infra changes. `byoc-staging-1` untouched.
**Operator:** qiang@livepeer.org (gcloud `livepeer-simple-infra`); doc commit as `seanhanca`.
**Author claim under test:** *"The native fixed-price single-shot just works if the runner is
registered with `unit=fixed` + USD price on the latest `ja/live-runner` SDK, WITHOUT the `inPixels`
change or manifest logic."*

## TL;DR — the author is right; we were on the wrong lineage

**Verdict: the author is correct.** The `numTickets 2721947758` bug and the `403 mismatched manifest`
are **not bugs to patch** — they are the symptoms of running a **fixed-price single-shot through the
old BYOC/`lv2v` code lineage that predates the native `fixed` payment type** (go-livepeer `#3999`,
released in `v0.9.0`; gateway `ja/live-runner`). On the current `ja/live-runner` / `v0.9.0` line the
whole flow is already implemented end-to-end:

- gateway derives payment `type=fixed` from `price_info.unit=="fixed"` and sends it,
- the v0.9.0 signer's `fixed` branch sets `billableUnits = 1` → `numTickets ~1`,
- the v0.9.0 orchestrator's 402 challenge already sets `manifest_id = AuthToken.SessionId`.

Our **PR #4006 (signer) and PR #49 (gateway) are built on BYOC-lineage branches, not `ja/live-runner`**,
so they re-implement (as `lv2v` hacks) behavior the SDK already provides natively. And the **deployed
system is stale** (SDK-service gateway = BYOC-only, no `live_runner.py`; remote signer = `c0e79ccb`
from **2026-06-10**, `lv2v`-only, pre-`#3999`), so the correct native behavior isn't even present in
the running services. **All three hypotheses (a)+(b)+(c) are TRUE and compound.**

**→ Abandon #4006 and #49. Do not rebase them.** The fix is a **deployment/lineage** change, not code.

---

## Evidence per author point

### Point 1 — "Are those PRs based off the latest `ja/live-runner` SDK branch?" → **NO (both BYOC-lineage)**

Confirmed PR bases (via `gh`, both **OPEN**):

| PR | Repo | Head | **Base** | Lineage |
|----|------|------|----------|---------|
| **#4006** | go-livepeer | `fix/live-payment-manifest-session-id` | `feat/remote-signer-byoc-v2` | **BYOC** |
| **#49** | livepeer-python-gateway | `fix/live-runner-fixed-price-inpixels` | `feat/byoc-inference-capabilities-protobuf` | **BYOC** |

Divergence from `ja/live-runner` (git merge-base / rev-list, local checkouts):

**go-livepeer #4006 (HEAD `dd4ff4f3`, 2026-07-28)**
- `merge-base HEAD origin/ja/live-runner` = **`9e68815a` "Remove x11 from MacOS builds (#3889)"** (**2026-04-02**).
- `ja/live-runner` has **115 commits not in #4006**; #4006 has 18 not in `ja/live-runner`.
- `git merge-base --is-ancestor origin/ja/live-runner HEAD` → **NO** — `ja/live-runner` is **not** an
  ancestor. #4006's base `feat/remote-signer-byoc-v2` tips at `be5a669e` (**2026-05-13**), a BYOC branch.

**gateway #49 (HEAD `63cecd6`, 2026-07-28)**
- `merge-base HEAD origin/ja/live-runner` = **`03f13ad`** (**2026-05-29**).
- `ja/live-runner` (tip `9f2bc20` "Add SSE support to single-shot calls (#25)", 2026-07-27) has
  **13 commits not in #49**; #49 has 6 not in `ja/live-runner`.
- `is-ancestor` → **NO**.

**Canonical SDK confirmation:** the live-runner SDK work landed to `master` and shipped in **`v0.9.0`**
(tag `df527c37`, 2026-07-25): commits `a6ad0f36 "Add single-shot payments (#4000)"`,
`5c8d3df2 "Live Runner (#3938)"`, and — crucially — **`2183b675 "runner: Add fixed pricing (#3999)"`**.
**None of these are in #4006's HEAD** (`git log HEAD --grep` for single-shot / fixed pricing → empty;
only BYOC pricing `4b0cf2fb` + the manifest fix). So `ja/live-runner` (≈`v0.9.0`) is the canonical SDK
branch, and **both PRs were built on the BYOC lineage instead.**

> **Answer: NO.** Neither PR descends from `ja/live-runner`; both sit on ~2-3-month-old BYOC branches.

---

### Point 2 — "Set `unit=fixed` + USD price in `register_runner`; then the `inPixels` change is not needed." → **CORRECT on the latest SDK; NOT honored on our lineage or in the deploy**

**`unit` field, default, allowed values (go-livepeer `#3999`, in v0.9.0 — `ai/runner/live_runner.go`):**
- `normalizeLiveRunnerPriceInfo` accepts `unit ∈ {hour, 720p, fixed}`; **default `hour`**.
- `fixed` = "*converted directly from USD to wei without a time or pixel divisor and advertised as
  `fixed`*"; the orch debits **exactly one unit per request** with `PixelsPerUnit == 1`.

**Native signer path (`server/remote_signer.go`, `#3999`):**
```
const RemoteType_Fixed = "fixed"
...
} else if req.Type == RemoteType_Fixed {
    billableUnits = 1          // → numTickets ~1, no 720p30 recompute
}
```
**Native orch acceptance (`server/ai_http.go`, `#3999` `reservePaidLiveRunnerSession`):**
`fixedPayment := EqualFold(priceInfo.Unit,"fixed")` → requires `PixelsPerUnit == 1`, accounts `units:1`
once, and **rejects follow-up payments** on a fixed session.

**Does `unit=fixed` drive the payment `type` on the latest gateway?** — **YES, natively.**
`ja/live-runner` gateway `src/livepeer_gateway/live_runner.py`:
- `_RUNNER_PAYMENT_TYPES_BY_UNIT = { ..., "fixed": "fixed" }` (and `hour`/`720p` → their types),
- `_runner_payment_type(runner, payment_unit)` derives the type from `runner.price_info.unit`
  (discovery-authoritative),
- `_get_runner_payment(...)` sends **`type=payment_type`** (so `unit=fixed` ⇒ `type=fixed`),
- `register_runner(...)` has **`unit: str = "hour"`** (proper live-runner unit),
- fixed sessions skip the metering loop: `payment_session=None if payment_type == "fixed" else …`.

**Does it on OUR gateway (#49)?** — **NO.** `src/livepeer_gateway/live_runner.py` `_get_runner_payment`
**hardcodes `type="lv2v"`** and only bolts on `in_pixels=_fixed_price_in_pixels(runner)` — which returns
`1` when `price_info.unit=="fixed"`, else `None`. Our `register_runner` even uses BYOC-style pricing
(`price_per_unit`, `pixels_per_unit`, `unit: str="USD"` = a *currency*), not the live-runner
`{price, currency, unit=hour|720p|fixed}` schema. So on our lineage the runner's `unit=fixed`
**does NOT propagate to the payment type** — it only flips `inPixels` to `1` while the request stays
`type="lv2v"`.

**Static `runners.json` vs the dynamic `register_runner` path:**
- The deployed static config (`live-runner-v2/runners.json`, matching the VM's `runners.v09.json`)
  **does set `"price_info": { "price": "...", "currency": "usd", "unit": "fixed" }`** for all fal/tool
  runners. So the **orch** correctly advertises `unit=fixed` (v0.9.0 accepts it, `PixelsPerUnit=1`).
- **But the unit stops at the orch.** The gateway (#49) reads it only via `_fixed_price_in_pixels` →
  `inPixels:1`, and still sends **`type="lv2v"`**. The static unit therefore **does not** cause the
  signer to take the fixed path; the gateway effectively treats it as `lv2v`.
- **The deployed signer can't take a fixed path anyway** (see Point 4): `c0e79ccb` (2026-06-10) has
  **no `RemoteType_Fixed`** — its `GenerateLivePayment` only handles `lv2v` (which overwrites `InPixels`
  with a 720p30 estimate ≈ 1.66e9 → `numTickets 2721947758 > 100` → **400**), and returns
  `"invalid job type"` for any non-empty, non-`lv2v` type. So even if the gateway sent `type=fixed`
  today, the live signer would reject it.

> **Answer: the author's mechanism is correct on the latest SDK** — `unit=fixed` makes the gateway send
> `type=fixed`, the signer bill `billableUnits=1` (`numTickets ~1`), and the `inPixels`/`lv2v` hack
> becomes unnecessary. **It fails in our system only because our gateway (#49) hardcodes `type="lv2v"`
> and the deployed signer predates `#3999`.** `unit=fixed` alone is necessary but not sufficient *unless*
> the gateway **and** signer are on the `ja/live-runner`/`v0.9.0` line.

---

### Point 3 — "The live runner should already have `manifest_id = AuthToken.SessionId`, so why is the extra logic needed?" → **CORRECT; #4006's manifest binding is redundant on the native path**

- **The 402 challenge already binds it.** v0.9.0 `server/ai_http.go :: runnerChallenge` emits
  `ManifestID: oInfo.GetAuthToken().GetSessionId()`. The gateway forwards `challenge.manifest_id` to
  the signer, so the signed `SegData.ManifestID` equals the session id.
- **The 403 originates in the v0.9.0 ORCH**, not the signer: `ai_http.go:284`
  `if string(segData.ManifestID) != segData.AuthToken.SessionId { respondWithError("mismatched manifest
  and auth token", 403) }`.
- **#4006's own commit message admits this** ("*The orchestrator's live-runner enforces
  SegData.ManifestID == AuthToken.SessionId … GenerateLivePayment derived the manifest id from the
  request (or a fresh RandomManifestID when empty)*"). Its fix — signer-side
  `if req.Type != BYOC { manifestID = oInfo.AuthToken.SessionId }` — only matters because the **stale
  `lv2v`-only signer** (`c0e79ccb`) doesn't propagate the challenge's session-bound manifest (in the
  `lv2v` stateful branch it can mint a `RandomManifestID`). On the native `fixed` path the challenge
  supplies `manifest_id = session_id` and the signer signs it verbatim, so the check passes with **no
  signer patch**.

> **Answer: YES, already handled upstream.** The binding lives in the v0.9.0 orch challenge; #4006's
> signer-side binding is a redundant workaround for the stale `lv2v`-only signer.

---

### Point 4 — "Does `sdk.daydream.monster` have the latest SDK from `ja/live-runner`?" → **NO — it is STALE (BYOC lineage), and so is the signer**

Live state (gcloud `livepeer-simple-infra`, read-only):

| Component | VM | Running build | On `ja/live-runner`/`v0.9.0` line? |
|-----------|----|--------------|-----------------------------------|
| **SDK service** (`sdk.daydream.monster`) | `sdk-staging-1` | image **`sdk-service:optA-lr-multi-2026-07-23`** | **NO** — vendors a **BYOC-only gateway with NO `live_runner.py`** |
| **Remote signer** | `signer-staging-1` **and** `-2` | **`ghcr.io/livepeer/go-livepeer:c0e79ccb`** (2026-06-10 "reject tickets with zero expiration block") | **NO** — pre-`#3999`, `lv2v`-only |
| **Live-runner orch** | `liverunner-staging-1` `:8936` | **`livepeer/go-livepeer:v0.9.0`** | **YES** (has `#3999` fixed pricing) |

Corroborating detail:
- `GET https://sdk.daydream.monster/health` → `{"orchestrator":"https://byoc-staging-1.daydream.monster:8935"}`
  — the shared SDK is pointed at the **BYOC orch (`:8935`)**, *not* the native v0.9.0 orch (`:8936`).
- `GET /capabilities` returns **BYOC-style pricing** (`price_per_unit`/`price_scaling`/`display_unit`),
  `/version` and `/info` → 404.
- The vendored gateway in `simple-infra/sdk-service-build/livepeer-gateway/src/livepeer_gateway/`
  (Mar 27–Jul 10 files) **has no `live_runner.py`** and no `register_runner`/`_RUNNER_PAYMENT_TYPES_BY_UNIT`
  — it's the `lv2v`/BYOC/scope-era SDK. `LR-V0.9.0-EXECUTION-REPORT.md` independently confirms the live
  image raised `ImportError` on `from livepeer_gateway import live_runner`.
- Even the remediation image `sdk-service:lr-call-runner-2026-07-28` pins gateway **`426f019`**, which is
  **`feat/byoc-inference-capabilities-protobuf` (BYOC), confirmed NOT an ancestor of `ja/live-runner`** —
  and it was **not applied to shared staging** (gated on owner approval).
- The signer exposes no version endpoint; the build was identified from the running container image tag.

> **Answer: YES, stale.** `sdk.daydream.monster` runs a BYOC-lineage SDK image pointed at the BYOC orch,
> and both signers run a 2026-06-10 `lv2v`-only go-livepeer. Only the orch on `liverunner-staging-1:8936`
> is on the current line. The gap: SDK gateway ~≥ July-27 `ja/live-runner`; signer needs `v0.9.0`/`#3999`.

---

## The single ROOT-WHY

> **We are running (and patching) the OLD BYOC/`lv2v` lineage, which predates the native `fixed`
> payment type (`#3999`, in `v0.9.0` / `ja/live-runner`).** On that lineage a fixed-price single-shot is
> forced through the `lv2v` pixel estimator (min-60s × 720p30 ≈ 1.66e9 pixels → `numTickets 2721947758
> > 100` → **400**), and the manifest isn't session-bound (→ **403**). PR **#49 (`inPixels:1`)** and PR
> **#4006 (honor `InPixels` on `lv2v` + bind manifest)** are hand-built workarounds that make the `lv2v`
> path *imitate* the native `fixed` path. On the latest `ja/live-runner` SDK the gateway already sends
> `type=fixed` (from `unit=fixed`), the `v0.9.0` signer already bills `billableUnits=1` (`numTickets ~1`),
> and the `v0.9.0` orch challenge already binds `manifest_id=session_id`. It "just works" — but the
> **deployed gateway is BYOC-only and the deployed signer is a pre-`#3999` `lv2v`-only build**, so the
> native behavior is absent from the running system.

All three candidate hypotheses hold and compound:
- **(a) TRUE** — #4006/#49 built on BYOC lineage, patching code the SDK already handles.
- **(b) TRUE** — runners are *not* effectively `unit=fixed` in the payment path: the static
  `runners.json` unit reaches the orch but the gateway hardcodes `type="lv2v"` (unit only flips
  `inPixels:1`), and the deployed signer can't process `fixed` at all.
- **(c) TRUE** — deployed SDK image (BYOC, no `live_runner.py`, → `:8935`) and deployed signer
  (`c0e79ccb`, June-10, `lv2v`-only) are stale vs `ja/live-runner`/`v0.9.0`.

The **primary lever** is the **deployed signer + SDK gateway lineage** (b)+(c); (a) is why the PRs exist.

---

## The correct minimal path (per the author) — deployment, not code

1. **Get the SDK-service gateway onto `ja/live-runner`.** Rebuild `sdk-service` with the vendored
   gateway pinned to `ja/live-runner` (tip `9f2bc20`), which ships `live_runner.py` with
   `register_runner(unit=…)`, `_RUNNER_PAYMENT_TYPES_BY_UNIT`, and `type=fixed` dispatch. **Not** the
   BYOC `426f019`.
2. **Deploy a signer on the `v0.9.0`/`ja/live-runner` line** (has `RemoteType_Fixed` → `billableUnits=1`).
   Replace `c0e79ccb` on `signer-staging-1/2`.
3. **Point SDK discovery at the native orch `:8936`** (`livepeer/go-livepeer:v0.9.0` on
   `liverunner-staging-1`, already deployed), not the BYOC orch `:8935`.
4. **Register the fal/tool runners with `price_info.unit = "fixed"` + USD price** — already done in
   `runners.json`; the v0.9.0 orch accepts it and advertises `PixelsPerUnit=1`.
5. Result: gateway sends `type=fixed` → signer bills `billableUnits=1` (`numTickets ~1`) → orch bills
   once; challenge binds `manifest_id=session_id`. **No `inPixels`, no manifest patch, no divergent
   image.**

### Should #4006 and #49 be abandoned or rebased? → **ABANDON (do not rebase)**

- **#4006 (signer `lv2v` honors `InPixels` + manifest binding):** **Abandon.** Both effects exist
  natively on `v0.9.0` (`fixed` → `billableUnits=1`; challenge → `manifest_id=session_id`). Rebasing onto
  `ja/live-runner` would re-implement shipped functionality and conflict. The signer fix is
  *deploy `v0.9.0`*, not patch `lv2v`.
- **#49 (gateway `inPixels:1` on `lv2v`):** **Abandon.** The latest gateway sends `type=fixed` from
  `unit=fixed`; the `inPixels:1`-on-`lv2v` hack is obsolete. The gateway fix is *deploy `ja/live-runner`*,
  not patch the BYOC branch.

---

## Confidence & unknowns (stated, not guessed)

- **High confidence** on Points 1–4: git merge-base/rev-list on local checkouts, `#3999`/`v0.9.0`
  source diffs, the `ja/live-runner` gateway source, live HTTP probes, and running container image tags
  (`sdk-staging-1`, `signer-staging-1/2`, `liverunner-staging-1`) all agree.
- **`ja/live-runner` local ref** (`origin/ja/live-runner`) resolved to gateway `9f2bc20` (2026-07-27) and
  go-livepeer `c2db3cbc` (2026-07-13); the go-livepeer branch fetch reported "couldn't find remote ref"
  (branch likely merged→`v0.9.0` and the tracking ref is retained), so for go-livepeer the **released
  `v0.9.0` tag was used as the authoritative live-runner-line source**. This does not affect any verdict.
- **Not exercised end-to-end here** (read-only): an actual `type=fixed` payment against a `v0.9.0` signer
  in *this* fleet — because no `v0.9.0`/`#3999` signer is deployed. The path is proven by source +
  upstream tests (`TestLiveRunnerFixedPriceSessionAccountsOnce`), not a live mint on our signers.

---

*Evidence: go-livepeer `v0.9.0` (`df527c37`), `#3999` (`2183b675`), `#4000` (`a6ad0f36`), PR #4006
(`dd4ff4f3`, base `feat/remote-signer-byoc-v2`), signer `c0e79ccb`; gateway `ja/live-runner` (`9f2bc20`)
and PR #49 (`63cecd6`, base `feat/byoc-inference-capabilities-protobuf`); `live-runner-v2/runners.json`;
`simple-infra/sdk-service-build/{Dockerfile,app.py,livepeer-gateway/}`; live probes of
`sdk.daydream.monster`; gcloud `livepeer-simple-infra` container images on `sdk-staging-1`,
`signer-staging-1/2`, `liverunner-staging-1`. Read-only.*
