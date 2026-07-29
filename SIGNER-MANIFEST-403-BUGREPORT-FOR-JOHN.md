# RETRACTED — this report's core claim is WRONG (the 403 was a probe-harness artifact, not a signer bug)

> ## ⛔ RETRACTION BANNER — READ FIRST
>
> **John, please disregard the "signer manifest-binding bug" conclusion below.**
> This report claimed the PRODUCTION pymthouse signer *ignores* the supplied
> `ManifestID` and mints a fresh random id, requiring go-livepeer **PR #4006**.
> **That is incorrect.** The `403 mismatched manifest and auth token` was a
> **test-harness artifact**, not a signer defect:
>
> - The e2e probe that produced it (`scripts/run63-lr-fixed-e2e-prodsigner.py`,
>   L92) **hand-built the sign request and OMITTED the `ManifestID` field
>   entirely**. An empty `ManifestID` is the *one and only* condition under which
>   the signer falls back to `RandomManifestID()`
>   (`server/remote_signer.go` ~L401/L437). That fresh id (`8d6eea88`) then
>   mismatched the challenge `session_id` (`381b5a15`) → the orch's 403.
> - The **real SDK never omits it**: it reads the orch challenge
>   `manifest_id` (= `AuthToken.SessionId`, `ai_http.go` L448) and forwards it to
>   the signer as `ManifestID` (`live_runner.py` L851 → `remote_signer.py` L298).
>   The signer **copies `req.ManifestID`** (`remote_signer.go` L401), so
>   `segCreds.manifestId == session_id` and the 403 does **not** occur.
> - Therefore **#4006 is NOT required** to clear this 403 for the SDK-driven
>   `fixed` flow. It is at most defense-in-depth hardening. #4006 was closed
>   as redundant; closing it was **correct** for the SDK path.
>
> **Full analysis:** [`PR4006-NECESSITY-INVESTIGATION.md`](./PR4006-NECESSITY-INVESTIGATION.md)
> (verdict **(A)** — #4006 not necessary), §2/§5/§7.
>
> **Confirmatory probe:** [`scripts/run64-lr-fixed-manifest-echo-probe.py`](./scripts/run64-lr-fixed-manifest-echo-probe.py)
> is an exact copy of run63 whose *only* substantive change is populating
> `ManifestID = challenge.session_id` (mirroring the SDK). Its decisive decode
> asserts `segCreds.manifestId == session_id`.
>
> ### ✅ Evidence status: e2e-CONFIRMED (2026-07-29, run64)
>
> The retraction is now **empirically confirmed e2e**, not merely code-level.
> `scripts/run64-lr-fixed-manifest-echo-probe.py` was executed against the
> PRODUCTION signer `pymthouse-production.up.railway.app` (`69.46.46.126`) via
> orch `:8936` with the naap composite bearer. With `ManifestID` populated to the
> challenge `session_id` (exactly what the real SDK forwards), the signer
> **echoed** it: `segCreds.manifestId` decodes to `bfe42c1d`, byte-for-byte equal
> to the challenge `session_id` `bfe42c1d` and to `segCreds.auth_token.session_id`
> `bfe42c1d`. The orchestrator's manifest check **passed** — Stage C returned an
> unrelated **`400 model_id is required`**, **not** the previous `403 mismatched
> manifest and auth token`. **$0.00 on-chain spend** (`numTickets=2`, 400 before
> ticket redemption). See `LR-V0.9.0-EXECUTION-REPORT.md` → Run 64.
>
> (The probe's raw `manifestId == session_id ? False` line is a Python
> `bytes`-vs-`str` comparison artifact — `net.SegData.manifestId` is a proto
> `TYPE_BYTES` field, so it decodes to `b'bfe42c1d'`; decoded, the value equals
> `session_id`. This is a probe-comparison quirk, **not** a refutation.) So the
> "signer echoes a *populated* `ManifestID`" link — previously inferred from code
> — is now **directly observed e2e**. **#4006 is confirmed NOT required** for the
> SDK-driven `fixed` flow.
>
> **What this report got right (kept for John):** the *feature-matrix* findings
> in §5/§8 are unaffected — the two deployed signers are **inverted** on
> `fixed` vs `byoc`, and both still fail `lv2v` on `numTickets > 100`. Those are
> real and independent of #4006. See "Still-valid items" at the bottom.

---

<details>
<summary><b>ORIGINAL REPORT (SUPERSEDED — retained for correction trail; do not act on §1/§4/§6)</b></summary>

# Signer bug report — `manifestId` mismatch blocks `type=fixed` live-runner e2e (PRODUCTION pymthouse signer)

**For:** John (pymthouse / go-livepeer signer owner)
**From:** naap live-runner e2e probe (2026-07-29)
**Type:** signer-side code bug — **documentation only**, nothing was deployed/rebuilt/minted on-chain.
**Source of every value below:** verified e2e probe run, recorded in [`LR-V0.9.0-EXECUTION-REPORT.md`](./LR-V0.9.0-EXECUTION-REPORT.md) (final PRODUCTION-signer addendum, commit `74b3feb1`).

> **[CORRECTION]** §1, §4, and §6 below are **WRONG** — see the retraction banner
> at the top. The 403 was caused by the probe omitting `ManifestID`, not by the
> signer mis-binding it. The signer copies a supplied `ManifestID`.

---

## 1. One-line summary

On the **PRODUCTION** pymthouse signer, `type=fixed` mints a valid payment (`HTTP 200`) but binds `segCreds.manifestId` to a **fresh random id instead of the challenge `auth_token.session_id`**, so the orchestrator rejects paid generation with **`403 mismatched manifest and auth token`** — blocking the naap → live-runner `type=fixed` end-to-end path. Fix = 1 line in `server/remote_signer.go` (this is exactly go-livepeer PR #4006 commit 1, which was closed as "redundant" prematurely).

---

## 2. Which signer (with distinctness proof)

Target: **`https://pymthouse-production.up.railway.app`** — the authoritative per-key signer for the naap key (`/keys/validate` resolves this key's signer to this host). It is a **different Railway service** from `pymthouse-signer-test-production`, proven by distinct origin IP, `/healthz` `Last-Modified`, and `etag`:

| Signer host | `remote_ip` | `/healthz` `Last-Modified` | `etag` |
|---|---|---|---|
| **`pymthouse-production.up.railway.app`** (target, authoritative) | **`69.46.46.126`** | **`Wed, 29 Jul 2026 05:00:17 GMT`** | `"3-657b8d4db3a40"` |
| `pymthouse-signer-test-production.up.railway.app` (prior runs) | `69.46.46.1` | `Wed, 29 Jul 2026 04:59:57 GMT` | `"3-657b8d3aa0d40"` |

Every `type=fixed` mint below carried `server: railway-hikari`, `x-railway-edge: ord1`, and a live `x-railway-request-id` (e.g. `NJqYk2W8QU-w_Rfy21mRUA`) from the **`pymthouse-production`** host — confirmed the production signer answered.

> Note: the signer exposes **no** version/commit endpoint (`/version` `/info` `/status` `/build` `/commit` → `404`; `/healthz` → static `OK`), so the build could only be characterized behaviorally.

---

## 3. The exact failing behavior

`type=fixed` **is handled** on production — the mint succeeds — but **generation fails one stage later**:

1. **`type=fixed` mint → `HTTP 200`** (`content-type: application/json`), returns a well-formed `{payment, segCreds, state}`:
   - `state.Type = "fixed"` — `RemoteType_Fixed` is deployed on this signer.
   - `numTickets = 2` (≈1, **well under the 100 cap** — the fixed path sizes tickets correctly, unlike `lv2v`).
   - `expected_price = 1646584719803/1` — matches the orch per-cap price for flux-schnell.
   - sender = funded payer `0x6cae3c7aa09adf84c0ed1c3a53465364cecb7260`.
   - recipient / `OrchestratorAddress = 0x180859c3…a6a252` = the challenge orch.
2. **Carry that mint to paid generation → `HTTP 403`**, body **`mismatched manifest and auth token`** (`content-length: 35`).

The orch rejects at **seg-verification, BEFORE payment redemption** — so nothing is spent (**$0.00**).

---

## 4. Decoded evidence (the actual bug)

The signer sets the fixed mint's `SegData.manifestId` to a fresh random id instead of echoing the challenge's `auth_token.session_id`:

| Field | Value |
|---|---|
| challenge `auth_token.session_id` | **`381b5a15`** |
| minted `segCreds.manifestId` | **`8d6eea88`** |
| `state.StateID` (for reference) | `9a75aa82` |

`manifestId == session_id` → **False** → orch returns `403 mismatched manifest and auth token`.

---

## 5. The two signers are inverted (`fixed` / `byoc` / `lv2v`)

Same live `:8936` flux-schnell challenge, both signers, fresh mints:

| `type` | **`pymthouse-production`** (authoritative) | `pymthouse-signer-test-production` (prior runs) |
|---|---|---|
| **`fixed`** (+`inPixels`) | ✅ **`200`** `{payment,segCreds,state}` — `numTickets 2`, `Type:fixed` → then **`403` at generation** (this bug) | ❌ **`400`** `{"error":{"message":"invalid job type"}}` |
| `byoc` | ❌ `400` `{"error":{"message":"invalid job type"}}` | ✅ `200` `{payment,...}` |
| `lv2v` | ❌ `400` `numTickets 2731486460 exceeds maximum of 100` | ❌ `400` `numTickets 2731486460 exceeds maximum of 100` |

**Takeaway:** production supports `fixed` / rejects `byoc`; test-production supports `byoc` / rejects `fixed`. **No single deployed signer currently has the full set `{fixed, byoc, manifest-binding, working lv2v}`.** The naap → live-runner fixed path needs the **production** signer's `fixed` support (present) **PLUS** the manifest binding (missing).

---

## 6. The exact code-level fix

**File:** `go-livepeer` `server/remote_signer.go` — the non-BYOC / `fixed` live-payment path where `segCreds` / `manifestId` is set.

**Change:** bind the manifest to the challenge session instead of generating a fresh id:

```go
manifestID = oInfo.AuthToken.GetSessionId()   // bind manifest to challenge session
```

This is **exactly PR #4006 commit 1** (`bind manifestID = oInfo.AuthToken.GetSessionId()` for non-BYOC live payments).

> **Reversal, stated honestly:** PR #4006 was **closed earlier as "redundant"** on the assumption that the orch already binds `manifest_id = AuthToken.SessionId`. This production signer **disproves that assumption** — the binding is NOT happening on the signer side, and it **IS** required. The decoded `manifestId 8d6eea88 ≠ session_id 381b5a15` is direct proof. Closing #4006 as redundant was premature; the commit-1 change is needed.

---

## 7. Reproduction steps

Secrets are referenced as `<NAAP_KEY>` (never inline the real key). Existing e2e probe scripts that cover this exact path:

- [`scripts/run61-lr-fixed-probe.py`](./scripts/run61-lr-fixed-probe.py) — native 402 challenge → `type=fixed` mint, raw status/body captured.
- [`scripts/run62-lr-fixed-inpixels-probe.py`](./scripts/run62-lr-fixed-inpixels-probe.py) — same, with `inPixels:1`; also run with the signer base overridden to `pymthouse-production` for the drift matrix.
- [`scripts/run63-lr-fixed-e2e-prodsigner.py`](./scripts/run63-lr-fixed-e2e-prodsigner.py) — carries the accepted `type=fixed` mint through to paid generation and observes the `403`.

Manual steps:

1. **Validate the naap key:** `POST /keys/validate` with `<NAAP_KEY>` → confirms the per-key signer resolves to `pymthouse-production.up.railway.app`.
2. **Discovery / price:** `GET https://136.66.21.17:8936/discovery` (orch `liverunner-v09-orch`, VM `liverunner-staging-1`) → flux-schnell runner `runner_riljdzgh`, `price 1646584719803 wei fixed` (≈ $0.00315).
3. **Native 402 challenge:** `POST :8936/apps/runner_riljdzgh/app/generate` → `HTTP 402` with `payment_params` (len 392) = `net.OrchestratorInfo`; recipient `0x180859c3…a6a252`; requires funded payer `0x6CAE3C7a…cb7260`.
4. **Mint `type=fixed`:** `POST https://pymthouse-production.up.railway.app/generate-live-payment` with `type:"fixed"` (± `inPixels:1`) → `HTTP 200` `{payment, segCreds, state}`; `numTickets 2`; `Type:fixed`; `expected_price 1646584719803/1`.
5. **Carry to generation:** re-`POST :8936/apps/runner_riljdzgh/app/generate` with `Livepeer-Payment` + `Livepeer-Segment` headers → **`HTTP 403` `mismatched manifest and auth token`**.
6. **Decode proof:** `segCreds.manifestId = 8d6eea88` ≠ challenge `auth_token.session_id = 381b5a15`.

---

## 8. What John should ship

Because no single deployed signer has the full feature set, please ship **ONE merged signer build** containing all of:

1. **v0.9.0 `type=fixed` support** (`RemoteType_Fixed`) — already on production.
2. **The `manifestId = AuthToken.SessionId` binding** (PR #4006 commit 1) on the non-BYOC / fixed live-payment path — **this is the fix for this 403**.
3. **The cherry-picked `/sign-byoc-job` handler** — for `byoc` parity (production currently rejects `byoc`).
4. **The `lv2v` `numTickets` fix** — both signers still fail `lv2v` with `numTickets > 100`.

This single build unblocks the naap → live-runner `fixed` e2e and restores `byoc`/`lv2v` parity in one deploy.

---

## 9. Safety confirmation

- **No on-chain spend:** the only successful mint (`fixed`, 200) was rejected by the orch at seg-verification (`403`) **before** `ProcessPayment` / ticket redemption → **$0.00 actual**, zero tickets redeemed. All other mints failed.
- **Read/test-only:** hit only `:8936` `/discovery` + `/apps/.../app/generate` and the signer `/generate-live-payment` + `/healthz` webhooks. **No deploy / rebuild / signer / orch / Caddy / runners mutation.**
- **`byoc-staging-1` — NEVER touched. `sdk-staging-1` — untouched** (direct native probe, no SDK container).
- Secrets env-only; redacted throughout.

</details>

---

## Still-valid items (NOT retracted — independent of the #4006 error above)

These findings from the original §5/§8 do **not** depend on the (wrong) manifest-binding
claim and remain accurate:

1. **The two deployed signers are inverted on job types.** `pymthouse-production`
   (`69.46.46.126`) supports `type=fixed` (HTTP 200, `numTickets 2`,
   `Type:fixed`) but rejects `byoc` (`400 invalid job type`).
   `pymthouse-signer-test-production` is the opposite (supports `byoc`, rejects
   `fixed`). No single deployed signer currently has `{fixed, byoc}` together.
2. **`lv2v` is broken on both** with `numTickets 2731486460 exceeds maximum of 100`.
3. **What John should actually ship** (revised): a single build with **both**
   `type=fixed` and `/sign-byoc-job` (`byoc`) support, plus the `lv2v numTickets`
   fix. **The `manifestId = AuthToken.SessionId` binding (PR #4006) is NOT required
   to clear the 403** — the SDK already supplies the value and the signer copies it.
   #4006 is optional defense-in-depth only.

## Correction provenance

- **Retraction basis:** [`PR4006-NECESSITY-INVESTIGATION.md`](./PR4006-NECESSITY-INVESTIGATION.md) verdict (A) (code-level).
- **Confirmatory probe (created, not yet executed):** [`scripts/run64-lr-fixed-manifest-echo-probe.py`](./scripts/run64-lr-fixed-manifest-echo-probe.py).
- **Evidence status:** code-level; the e2e echo confirmation is pending a run with the naap composite bearer (unavailable this pass). See the run64 section of [`LR-V0.9.0-EXECUTION-REPORT.md`](./LR-V0.9.0-EXECUTION-REPORT.md).
