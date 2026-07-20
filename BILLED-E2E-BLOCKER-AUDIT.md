# Billed E2E Blocker Audit — naap_ → Billed Inference → OpenMeter

**Date:** 2026-07-17 (Run 47 — live probes + code review)  
**Method:** Live HTTP probes against prod/staging endpoints, `gh` PR status, gateway commit `1bf13cd` source review, gateway venv `submit_byoc_job` (certifi), Storyboard MCP regression.  
**Honesty rule:** This doc states what **failed today**, not what passed last week.

---

## ✅ UPDATE — Run 51 (2026-07-17): FIRST BILLED IMAGE — B5 RESOLVED

The remaining hot blocker after auth/payment-gen was **not** sender reserve — it was an **orchestrator price mismatch** (latent blocker **B5**, `recipientRand`/ticket-param alignment). `GetCapabilitiesPrices` advertised the **un-adjusted base** per-cap price while `PriceInfoForCaps` bound `base × (1 + 1/txCostMultiplier)` (~1%) into `RecipientRandHash`; the signer copied the advertised price into `ExpectedPrice` → `invalid recipientRand` → `400 Could not parse payment`.

- **Fixed:** [go-livepeer#3993](https://github.com/livepeer/go-livepeer/pull/3993) — shared `applyAutoAdjustOverhead` applied to advertised `CapabilitiesPrices` (advertised == bound).
- **Deployed:** exact-parity image (`b1ea581` + fix) via Cloud Build `b5c72219` → GAR `…/go-livepeer:byoc-cap-price-overhead-20260717`, live on `byoc-staging-1` (`/opt/byoc/.env` `ORCH_IMAGE`, reversible; `.env.bak.capfix`).
- **Result:** `flux-schnell` + `flux-dev` → **HTTP 200 + real image URLs**; prices match (`1060500`, `8837500`); per-cap ratio **8.33×** confirmed on-chain. **Signer restart NOT needed** (gateway re-fetches orch info per job). Full detail: `USER-E2E-DEMO-RESULTS.md` Run 51.

---

## Executive answer

**Is pymthouse#255 the only blocker left?** **No.**

#255 is the **primary** blocker for payment-generation identity (401 `not a JWT` at the remote-signer webhook), but it is **not sufficient alone** for first billed generation. Today’s live probes surfaced **two additional active blockers** and several **latent** ones that will appear immediately after #255 lands.

| Question | Answer |
|---|---|
| Is #255 merged/deployed? | **NO** — OPEN, `mergeStateStatus: DIRTY`, **merge conflicts** |
| Is #255 alone enough for first billed gen? | **NO** — see Section E |
| What failed today on the hot path? | Webhook auth (#255) + validate **regressed** to token-bundle (no composite endpoint) |
| Did failure mode change vs Run 46? | **YES** — validate no longer emits `{url, headers}` composite bearer; SDK error class shifted to `IncompleteRead` (truncated signer response during failed payment gen) |

---

## Section A — Current blockers (pipeline order)

### A1. NaaP validate — **PARTIAL PASS / REGRESSION**

| Probe | Result | Detail |
|---|---|---|
| `POST operator.livepeer.org/api/v1/keys/validate` + Bearer `naap_…` | **HTTP 200** | `valid: true`, `billingAccount.providerSlug: pymthouse` |
| `signerSession` shape | **REGRESSION** | **Token-bundle only:** `{ accessToken: pmth_…, tokenType, expiresIn, scope }` — **no** `{ url, headers.Authorization }` endpoint form |
| Composite `app_98575870….pmth_…` bearer | **MISSING** | Run 46 emitted composite endpoint form; Run 47 does not |
| `capabilities[]` | **EMPTY** | `[]` — `pymthouse_bpp_validate` likely OFF or M2M resolution fail-closed (non-blocking for BYOC gen) |

**Failure point:** `resolveSignerEndpoint()` is not succeeding. Code path (`keys/validate/route.ts:212-230`) fail-safes to token-bundle on any error. Most likely causes:

1. **`PYMTHOUSE_API_KEY` composite (`app_XXX.pmth_YYY`) unset** on NaaP prod Vercel — fast-path in `PymthouseAdapter.resolveSignerEndpoint()` never runs.
2. Legacy mint / `getSignerRouting()` path failing silently (caught, token-bundle kept).
3. `per_key_remote_signer` flag OFF for `livepeer-dev` (less likely — would still return token-bundle, but endpoint swap would not be attempted).

**Impact:** SDK with `SIGNER_FROM_VALIDATE=1` expects endpoint form. Token-bundle forces bare `pmth_` bearer → webhook rejects with OIDC-only verifier (see A6).

**Owner:** qiang / NaaP ops (Vercel env + per-team flags).

---

### A2. pymthouse routing — **PASS**

| Probe | Result |
|---|---|
| `GET pymthouse.com/api/v1/apps/app_98575870…/signer/routing` (M2M) | **HTTP 200** |
| `signerApiUrl` / `patterns.directDmz.signerApiUrl` | `https://pymthouse-signer-test-production.up.railway.app` |
| `webhookUrl` | `https://pymthouse.com/webhooks/remote-signer` |
| `meteringMode` | `platform_ingest` |

John A/B flip to test-production signer **still active** (unchanged from Run 45/46).

---

### A3. SDK `app.py` — **PASS (env) / FAIL (validate contract drift)**

| Item | Status | Evidence |
|---|---|---|
| `sdk.daydream.monster/health` | **PASS** | HTTP 200 |
| `/capabilities` | **PASS** | 170 caps |
| `SIGNER_FROM_VALIDATE=1` | **PASS (Run 46 SSH)** | Not re-SSH’d Run 47; no evidence of drift |
| Validate session consumption | **FAIL** | Validate returns token-bundle; hosted `naap_` inference → **502 IncompleteRead** |

**Hosted inference probe (Run 47):**

```
POST sdk.daydream.monster/inference  capability=flux-schnell  Bearer naap_…
→ HTTP 502
→ payment failed: IncompleteRead(82 bytes read, 112 more expected)
→ orch: byoc-staging-1.daydream.monster:8935
```

Historical pattern (Runs 10–16): `IncompleteRead` = signer HTTP body truncated when payment generation errors mid-flight — **symptom**, not root cause. Root cause is upstream auth/payment failure at DMZ webhook.

---

### A4. Gateway `byoc.py` (deployed `1bf13cd`) — **PASS**

| Item | Status | Evidence |
|---|---|---|
| Image on `sdk-staging-1` | **DEPLOYED** | `byoc-dual-path-1bf13cd-2026-07-16` (Run 35/46) |
| `_payment_type_for_signer()` dual-path | **IN IMAGE** | Commit `1bf13cd` is 1 commit ahead of `1114138`; adds lv2v/byoc gating |
| `get_orch_info(..., capabilities=byoc_caps)` | **YES — IN DEPLOYED IMAGE** | Present in both `1114138` and `1bf13cd` (`byoc.py` Step 1 comment + `capabilities=` kwarg) |
| Gateway PR #41 merge | **OPEN** | Not merged upstream; **does not block** — pinned image already contains the fix |

**Ticket mismatch risk after #255:** **LOW** for current canary. Per-cap `TicketParams` alignment requires `-byocPerCapPricing` ON **and** capabilities on orch discovery — gateway side is done; signer flag status unconfirmed (A5).

---

### A5. Remote signer test-production — **PARTIAL PASS / AUTH FAIL**

| Probe | test-production | old prod DMZ |
|---|---|---|
| `/healthz` | **200** | **200** |
| `/sign-orchestrator-info` + bare `pmth_` from validate | **200** | **200** |
| `type:byoc` type gate | **PASS** | **FAIL** — `invalid job type` |
| `submit_byoc_job` (gateway `1bf13cd`, bare `pmth_`) | **FAIL 401** `not a JWT` | **FAIL 400** `invalid job type` |
| `-byocPerCapPricing` | **UNKNOWN** (not externally observable) | OFF (assumed) |

**Failure point:** `/generate-live-payment` reaches pymthouse identity webhook → **401 `not a JWT`**.

Direct webhook probe with bare `pmth_`: **401 `unauthorized webhook caller`**.

---

### A6. pymthouse webhook — **FAIL (#255 NOT MERGED)**

| Item | Status | Evidence |
|---|---|---|
| [pymthouse#255](https://github.com/pymthouse/pymthouse/pull/255) | **OPEN** | `mergedAt: null` |
| Merge readiness | **BLOCKED** | `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY` |
| Prod `main` webhook config | **OIDC JWT only** | `remote-signer-webhook-config.ts` on `main` — no composite/opaque verifiers |
| PR branch adds | composite `app_XXX.pmth_YYY` + opaque `pmth_*` verifiers | Files: `composite-app-api-key-verifier.ts`, `opaque-session-verifier.ts`, `first-match-verifier.ts` |
| First commit (opaque `pmth_`) on main? | **NO** | `compare/main...96b5647` → opaque verifier **not** on main |

**This is the hard stop for billed payment generation.**

---

### A7. `sign-byoc-job` / V1 job creds (#3980) — **NOT REACHED**

| Item | Status |
|---|---|
| go-livepeer [#3980](https://github.com/livepeer/go-livepeer/pull/3980) | **MERGED** 2026-07-11 |
| Live probe past payment gen | **NO** — blocked at A6 before job creds matter |

**Latent:** Will surface immediately after webhook auth passes if orch image lacks #3980 or sender reserve unfunded.

---

### A8. Orch `byoc-staging-1` — **REACHABLE / NOT THE HOT BLOCKER**

| Probe | Result |
|---|---|
| Target in SDK health | `byoc-staging-1.daydream.monster:8935` |
| Payment rejection reason | Signer-side (`IncompleteRead` / 401 class), not orch capacity 503 |
| V1 verify (#3980) | **Assumed deployed** (merged); not independently probed Run 47 |

---

### A9. OpenMeter ingest — **PASS (read) / 0 delta (gen blocked)**

| Probe | Result |
|---|---|
| `GET …/apps/app_98575870…/usage?groupBy=pipeline_model` | **HTTP 200** |
| App totals | `requestCount=286`, `networkFeeUsdMicros=599638` |
| Run 47 probe delta | **0** — no successful billed gen |

Historical per-cap ratio flux-dev / flux-schnell ≈ **4.3×** (expected **8.3×** with full per-cap pricing).

---

### A10. Storyboard MCP naap path — **UNTESTED**

| Path | Result |
|---|---|
| Daydream `list_capabilities` | **PASS** — 170 caps |
| Daydream `create_media` flux-schnell | **PASS** — 2983 ms, $0.00320 |
| `naap_` bearer through MCP NaaP provider switch | **NOT TESTED** — prod MCP env unknown |

---

## Section B — Latent blockers (surface after #255 deploys)

| # | Blocker | Why it will appear next | Owner |
|---|---|---|---|
| B1 | **Validate endpoint regression** — restore composite `{url, headers}` | Even with opaque verifier, composite bearer is the **designed** prod path (`PYMTHOUSE_API_KEY` fast-path). Token-bundle mint-per-validate is fragile | qiang / NaaP Vercel |
| B2 | **Sender reserve / wallet funding** on test-production signer for `app_98575870` | Prior runs hit `no sender reserve` / IncompleteRead when wallet unfunded | John / pymthouse ops |
| B3 | **`-byocPerCapPricing` confirmation** on test-production | Fees may stay at legacy ~4.3× ratio vs 8.3× tariff | John |
| B4 | **`sign-byoc-job` V1 verify** on orch + signer image pin | #3980 merged but image pin on test-production not verified this run | John / infra |
| ~~B5~~ | ~~**`recipientRand` / ticket param alignment**~~ **✅ RESOLVED (Run 51)** — was the 1% orch advertised-vs-bound price mismatch; fixed in [go-livepeer#3993](https://github.com/livepeer/go-livepeer/pull/3993), deployed to `byoc-staging-1`; flux-schnell/flux-dev now 200 + image | ~~j0sh / John~~ → done (qiang, our infra) |
| B6 | **SDK `_validate_session_cache` stale routing** | Run 45b — manual restart needed after signer routing flips; no TTL | qiang / infra |
| B7 | **Old prod DMZ cutover** for non-A/B apps | `pymthouse-production` still rejects `type:byoc` | John |
| B8 | **Gateway #41 upstream merge** | Image pinned; drift risk on next redeploy without merge | j0sh |
| B9 | **Storyboard MCP prod env** (`STORYBOARD_PROVIDER_SWITCH`, `NAAP_*`) | NaaP key path through MCP never verified | Storyboard ops |
| B10 | **`pymthouse_bpp_validate` + capabilities[]** | Empty caps today; matters for capability gate / discovery demos, not raw BYOC SDK path | qiang |

---

## Section C — Fixed / closed (do not re-chase)

| Item | Evidence | Closed since |
|---|---|---|
| go-livepeer #3980 (`type:byoc` + V1 verify) | Merged 2026-07-11 | Run 29+ |
| Dual-path SDK image `1bf13cd` on `sdk-staging-1` | Deployed; Daydream MCP PASS | Run 35/42 |
| `SIGNER_FROM_VALIDATE=1` on VM | SSH verified Run 46 | Run 45b |
| John A/B routing → test-production signer | Validate + routing API agree | Run 45 |
| Hosted SDK signer URL drift (cache) | Restart fixed `invalid job type` → `not a JWT` | Run 45b |
| `get_orch_info` passes capabilities | In deployed `1bf13cd` source | Run 35 (this audit confirms) |
| Daydream regression | Storyboard MCP `create_media` PASS Run 47 | Run 42+ |
| OpenMeter label path + M2M read API | 286 reqs readable | Run 30+ |
| NaaP composite bearer code (#421) | Merged | 2026-07-09 |
| `type:byoc` on test-production (vs old prod) | test-prod: 401 not JWT; old prod: invalid job type | Run 45 |

---

## Section D — Minimum deploy set for John (one shot)

Everything needed before expecting **first successful billed `naap_` gen + OpenMeter delta**:

| # | Deploy / config | Repo / surface | Blocks |
|---|---|---|---|
| 1 | **Resolve merge conflicts + merge + Vercel prod deploy** [pymthouse#255](https://github.com/pymthouse/pymthouse/pull/255) | pymthouse | Webhook 401 `not a JWT` |
| 2 | **Restore NaaP validate endpoint form:** set `PYMTHOUSE_API_KEY=app_98575870….pmth_…` on NaaP prod Vercel; confirm `per_key_remote_signer` ON for `livepeer-dev` | NaaP Vercel | Composite bearer emission; SDK validate contract |
| 3 | **Confirm test-production signer image** includes go-livepeer #3980+ and `-byocPerCapPricing` ON | Railway test-production | Per-cap fees + type:byoc |
| 4 | **Fund sender reserve** for `app_98575870` wallet on test-production signer | pymthouse / on-chain | post-auth payment gen |
| 5 | **Smoke:** `submit_byoc_job` OR `sdk.daydream.monster/inference` with `naap_` → 200 + image | — | Proof |
| 6 | **OpenMeter delta:** new `byoc/flux-schnell` row with `networkFeeUsdMicros > 0` | — | Billing proof |

**Optional same window (not blocking first gen):**

- Merge gateway [#41](https://github.com/livepeer/livepeer-python-gateway/pull/41) upstream (image already pinned).
- Storyboard MCP `STORYBOARD_PROVIDER_SWITCH=1` + `NAAP_*` env.
- SDK validate-cache TTL / deploy hook to bust cache on routing flips.

---

## Section E — Honest answer: is #255 alone sufficient?

**No.**

#255 is **necessary** but **not sufficient**. Minimum chain:

```
#255 merge+deploy  →  webhook accepts bearer
       +
NaaP PYMTHOUSE_API_KEY composite  →  validate emits {url, headers} app.pmth_ bearer
       +
Funded sender reserve on test-production  →  payment gen completes (not IncompleteRead)
       +
Orch + signer on #3980 image  →  sign-byoc-job V1 verify (latent until payment passes)
```

**If John merges #255 only:**

- Bare `pmth_` from current validate **might** work IF opaque verifier from PR commit 1 is included — but validate **should** emit composite for metering attribution.
- Payment gen may still **fail** with IncompleteRead / reserve errors until wallet funded.
- Per-cap fee ratio proof (8.3×) still blocked until `-byocPerCapPricing` confirmed.

**Expected first success signature:**

1. Validate → `signerSession.url = pymthouse-signer-test-production…` + composite bearer  
2. `submit_byoc_job` or SDK inference → **200** + image URL  
3. OpenMeter → new `byoc/flux-schnell` increment  

---

## Dependency diagram

```mermaid
flowchart TD
  subgraph naap["1. NaaP validate"]
    V1["POST /keys/validate 200"]
    V2["per_key_remote_signer ON"]
    V3["PYMTHOUSE_API_KEY composite"]
    V4["signerSession endpoint form"]
    V1 --> V2 --> V3 --> V4
  end

  subgraph route["2. pymthouse routing"]
    R1["signer/routing → test-production"]
  end

  subgraph sdk["3. SDK node"]
    S1["SIGNER_FROM_VALIDATE=1"]
    S2["gateway 1bf13cd dual-path"]
    S3["get_orch_info + capabilities"]
  end

  subgraph signer["4. test-production signer"]
    G1["type:byoc accepted"]
    G2["-byocPerCapPricing ON"]
    G3["wallet + sender reserve funded"]
    G4["go-livepeer #3980 image"]
  end

  subgraph webhook["5. pymthouse webhook"]
    W1["#255 composite verifier"]
    W2["#255 opaque pmth verifier"]
    W3["Vercel prod deploy"]
    W1 --> W3
    W2 --> W3
  end

  subgraph orch["6. byoc-staging-1"]
    O1["V1 job creds verify #3980"]
    O2["capacity"]
  end

  subgraph meter["7. OpenMeter"]
    M1["Kafka collector"]
    M2["byoc/model_id labels"]
    M3["networkFeeUsdMicros > 0"]
  end

  V4 --> S1
  R1 --> S1
  S1 --> S2 --> S3
  S3 --> G1
  V4 --> W1
  W3 --> G1
  G1 --> G2 --> G3 --> G4
  G4 --> O1 --> O2
  O2 --> M1 --> M2 --> M3

  style W1 fill:#f99,stroke:#900
  style W3 fill:#f99,stroke:#900
  style V3 fill:#f99,stroke:#900
  style V4 fill:#f99,stroke:#900
  style G3 fill:#fc9,stroke:#960
```

Red = **active blockers today**. Orange = **latent immediately after #255**.

---

## Run 47 probe evidence (redacted)

```text
# gh pymthouse#255
state: OPEN | mergedAt: null | mergeable: CONFLICTING | mergeStateStatus: DIRTY

# validate (Run 47)
POST operator.livepeer.org/api/v1/keys/validate + Bearer naap_8056755b… → HTTP 200
  signerSession: { accessToken: pmth_…, tokenType: Bearer }   # NO url/headers
  capabilities: []

# routing
GET pymthouse.com/.../signer/routing → test-production URL

# gateway submit_byoc_job (1bf13cd venv, bare pmth from validate)
test-production → FAIL HTTP 401 not a JWT
old prod DMZ     → FAIL HTTP 400 invalid job type

# SDK hosted
POST sdk.daydream.monster/inference flux-schnell → HTTP 502 IncompleteRead(82,112)

# Storyboard MCP (Daydream)
list_capabilities → 170 caps PASS
create_media flux-schnell → PASS 2983ms $0.00320

# OpenMeter
requestCount=286 networkFeeUsdMicros=599638 — 0 delta from probes
```

---

## Post-#424 update (2026-07-17 — John merge + live re-probe)

**Context:** John merged [NaaP #424](https://github.com/livepeer/naap/pull/424) today (~16:35Z). He reported prod NaaP is healthy, pymthouse moved to `@pymthouse/builder-sdk@0.6.0` + clearinghouse identity webhook, and platform apps should use simple `Authorization: Bearer <key>` without parsing composite keys or doing signer exchange locally.

### What #424 changed (exact diff)

| Area | Before (#421 era) | After (#424 on `main`) |
|---|---|---|
| `@pymthouse/builder-sdk` | `0.5.0` | **`0.6.0`** |
| Composite key shape | `app_<clientId>.pmth_<secret>` (dot) | **`app_<24hex>_<secret>`** (underscore) — `isCompositeApiKey()` |
| Bare `pmth_*` exchange | `POST …/auth/api-key/signer-session` | **`POST …/apps/{clientId}/oidc/token`** (RFC 8693 form body) |
| Composite fast-path | `apiKey.includes('.pmth_')` | **`isCompositeApiKey(apiKey)`** from builder-sdk |
| Identity webhook | In-SDK `@pymthouse/builder-sdk/signer/webhook` | **Removed** — use `@pymthouse/clearinghouse-identity-webhook` upstream |
| Developer-api UI | Generic success copy | Clarifies composite vs bare `pmth_*` usage |

Files touched: `pymthouse-adapter.ts`, `pymthouse-client.ts`, `pymthouse-signer-exchange-config.ts`, tests, `docs/pymthouse-integration.md`, developer-api packages.

### builder-sdk 0.6.0 — validate contract NOW

Per [builder-sdk CHANGELOG 0.6.0](https://github.com/pymthouse/builder-sdk/blob/v0.6.0/CHANGELOG.md):

- Presented composite credentials are **`app_<24hex>_<secret>`** (underscore, not dot).
- Clearinghouse identity webhook accepts them as Bearer — **NaaP/Storyboard should not parse or re-exchange them**.
- Bare `pmth_*` still exchanges via RFC 8693 token endpoint for a short-lived signer JWT + `signer_url`.

**What validate should return on prod** (when `per_key_remote_signer` ON and endpoint resolution succeeds):

```json
{
  "signerSession": {
    "url": "https://pymthouse-signer-test-production.up.railway.app",
    "headers": { "Authorization": "Bearer app_<24hex>_<secret>" }
  }
}
```

Fallback (flag OFF or `resolveSignerEndpoint` throws): token-bundle `{ accessToken: "pmth_…", tokenType, expiresIn, scope }` — SDK `SIGNER_FROM_VALIDATE=1` cannot use this for DMZ signing.

### Live probe after #424 merge (Run 48, ~11:38 PT)

| Probe | Result | Notes |
|---|---|---|
| `POST operator.livepeer.org/api/v1/keys/validate` + canonical `naap_…` | **HTTP 200** | `valid:true`, `billingAccount.providerSlug:pymthouse` |
| `signerSession` shape | **STILL token-bundle** | `{ accessToken: pmth_…, tokenType, expiresIn, scope }` — **no** `{ url, headers }` |
| `capabilities[]` | **EMPTY** | `[]` |
| `POST sdk.daydream.monster/inference` flux-schnell | **HTTP 502** | `IncompleteRead(82,112)` — same symptom as Run 47 |
| [pymthouse#255](https://github.com/pymthouse/pymthouse/pull/255) | **OPEN** | Now **`mergeable: MERGEABLE`** (was CONFLICTING Run 47) — still not merged |

**Interpretation:** #424 is on `main` but prod validate **has not yet recovered** the endpoint form. Most likely: (1) Vercel prod not redeployed with #424 yet, and/or (2) `PYMTHOUSE_API_KEY` still unset or still in **old dot format** (`app_XXX.pmth_YYY`) which **`isCompositeApiKey()` no longer recognizes**, and/or (3) `per_key_remote_signer` OFF → endpoint swap never attempted. John's "working great" likely refers to the merge + clearinghouse alignment, not first billed gen.

### Run 48 addendum (~11:50 PT — follow-ups after John #424)

| Action / probe | Result | Notes |
|---|---|---|
| **[NaaP #427](https://github.com/livepeer/naap/pull/427)** | **CLOSED** | Comment: superseded by merged #424 (builder-sdk 0.6.0, clearinghouse). Not merged. |
| **Prod deploy #424** | **YES** | GitHub Production deployment `db9a600` at **2026-07-17T16:35:43Z** (same merge commit as #424). |
| **M2M Basic** (`m2m_5ad45661…` + supplied secret) | **PASS** | `GET …/apps/app_98575870…` → 200; `GET …/signer/routing` → **test-production** DMZ. |
| **Mint underscore composite** | **PASS** | `POST …/users/a80a7b4e…/keys` (Builder API, M2M Basic) → **201**; key shape **`app_<24hex>_<secret>`** (NOT dot, NOT bare `pmth_` only). |
| **`POST sdk.daydream.monster/inference`** + composite Bearer | **HTTP 502** | `IncompleteRead(82,112)` — same payment-gen truncation as Run 47/48 earlier. |
| **`POST …/inference`** + `naap_…` | **HTTP 502** | Alternates `IncompleteRead` / `401 Invalid access token` on test-production webhook (opaque path). |
| **`POST operator.livepeer.org/api/v1/keys/validate`** | **HTTP 200** | `valid:true` but **`signerSession` still token-bundle** (`accessToken: pmth_…`) — **no** `{ url, headers }` despite #424 deploy. |
| **[pymthouse#255](https://github.com/pymthouse/pymthouse/pull/255)** | **OPEN** | `mergeable: MERGEABLE`, `mergedAt: null` — still not merged/deployed. |

**Revised interpretation:** #424 **is live on prod** (deploy confirmed), but validate endpoint form is still absent → **`PYMTHOUSE_API_KEY` unset or wrong format** and/or **`per_key_remote_signer` OFF**, not a missing redeploy. John's direct-Bearer path (underscore composite minted via Builder API) reaches the orchestrator but **payment generation still truncates** on test-production — ops blocker (sender reserve / signer deploy) remains on John even after auth fixes.

### Run 48b (~12:00 PT — validate endpoint unblock follow-up)

| Action / probe | Result | Notes |
|---|---|---|
| **Neon prod DB — `per_key_remote_signer` for livepeer-dev** | **ALREADY ON** | `b0600547-9a7c-434b-aa8b-8d1534c3d5b8`: override `enabled=true` (global OFF). Sibling flags also ON: `key_validation_front_door`, `native_keys`. `pymthouse_bpp_validate` global OFF, no override. **No DB mutation.** |
| **Mint underscore composite (Builder API M2M)** | **PASS** | `POST …/apps/app_98575870…/users/2f617839-3588-4700-a6db-8438068c2b7f/keys` → **201**; shape **`app_98575870d7ae33589a3f0660_<secret>`** (underscore). Saved locally for ops handoff only — **not committed**. |
| **Mint fresh `naap_` key (Neon insert)** | **PASS** | lookupId `8763606985f90e40`, team `livepeer-dev`, ACTIVE. Raw key in `/tmp/rawkey` only. |
| **`vercel env add PYMTHOUSE_API_KEY` (prod)** | **BLOCKED** | `vercel whoami` → Not authorized; no `VERCEL_TOKEN` / `~/.vercel/auth.json`; `vercel env add` fails (cannot retrieve project settings). **Manual steps for qiang below.** |
| **`POST operator.livepeer.org/api/v1/keys/validate`** + fresh `naap_…` | **HTTP 200** | `valid:true`, `billingAccount.providerSlug:pymthouse`, but **`signerSession` still token-bundle** (`accessToken: pmth_…`) — **no** `{ url, headers }`. Flag is ON in DB → **`resolveSignerEndpoint` likely throwing** on prod (fail-safe fallback), not flag OFF. |
| **`POST sdk.daydream.monster/inference`** + composite Bearer | **HTTP 502** | `IncompleteRead(82,112)` on `byoc-staging-1.daydream.monster:8935` — unchanged vs Run 48. |
| **`POST sdk.daydream.monster/inference`** + `naap_…` | **HTTP 502** | Same `IncompleteRead(82,112)` (~4.5 s). |

**Run 48b interpretation:** `per_key_remote_signer` is **not** the missing piece (already ON). Validate endpoint regression persists → prod `resolveSignerEndpoint` fail-safe (check prod `PYMTHOUSE_*` M2M/routing env + Vercel logs for `keys.validate.signer_endpoint_unavailable`). Setting **`PYMTHOUSE_API_KEY`** to the new underscore composite + **redeploy** remains the recommended unblock for qiang (may also enable composite-bearer fast-paths). Payment-gen truncation on test-production remains **John / pymthouse ops** (sender reserve / #255).

---

## Vercel env checklist (Run 48b — `resolveSignerEndpoint` / validate endpoint form)

**Prod deploy under test:** `db9a6006` ([#424](https://github.com/livepeer/naap/pull/424), builder-sdk **0.6.0**).  
**DB flag:** `per_key_remote_signer` **ON** for `livepeer-dev` (Neon override `b0600547-…`, confirmed Run 48b).  
**Live validate (Run 48b re-probe):** `valid:true`, `signerSession` still **token-bundle** (`accessToken: pmth_…`) → **`resolveSignerEndpoint` threw**; front door fail-safe kept opaque bundle (`keys/validate/route.ts:212-230`).

### Fail-safe mechanism (why token-bundle persists)

When `per_key_remote_signer` is ON and the adapter implements `resolveSignerEndpoint`, validate **attempts** endpoint swap, then:

```text
try { signerSession = await adapter.resolveSignerEndpoint(mintedBundle, { externalUserId }) }
catch { log keys.validate.signer_endpoint_unavailable; keep token-bundle }
```

Any thrown error → **no 500**, **no `{ url, headers }`**. SDK `SIGNER_FROM_VALIDATE=1` cannot consume token-bundle.

### `resolveSignerEndpoint` on main@#424 (exact logic)

Source: `apps/web-next/src/lib/billing/pymthouse-adapter.ts` @ `db9a6006`.

| Step | Condition | Action | Throws when |
|---|---|---|---|
| A | `readApiKeySignerSessionConfig()` non-null (`PYMTHOUSE_API_KEY` + issuer + public client set) **and** `isCompositeApiKey(apiKey)` | `getSignerRouting()` → DMZ url; Bearer = **underscore composite as-is** | routing empty/proxy DMZ; M2M/routing HTTP error |
| B | Same config, key **not** composite (legacy **dot** `app_XXX.pmth_YYY`, bare `pmth_…`, etc.) | `POST …/apps/{clientId}/oidc/token` (RFC 8693) via `exchangeApiKeyForSignerSession` | exchange 401/400; **`signerUrl` missing** in response; dashboard `/api/signer` proxy url |
| C | `PYMTHOUSE_API_KEY` **unset** (default) | `getSignerRouting()` + **`createPymthouseApiKey`** (`label: naap-validate-signer`) per validate | routing/DMZ issues; key mint 401/403; missing `externalUserId` |

`readApiKeySignerSessionConfig()` (`pymthouse-signer-exchange-config.ts`) returns **`null`** unless all three are set: `PYMTHOUSE_ISSUER_URL`, `PYMTHOUSE_PUBLIC_CLIENT_ID`, `PYMTHOUSE_API_KEY`.

**0.6.0 composite shape:** `app_<24hex>_<secret>` (underscore). Regex: `^(app_[a-f0-9]{24})_(.+)$`. Legacy dot `app_XXX.pmth_YYY` → **`isCompositeApiKey` = false** → branch **B** (exchange), **not** branch **A**.

### Local simulation (no prod logs, no secrets echoed)

```bash
node scripts/run-48b-resolve-signer-sim.mjs
```

Run 48b simulation output (main #424 logic):

| Scenario | Result |
|---|---|
| `PYMTHOUSE_API_KEY` **unset** + good routing | **PASS** → legacy `createPymthouseApiKey` path |
| `PYMTHOUSE_API_KEY` **underscore composite** | **PASS** → composite fast-path + test-production DMZ |
| `PYMTHOUSE_API_KEY` **legacy dot** `app_XXX.pmth_YYY` | **THROW** → exchange branch (expected prod failure mode if old env value remains) |
| bare `pmth_` key, exchange returns no `signerUrl` | **THROW** |
| routing returns empty DMZ | **THROW** |
| routing returns `/api/signer` proxy | **THROW** |

Live M2M probe in-script: **skipped** (no `PYMTHOUSE_*` in agent shell). Run 48 addendum M2M routing probe **PASS** externally (same app `app_98575870…` → test-production DMZ).

### Most likely prod failure (Run 48b diagnosis)

**Primary hypothesis:** Vercel prod still has **`PYMTHOUSE_API_KEY` set to pre-#424 dot-format** (`app_98575870….pmth_…`, Run 15–46 era). After #424, that value is **not** `isCompositeApiKey()` → branch **B** RFC8693 exchange **throws** (invalid/revoked subject token or missing `signerUrl`) → fail-safe → token-bundle. Opaque `pmth_` mint in the same request still succeeds (independent code path).

**Secondary hypotheses** (if `PYMTHOUSE_API_KEY` is unset or already underscore):

- `getSignerRouting()` M2M failure or empty/proxy DMZ (less likely — external M2M routing PASS Run 48).
- Legacy **`createPymthouseApiKey`** failure (M2M missing `users:write` / key-create scope, or wrong `PYMTHOUSE_PUBLIC_CLIENT_ID` vs bound app).

**Not the cause:** `per_key_remote_signer` OFF (DB confirms ON).

### Vercel Production — required env vars (validate endpoint / pymthouse)

Set in **`apps/web-next`** project (naap-platform / operator.livepeer.org). Values for `app_98575870…` canary unless prod has drifted.

#### Required (M2M + validate mint + endpoint resolution)

| Variable | Purpose | Validate impact if missing/wrong |
|---|---|---|
| **`PYMTHOUSE_ISSUER_URL`** | OIDC issuer, e.g. `https://pymthouse.com/api/v1/oidc` | `readApiKeySignerSessionConfig` null; client not configured; mint/routing fail |
| **`PYMTHOUSE_PUBLIC_CLIENT_ID`** | Public `app_<24hex>` (Builder URL paths) | Wrong app; routing/key mint against wrong tenant |
| **`PYMTHOUSE_M2M_CLIENT_ID`** | Confidential `m2m_…` client | Builder API 401; **both** opaque mint and `getSignerRouting` fail |
| **`PYMTHOUSE_M2M_CLIENT_SECRET`** | M2M secret (**sensitive** — set in Vercel only) | Same as above |
| **`PYMTHOUSE_API_KEY`** | **Optional for code default**, **required for stable prod fast-path**: underscore composite `app_<24hex>_<secret>` from Builder API user-key mint | **Unset** → legacy per-validate `createPymthouseApiKey` (works if M2M scopes OK). **Dot-format** → branch B throw → **token-bundle fail-safe**. **Underscore composite** → branch A → `{ url, headers }` |

#### Strongly recommended (same deploy window)

| Variable | Purpose |
|---|---|
| **`DATABASE_URL`** | Feature flags (`per_key_remote_signer`), key resolution |
| **`NEXTAUTH_URL`** / **`NEXTAUTH_SECRET`** | Platform auth (validate front door) |

#### Optional pymthouse (not blocking validate endpoint swap)

| Variable | Purpose |
|---|---|
| `PYMTHOUSE_SIGNER_URL` | Developer API / `POST /api/pymthouse/keys/exchange` facade URL — **not** read by `resolveSignerEndpoint` on #424 |
| `PMTHOUSE_BASE_URL` / `PYMTHOUSE_MARKETPLACE_URL` | Marketplace links |
| `PYMTHOUSE_DEVICE_COOKIE_SECRET` | Device-flow cookie (falls back to `NEXTAUTH_SECRET`) |
| `PYMTHOUSE_ALLOW_INSECURE_HTTP` | Local dev only |
| `PYMTHOUSE_ALLOW_MISSING_MANIFEST_FAIL_OPEN` | Manifest sync fail-open (default deny) |
| `PYMTHOUSE_CAPABILITY_CACHE_TTL_MS` | BPP capabilities cache |

#### Not env — Neon feature flags (livepeer-dev)

| Flag | Required value | Run 48b |
|---|---|---|
| `key_validation_front_door` | ON | ON (override) |
| `per_key_remote_signer` | ON | **ON** (override) |
| `native_keys` | ON | ON |
| `pymthouse_bpp_validate` | ON for live caps | global OFF (empty `capabilities[]`, non-blocking) |

### Ops fix (qiang — Vercel prod)

1. **Inspect** Production env: is `PYMTHOUSE_API_KEY` present? If yes, is it **dot** or **underscore** format?
2. **Mint** fresh underscore composite via Builder API (`POST …/users/{externalUserId}/keys`) — Run 48b PASS shape: `app_98575870d7ae33589a3f0660_<secret>`.
3. **Set or replace** on Production:
   - `PYMTHOUSE_ISSUER_URL=https://pymthouse.com/api/v1/oidc`
   - `PYMTHOUSE_PUBLIC_CLIENT_ID=app_98575870d7ae33589a3f0660`
   - `PYMTHOUSE_M2M_CLIENT_ID=m2m_5ad45661715c8bb7eb30d18f` (confirm not rotated)
   - `PYMTHOUSE_M2M_CLIENT_SECRET=<current secret>`
   - `PYMTHOUSE_API_KEY=<underscore composite from step 2>` (**sensitive**)
4. **Redeploy** prod (`npx vercel deploy --prod` or push-trigger).
5. **Re-probe:** `POST …/keys/validate` → expect `signerSession` keys `["url","headers"]`, `headers.Authorization` = `Bearer app_98575870d7ae33589a3f0660_…`.

```bash
cd apps/web-next
printf '%s' 'app_98575870d7ae33589a3f0660_<secret>' | \
  npx vercel env add PYMTHOUSE_API_KEY production --sensitive --yes --force
npx vercel deploy --prod
curl -sS -X POST https://operator.livepeer.org/api/v1/keys/validate \
  -H "Authorization: Bearer naap_<lookup>_<secret>" | jq '.data.signerSession | keys'
```

**Alternative (no stable global key):** remove `PYMTHOUSE_API_KEY` from Production → legacy branch C (`createPymthouseApiKey` per validate). Works if M2M has user/key scopes; less ideal (new key every validate).

**Manual Vercel steps (qiang — agent unauthorized):**

```bash
cd apps/web-next
npx vercel login                    # livepeer-foundation org
npx vercel link                     # project web-next if .vercel stale
# Paste the underscore composite from Builder API (Run 48b mint or fresh mint):
printf '%s' 'app_98575870d7ae33589a3f0660_<secret>' | \
  npx vercel env add PYMTHOUSE_API_KEY production --sensitive --yes --force
npx vercel deploy --prod            # pick up env change
# Re-probe:
curl -sS -X POST https://operator.livepeer.org/api/v1/keys/validate \
  -H "Authorization: Bearer naap_<lookup>_<secret>" | jq '.data.signerSession | keys'
# Expect: ["url","headers"] not ["accessToken","tokenType","expiresIn","scope"]
```

### Compare to our open work

| Item | Status after #424 | Action |
|---|---|---|
| **[NaaP #427](https://github.com/livepeer/naap/pull/427)** opaque-session forward | **CLOSED** (superseded) | Closed 2026-07-17 with comment pointing to merged #424. |
| **[pymthouse#255](https://github.com/pymthouse/pymthouse/pull/255)** composite webhook | **Still needed** (likely updated format) | Clearinghouse refactor may absorb verifier logic, but webhook still returned **401 `not a JWT`** on bare `pmth_` in Run 47. #255 is mergeable again — coordinate with John on underscore composite vs legacy `app.pmth_` verifier. |
| **Validate regression** (token-bundle vs endpoint) | **NOT fixed by #424 alone** | Needs prod deploy + `PYMTHOUSE_API_KEY` in **new underscore format** + `per_key_remote_signer` ON. Old dot-format composite keys silently miss the fast-path. |
| **[NaaP #421](https://github.com/livepeer/naap/pull/421)** composite bearer | **Superseded by #424** | #421 used dot format + old exchange; #424 is the clearinghouse-aligned successor. |

### Storyboard SB-4 — what can be removed?

Grep of `livepeer/storyboard` `main` (Jul 17):

| File | Bearer / signer behavior |
|---|---|
| `lib/mcp-server/auth.ts` | Extracts `Authorization: Bearer <key>` — **no composite parsing, no exchange** |
| `lib/mcp-server/sdk-call.ts` | Forwards caller `apiKey` to SDK base — **no validate signerSession consumption** |
| `lib/sdk/provider-core.ts` | Routes `naap_` → `POST /api/v1/keys/validate` for Settings preflight only; reads `valid` flag, **ignores signerSession** |
| `lib/sdk/client.ts` | Same — mentions `signerSession` in comments only |

**Verdict:** Storyboard MCP already does the right thing for "simple Bearer auth." **No SB-4 code removal required** for composite parsing or signer exchange — that complexity lives in NaaP `resolveSignerEndpoint` + SDK `SIGNER_FROM_VALIDATE=1`, not Storyboard. Remaining Storyboard work is **ops**: `STORYBOARD_PROVIDER_SWITCH=1`, `NAAP_PROVIDER=naap`, `NAAP_BASE_URL=https://sdk.daydream.monster` once validate emits endpoint form.

### Revised action plan (post-#424)

1. **John / pymthouse:** Merge + deploy [pymthouse#255](https://github.com/pymthouse/pymthouse/pull/255) (or confirm clearinghouse identity webhook on prod accepts underscore composite + opaque `pmth_`). Fund test-production sender reserve.
2. **NaaP Vercel prod:** Redeploy from `main` (#424). Set `PYMTHOUSE_API_KEY` to a **new-format** composite `app_<24hex>_<secret>` (from Developer API / John). Confirm `per_key_remote_signer` ON for livepeer-dev.
3. **Verify:** validate → endpoint form with composite bearer → `sdk.daydream.monster/inference` 200 → OpenMeter delta.
4. ~~**Close NaaP #427**~~ — **done** (Run 48 addendum).
5. **Storyboard prod env** (after step 3 passes): enable `STORYBOARD_PROVIDER_SWITCH` + `NAAP_*`; re-run `sb4-server-naap.test.ts`.

**Minimum chain unchanged in spirit:** webhook auth (#255/clearinghouse) + validate endpoint form (env + flag + #424 deploy) + funded signer → first billed gen.

### Run 49 (~14:30 PT — PYMTHOUSE_API_KEY env fix attempt + E2E)

| Action / probe | Result | Notes |
|---|---|---|
| **Underscore composite ready** | **PASS** | Run 48b key in `/tmp/composite_key` (not committed) |
| **Vercel env PATCH `PYMTHOUSE_API_KEY`** | **BLOCKED** | HTTP **403** on env GET/PATCH for `prj_PiZLLh1Ot3Qf6OBYr4f7Ebi77sP6`; `vercel whoami` unauthorized; no usable `VERCEL_TOKEN` in repo env files |
| **Prod redeploy** | **NOT DONE** | Latest prod still `dpl_7KmqSuSy3FzzXzg9W4FvZKV7AepV` (#424 / `db9a6006`) |
| **`POST …/keys/validate`** + `naap_…` | **HTTP 200** | `valid:true`; **`signerSession` still token-bundle** (`pmth_…`) — endpoint form **not restored** |
| **`POST sdk.daydream.monster/inference`** + `naap_` | **HTTP 502** | `IncompleteRead(82,112)` — unchanged vs Run 48b |
| **`POST sdk.daydream.monster/inference`** + composite direct | **HTTP 502** | Same `IncompleteRead(82,112)` |
| **Storyboard MCP `create_media` flux-schnell** | **PASS** | 2959 ms; $0.00320 — Daydream path healthy |
| **OpenMeter delta** | **0** | `requestCount=305`, `networkFeeUsdMicros=680373` |
| **pymthouse#255** | **CLOSED unmerged** | Closed 2026-07-17; live error is **IncompleteRead**, not **401 not a JWT** — **#255 relevance inconclusive** until validate emits composite endpoint bearer |

**Run 49 interpretation:** Step 1 (Vercel env + redeploy) **did not execute** — same SAML/403 blocker as Run 48b. Step 2 confirms prod is **unchanged**: validate fail-safe token-bundle persists; naap + direct-composite SDK paths both hit **payment-gen truncation** on test-production DMZ. **#255 cannot be ruled out or confirmed** without first setting underscore `PYMTHOUSE_API_KEY` and observing whether webhook returns 401 vs payment proceeds.

---

## Run 50 (2026-07-17 — REAL composite session bundle, DIRECT signer-path test)

**Breakthrough:** User supplied a live signer-session bundle for `app_98575870…` (base64 API key). This let us test the **signer path directly**, bypassing the NaaP validate / Vercel env blocker that stalled Runs 47–49.

### Bundle (decoded — secret masked, env-only, never committed)

| Field | Value |
|---|---|
| `signer` | `https://pymthouse-signer-test-production.up.railway.app` |
| `signer_headers.Authorization` | `Bearer app_98575870d7ae33589a3f0660_pmth_…a78357` (**underscore composite**, 0.6.0 shape) |
| `discovery` | `https://discovery-service-production-8955.up.railway.app/v1/discovery/raw` |

### Direct probes (gateway venv `submit_byoc_job`, composite bearer, NO validate)

| Probe | Result | Meaning |
|---|---|---|
| signer `/healthz` | **200 OK** | reachable |
| `POST /sign-orchestrator-info` + **composite bearer** | **200** → `address 0x6CAE3C7a…` + signature | **webhook auth PASSED** (was 401 `not a JWT` on bare `pmth_`) |
| `get_orch_info` gRPC `byoc-staging-1:8935` (signed, `capabilities=byoc`) | `ticket_params` present, recipient `0x180859c3…`, **price 1060500/1** | per-cap ticket params returned |
| `POST /generate-live-payment` + composite bearer (`type:byoc`) | **200** → `payment` (281B **valid `net.Payment` proto**) + `segCreds` + `state` | **payment generation COMPLETES — no IncompleteRead, no 401** |
| ↳ decoded payment | sender `0x6CAE3C7a…`, ticket recipient **matches orch** `0x180859c3…`, 1 signed `ticket_sender_params`, `expiration_params` set | payment is well-formed & recipient-correct |
| `submit_byoc_job` **flux-schnell** (orch `byoc-staging-1`) | **FAIL HTTP 400 `Could not parse payment`** | orch rejects payment at ticket validation |
| `submit_byoc_job` **flux-dev** | **FAIL HTTP 400 `Could not parse payment`** | same |
| `POST sdk.daydream.monster/inference` + composite bearer (flux-schnell) | **HTTP 502 `IncompleteRead(82,112)`** | hosted node NOT using composite for payment-gen (own signer config) |
| `sdk.daydream.monster/health` | **200**, orch `byoc-staging-1` | node up |

### Root cause of "Could not parse payment" (go-livepeer `byoc/job_orchestrator.go`)

`setupOrchJob → confirmPayment → processPayment` returns `errPaymentError` ("Could not parse payment") from **either**:

1. `getPayment(hdr)` — base64 decode + `net.Payment` unmarshal, **or**
2. `bso.orch.ProcessPayment(...)` — on-chain **ticket validation** (recipient, ticket params, sender reserve, signature).

Our payment **decodes cleanly** (valid `net.Payment`, recipient == orch) → **(1) passes**. Therefore the failure is **(2) ProcessPayment / ticket validation**: most likely **sender reserve/deposit unfunded on-chain** for signer wallet `0x6CAE3C7aa09Adf84C0eD1C3A53465364cEcb7260` on test-production, or ticket-param/`recipientRand`/signature mismatch between signer and orch. This is latent blocker **B2 / B5** — surfaced now that auth + payment-gen finally pass.

### OpenMeter (M2M `app_98575870`, before → after)

| Metric | Before | After | Delta |
|---|---|---|---|
| totals `requestCount` | 305 | 309 | **+4** |
| totals `networkFeeUsdMicros` | 680373 | 680377 | **+4** |
| `byoc/flux-schnell` | 34 / 645 | 37 / 648 | +3 / +3 |
| `byoc/flux-dev` | (1 / 0) | 5 / 327 | +4 / +327 |

**Interpretation:** OpenMeter incremented **from the `/generate-live-payment` probes themselves** — metering fires at **signer payment-gen (`platform_ingest`)**, decoupled from orch success. Increments are floor-rate (~1 µUSD/req), **not** full per-cap tariff, and **no image was produced**. Billing is being recorded for payments the orch later rejects — worth flagging.

### Vercel (optional)

**BLOCKED** — no `VERCEL_TOKEN`, no `~/.vercel/auth.json`, `vercel whoami` unauthorized (same SAML/403 as Runs 48b/49). Skipped per task priority (direct test first).

### Run 50 SIMPLE answers

- **Is the composite bundle sufficient / working?** **PARTIAL — YES for auth + payment generation, NO for a returned image.** The composite bearer clears every pymthouse/signer gate (webhook auth + full payment gen). It does **not** yet yield an image because the **orchestrator** rejects the payment on-chain.
- **Image generated?** **NO.** No URL — orch returns `HTTP 400 Could not parse payment` for flux-schnell and flux-dev.
- **#255 still needed?** **NO** (for this composite path). The composite bearer **passed the remote-signer webhook auth**: `/sign-orchestrator-info` → 200 **and** `/generate-live-payment` → real payment. The `401 not a JWT` failure #255 targeted is **gone** on test-production for the underscore composite.
- **Remaining blocker + owner:** **Orchestrator-side payment/ticket validation** — `byoc-staging-1` `ProcessPayment` rejects a valid, recipient-correct ticket → **fund sender reserve/deposit on-chain for `0x6CAE3C7aa09Adf84C0eD1C3A53465364cEcb7260` on test-production, and confirm orch on go-livepeer #3980 image + ticket-param alignment. Owner: John / pymthouse + orch infra.** Secondary: hosted `sdk.daydream.monster` node still `IncompleteRead` (not using composite bearer for payment-gen) → NaaP validate must emit composite endpoint form / node signer config — owner qiang / NaaP Vercel.
- **Spend:** ~**$0.000004** (4 µUSD network fee metered from payment-gen probes). No image, no Daydream spend. Effectively **$0**.

### Reproduce

```bash
# env-only (never commit): BYOC_SIGNER_URL, COMPOSITE_BEARER from decoded bundle
GWPY=../livepeer-python-gateway/.venv/bin/python
GATEWAY_SRC=../livepeer-python-gateway/src \
  BYOC_CAPABILITY=flux-schnell "$GWPY" scripts/run50-direct-signer-probe.py
```

---

## Run 50b (2026-07-17 — EXACT root cause of "Could not parse payment": price-overhead mismatch)

**Breakthrough:** Reproduced the orch rejection end-to-end and **decoded the live payment**. Using the M2M confidential client (`m2m_5ad45661…` + env secret), minted a short-lived signer JWT via `POST /api/v1/oidc/token` (`grant_type=client_credentials` + `external_user_id`), then called `get_orch_info` (caps-aware) + `/generate-live-payment` against `byoc-staging-1` and **decoded the 281B `net.Payment` proto**. Also read the signer wallet's on-chain deposit/reserve on Arbitrum One.

Repro: `scripts/run50b-decode-payment.py` (secret env-only: `PMTH_M2M_SECRET`).

### THE ROOT CAUSE (one sentence)

`byoc-staging-1` advertises the BYOC per-cap price in **two places that disagree by exactly the 1% txCost overhead**: `OrchestratorInfo.PriceInfo` (via `PriceInfoForCaps`, **with** overhead) is what the orch used to build `TicketParams.RecipientRandHash`, but `OrchestratorInfo.CapabilitiesPrices[]` (via `GetCapabilitiesPrices`, **without** overhead) is what the remote signer copies into the payment's `ExpectedPrice`; the orch then recomputes `recipientRand` from the (lower) `ExpectedPrice`, the Keccak hash no longer equals the echoed `RecipientRandHash`, ticket validation fails with **`invalid recipientRand for ticket recipientRandHash`**, and BYOC surfaces that as the misleading catch-all **HTTP 400 "Could not parse payment"**.

### Live decode evidence (Run 50b)

| Field | flux-schnell | flux-dev |
|---|---|---|
| orch `PriceInfo` → drives `RecipientRandHash` (**with** 1% overhead) | **1060500/1** | **8837500/1** |
| payment `ExpectedPrice` (from `CapabilitiesPrices`, **no** overhead) | **1050000/1** | **8750000/1** |
| overhead check | `1050000 × 1.01 = 1060500` ✅ | `8750000 × 1.01 = 8837500` ✅ |
| `RecipientRandHash` echoed byte-identical | **YES** | **YES** |
| ticket recipient == orch `0x180859c3…` | **YES** | **YES** |
| sender | `0x6CAE3C7a…` (funded) | same |
| orch verdict | **400 Could not parse payment** | **400 Could not parse payment** |

Both caps fail the **same** way; the flux-dev/flux-schnell base ratio (8750000/1050000 = **8.33×**) proves per-cap pricing itself is correct — only the overhead-vs-no-overhead split breaks validation.

### Which layer emits the error (go-livepeer)

`byoc/job_orchestrator.go` `processPayment` returns `errPaymentError` ("Could not parse payment") from **two** places sharing one string:

```490:501:byoc/job_orchestrator.go
payment, err := getPayment(paymentHdr)     // (1) base64 + proto.Unmarshal — logs "job payment invalid"
...
if err := bso.orch.ProcessPayment(...); err // (2) ticket validation — logs "Error processing payment"
```

Our payment **decodes cleanly** (valid `net.Payment`, recipient correct) → path **(1) passes**. The failure is path **(2)** `core/orchestrator.go ProcessPayment` → `pm/recipient.go ReceiveTicket` → `pm/validator.go ValidateTicket`:

```56:58:pm/validator.go
if crypto.Keccak256Hash(...recipientRand...) != ticket.RecipientRandHash {
    return errInvalidTicketRecipientRand
}
```

`recipientRand` is an HMAC over `{seed, sender, faceValue, winProb, expirationBlock, price.Num(), price.Denom(), expirationParams}` (`pm/recipient.go rand()`), and `price` = `payment.ExpectedPrice`. Every input except **price** is echoed identically → the price delta alone flips the hash.

**"Could not parse payment" vs "insufficient sender reserve":** different layers. Parse-string = BYOC catch-all for *any* `ProcessPayment` failure (real log: `Error processing payment: invalid recipientRand…`). Reserve errors would come from `ValidateSender`/redeem. We are in the **recipientRand** branch, not reserve.

### On-chain check — sender wallet `0x6CAE3C7aa09Adf84C0eD1C3A53465364cEcb7260` (Arbitrum One)

`TicketBroker.getSenderInfo` (`0xa8bB618B…`, selector `0xe1a589da`):

| Field | Value |
|---|---|
| `sender.deposit` | **0.12335 ETH** (123351785666032360 wei) |
| `sender.withdrawRound` | **0** (not unlocking) |
| `reserve.fundsRemaining` | **0.28999 ETH** (289991570000000000 wei) |
| `reserve.claimedInCurrentRound` | 0 |
| wallet ETH balance | 0.00587 ETH |

**Sender reserve/deposit is FUNDED.** Prior latent blocker **B2 (fund sender reserve) is DISPROVEN.** Reserve is not the cause.

### #255 — truly not needed (confirmed)

The composite/JWT path **fully passes remote-signer auth**: minted a `sign:job` JWT via M2M; `/sign-orchestrator-info` → 200 (address + sig) and `/generate-live-payment` → 200 (real 281B payment). The `401 not a JWT` that #255 targeted is **gone** on test-production. **#255 is NOT the blocker** for this path. The remaining failure is 100% orchestrator/signer price-alignment.

### ONE clear action for John

**Make the orchestrator's two BYOC price advertisements identical.** Pick one:

1. **(Recommended, orch-side)** In `core/orchestrator.go GetCapabilitiesPrices`, apply the **same** `overhead = 1 + 1/txCostMultiplier` to the BYOC external-capability prices that `priceInfo()`/`PriceInfoForCaps` already applies (lines 444–459). Then `CapabilitiesPrices[flux-schnell]` = 1060500/1 (not 1050000/1) and the signer's `ExpectedPrice` matches `RecipientRandHash`. **This is the minimal fix and unblocks first billed gen.**
2. **(Alt, signer-side)** In `server/remote_signer.go GenerateLivePayment`, do **not** override `ExpectedPrice` from `resolveByocPrice(CapabilitiesPrices)`; keep `ExpectedPrice = oInfo.PriceInfo` (the caps-aware price the orch used for `TicketParams`). Requires the gateway to pass `capabilities` into `get_orch_info` (it already does — `byoc.py:202`).
3. **(Alt, orch validation)** In `ProcessPayment`, use the orch's own stored per-session price for `PricePerPixel` in `r.rand()` instead of `payment.ExpectedPrice` (weaker price enforcement).

After the fix, redeploy byoc-staging-1 (and/or the signer image), then re-run `scripts/run50b-decode-payment.py` — expect `prices MATCH` and `submit_byoc_job` → 200 + image.

### Billing flag — metered on REJECTED payments (pymthouse collector)

OpenMeter incremented **+4 requestCount** purely from the `/generate-live-payment` probes in Run 50, with **no image produced** (orch rejected every ticket). `meteringMode: platform_ingest` fires the usage event at **signer payment-generation time**, decoupled from orchestrator acceptance. Result: **the app is billed (floor-rate ~1 µUSD/req) for payments the orchestrator throws away.** This is a **pymthouse collector correctness bug** — metering should be gated on orch success (job creds verified / segment accepted), not on payment mint. Owner: John / pymthouse metering. (Impact today is tiny — floor rate — but it will mis-bill at full tariff once payments start succeeding if not fixed.)

### Run 50b answers (SIMPLE)

- **Exact root cause of "Could not parse payment"?** **Ticket-param price mismatch → `invalid recipientRand for ticket recipientRandHash`.** The orch built `RecipientRandHash` with the overhead-adjusted price (`PriceInfo` 1060500/1) but the signer put the un-adjusted `CapabilitiesPrices` value (1050000/1) into `ExpectedPrice`. **Not** proto/parse, **not** reserve (wallet funded on-chain), **not** version/#3980, **not** auth/#255.
- **One action for John:** apply the 1% txCost `overhead` to BYOC prices in `GetCapabilitiesPrices` (or stop the signer overriding `ExpectedPrice`) so `ExpectedPrice == TicketParams price`, then redeploy byoc-staging-1.
- **#255 needed?** **NO** — composite/JWT auth passes `/sign-orchestrator-info` + `/generate-live-payment` (both 200).
- **Spend:** ~$0.000004 (floor-rate metering from payment-gen probes). No image.

### Reproduce

```bash
# env-only secret (never commit): PMTH_M2M_SECRET
GWPY=../livepeer-python-gateway/.venv/bin/python
GATEWAY_SRC=../livepeer-python-gateway/src \
  PMTH_M2M_SECRET='pmth_cs_…' \
  BYOC_CAPABILITY=flux-schnell "$GWPY" scripts/run50b-decode-payment.py
# On-chain reserve:
curl -s https://arb1.arbitrum.io/rpc -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0xa8bB618B1520E284046F3dFc448851A1Ff26e41B","data":"0xe1a589da0000000000000000000000006cae3c7aa09adf84c0ed1c3a53465364cecb7260"},"latest"]}'
```

---

# Run 52 validate 503 audit — `keys/validate` "Billing provider unavailable" (2026-07-18)

**Symptom:** `POST https://operator.livepeer.org/api/v1/keys/validate` + `Bearer naap_8056755b…` →
**HTTP 503** `{"code":"SERVICE_UNAVAILABLE","message":"Billing provider unavailable"}`.
Regressed from Run 49 (200 token-bundle).

## Root cause — CONFIRMED: NaaP prod Vercel env credential drift (NOT pymthouse outage, NOT SDK regression)

Prod's `PYMTHOUSE_M2M_CLIENT_SECRET` (for M2M client `m2m_5ad4…` / app `app_98575870…`) on Vercel is
**stale/revoked**. The validate mint (`upsertAppUser` → `mintUserAccessToken`, M2M Basic auth) fails auth
→ `PymthouseAdapter.mintSignerSession()` throws → `native-key.ts` catches it → `reason: mint_failed` →
route maps to 503 "Billing provider unavailable".

### Evidence chain

| # | Probe | Result | Meaning |
|---|---|---|---|
| 1 | `POST operator.livepeer.org/api/v1/keys/validate` + `naap_8056755b…` | **503** `SERVICE_UNAVAILABLE` / "Billing provider unavailable" (~1–3.5s) | reproduced |
| 2 | Prod runtime log (`dpl_HUw4…`, branch `main`) for the request | `{"event":"keys.validate.provider_unavailable","reason":"mint_failed"}` | adapter **is configured** (env present); `mintSignerSession()` **threw** |
| 3 | pymthouse OIDC discovery `GET pymthouse.com/api/v1/oidc/.well-known/openid-configuration` | **200** | pymthouse API is **healthy** (no outage / no migration break) |
| 4 | `upsertAppUser` `POST …/apps/app_98575870…/users` (Basic `m2m_5ad4…:pmth_cs_7a45…`) | **201** | current M2M secret is **valid**; endpoint healthy |
| 5 | `mintUserAccessToken` `POST …/apps/app_98575870…/users/{ext}/token` scope=`sign:job` | **200** (JWT) | user-token mint **works** with valid secret |
| 6 | opaque token-exchange `POST …/oidc/token` grant=token-exchange, no `resource` | **200** `pmth_…` | **full NaaP mint flow succeeds end-to-end** with `pmth_cs_7a45…` |

**Interpretation:** the exact 3-step mint the validate front door performs succeeds when driven with the
**current** secret `pmth_cs_7a45…`. Prod validate still returns `mint_failed` → prod's env secret ≠ the
valid `pmth_cs_7a45…` (it holds the previously-rotated/revoked value; cf. Run 11 where `pmth_cs_dfc0…`
returned **401 Unauthorized** on `upsertAppUser`/`mintUserAccessToken`). Classic "John rotated the M2M
secret; prod Vercel env not updated / not redeployed" drift.

### Ruled OUT

- **pymthouse outage / clearinghouse migration** — OIDC + apps + token endpoints all 200 (probes 3–6).
- **M2M creds globally invalid** — `pmth_cs_7a45…` authenticates and mints fully (probes 4–6).
- **builder-sdk 0.6.0 (#424) regression** — prod (`main` @ `9721b059`) DOES include #424 (0.6.0), but
  #424 only refactored the fail-safe `resolveSignerEndpoint` / API-key exchange path (gated behind
  `per_key_remote_signer`, wrapped in try/catch → never 503s). `upsertAppUser` / `mintUserAccessToken` /
  `getAppsBaseUrl` / `builderHeaders` are **byte-identical** between SDK 0.4.x and 0.6.0 — the core
  `mintSignerSession` path is unchanged. Not the cause.
- **NaaP code bug** — the 503 mapping (`provider_unavailable`/`mint_failed` → 503) is correct fail-safe
  behavior; the front-door flag/binding gates all pass (503, not 404/403), so key/flag/binding are fine.

### Prod deploy / timeline

- Live prod: `dpl_HUw4dvVKev15YowTwGJnQRm8aRu7` (READY, target=production) = `main` @ `9721b059`
  ("feat(discovery): add Live Runner (lr) category (#428)"), deployed **2026-07-18 06:06Z**, includes
  #424 (builder-sdk **0.6.0**).
- Run 49's 200 token-bundle was earlier, before the current prod env drift; nothing in the #424 code
  path explains the regression — the delta is the **env secret**, not the deploy code.

## Owner + fix action

- **Owner: qiang (NaaP prod Vercel env `naap-platform` / `prj_PiZLLh1Ot3Qf6OBYr4f7Ebi77sP6`).** Not John
  (pymthouse healthy), not a code fix.
- **Fix:** on Vercel prod, set `PYMTHOUSE_M2M_CLIENT_SECRET` = the current valid secret for `m2m_5ad4…`
  (`pmth_cs_7a45…`, held env-only, proven in probes 4–6). Verify the sibling vars are consistent:
  `PYMTHOUSE_PUBLIC_CLIENT_ID=app_98575870d7ae33589a3f0660`, `PYMTHOUSE_M2M_CLIENT_ID=m2m_5ad4…`,
  `PYMTHOUSE_ISSUER_URL=https://pymthouse.com/api/v1/oidc`. Then **redeploy/promote `main`** (env changes
  need a fresh deploy) and re-run validate → expect **200** `valid:true` + token-bundle `signerSession`.
- **Follow-up (observability, NaaP code):** `resolveNativeKeyToProviderSession` swallows the provider
  error in a bare `catch {}` (`native-key.ts` ~L149) → prod logs only show `mint_failed` with no
  underlying reason, which is why every one of these drifts requires a manual out-of-band probe to
  diagnose. Recommend logging the caught error's status/code (never the secret) before returning
  `mint_failed`.

## Billed composite direct-signer path — UNAFFECTED

The billed path (composite `app_98575870…_pmth_…` bearer forwarded directly to the remote signer DMZ)
uses a **different** credential (`PYMTHOUSE_API_KEY`, the funded composite key), not the M2M secret the
opaque validate-mint uses. Run 52 billed composite generation passed (metering labels + cost correctness
✅). The validate 503 does **not** block the composite direct path.

---

# Run 53 — expanded multi-capability billed E2E + validate-503 status (2026-07-18)

**Two tasks:** (1) fix NaaP validate 503, (2) expanded multi-cap billed E2E via the composite
direct-signer path (unaffected by the 503).

## TASK 1 — validate 503: STILL BLOCKED (Vercel write access unavailable to agent)

**503 fixed? NO.** Root cause reconfirmed (Run 52): prod `PYMTHOUSE_M2M_CLIENT_SECRET` on Vercel is
stale. The **current** secret `pmth_cs_7a45…` is proven valid this run:

| Probe | Result |
|---|---|
| `POST pymthouse.com/api/v1/oidc/token` grant=client_credentials + `external_user_id` (current secret) | **HTTP 200** — `access_token`, `signer_url`, scope `sign:job` (secret VALID) |
| `POST operator.livepeer.org/api/v1/keys/validate` + `naap_8056755b…` | **HTTP 503** `Billing provider unavailable` |
| Prod runtime log (Vercel MCP, `dpl_HUw4…`, `main`) | `keys.validate.provider_unavailable` `reason:"mint_failed"` (3 hits incl. our 23:12Z repro) |

**Why the agent cannot apply the fix:** no `VERCEL_TOKEN` in env / `~/.vercel` / repo `.env*`;
`vercel whoami` → **Not authorized**; team `Livepeer Foundation` (`team_GOhUouAF8PsQO4CVvzpIriQV`) is
**SAML-gated** (interactive login required); the Vercel MCP is authenticated but **read-only** (no
env-management tool — only logs/deploys/toolbar/purchase). `deploy_to_vercel` only creates new projects
from a file tree, not env writes on `naap-platform`.

### Manual fix for qiang (project `naap-platform` / `prj_PiZLLh1Ot3Qf6OBYr4f7Ebi77sP6`)

```bash
cd apps/web-next   # (or repo root — root .vercel links naap-platform: prj_PiZLLh1Ot3Qf6OBYr4f7Ebi77sP6)
vercel login       # SAML → Livepeer Foundation (team_GOhUouAF8PsQO4CVvzpIriQV)
# Set the CURRENT valid secret (value from creds, never echo):
printf '%s' 'pmth_cs_7a45…' | vercel env add PYMTHOUSE_M2M_CLIENT_SECRET production --sensitive --force
# Verify siblings already correct (leave as-is if so):
#   PYMTHOUSE_M2M_CLIENT_ID   = m2m_5ad45661715c8bb7eb30d18f
#   PYMTHOUSE_PUBLIC_CLIENT_ID= app_98575870d7ae33589a3f0660
#   PYMTHOUSE_ISSUER_URL      = https://pymthouse.com/api/v1/oidc
#   (optional) PYMTHOUSE_API_KEY = app_98575870d7ae33589a3f0660_pmth_…  (composite, enables endpoint form)
vercel deploy --prod                         # env change needs a fresh deploy/promote of main
curl -sS -X POST https://operator.livepeer.org/api/v1/keys/validate \
  -H "Authorization: Bearer naap_8056755b…" -w '\n%{http_code}\n'   # expect 200 valid:true
```

## TASK 2 — Run 53 multi-capability billed E2E — **PASS**

Billed composite session bundle (signer `pymthouse-signer-test-production`, underscore composite bearer)
driven straight into the gateway (`scripts/run53-multicap-probe.py` for price/unit/label + decode;
`scripts/run50-direct-signer-probe.py` for real generation). Orch `byoc-staging-1.daydream.monster:8935`,
recipient `0x180859c3…`, sender `0x6CAE3C7a…`. Randomized selection of 7 caps across 4 unit kinds.

### SIMPLE table

| cap | type | gen? | price correct? | unit | metering unit correct? | label correct? |
|---|---|---|---|---|---|---|
| flux-schnell | image t2i | ✅ 200 + jpg | ✅ `1060500/1` = 1050000×1.01 | per-megapixel | ❌ floor ~1 µUSD/req (MP not metered) | ✅ `byoc/flux-schnell` |
| flux-dev | image t2i | ✅ 200 + jpg | ✅ `8837500/1` = 8750000×1.01 (8.33× schnell) | per-megapixel | ❌ | ✅ `byoc/flux-dev` |
| nano-banana | image t2i | ✅ 200 + png | ✅ `14140000/1` = 14000000×1.01 | per-image | ❌ | ✅ `byoc/nano-banana` |
| recraft-v4 | image t2i | ✅ 200 + webp | ✅ `14140000/1` = 14000000×1.01 | per-image | ❌ | ✅ `byoc/recraft-v4` |
| ltx-t2v | video t2v | ✅ 200 + mp4 (1920×1080, **6.12s**, 153f) | ✅ `14140000/1` = 14000000×1.01 | per-second | ❌ (6.12s ignored; floor/req) | ✅ `byoc/ltx-t2v` |
| seedance-mini-t2v | video t2v | payment-gen only (200) | ✅ `13256250/1` = 13125000×1.01 | per-second | ❌ | ✅ `byoc/seedance-mini-t2v` |
| gemini-tts | audio TTS | payment-gen only (200) | ✅ `5302500/1` = 5250000×1.01 | per-1000-chars | ❌ | ✅ `byoc/gemini-tts` |

- **503 fixed: NO** (Vercel write blocked — manual steps above).
- **Spend:** OpenMeter fee Δ **+12 µUSD** (`680403 → 680415`), requests Δ **+9** (`331 → 340`). ≈ **$0.000012**.
  Real images + a real 6.12 s video were produced; on-chain session reserved `ExpectedPrice × units` per job.
- **Failed caps:** **none.** All 7 passed auth + payment-gen + price/label. 5 produced real output
  (4 images + 1 video); 2 (seedance-mini-t2v, gemini-tts) were payment-gen + decode only (bound spend /
  avoid cap-specific input payloads).

### Price correctness — ✅ ALL 7 (Run 51 `#3993` overhead fix confirmed live)

For every cap: orch `PriceInfo` (requested cap, overhead-adjusted) **==** signer payment `ExpectedPrice`
**==** advertised base (`/capabilities` `price_per_unit ÷ price_scaling`) **× 1.01** txCost overhead.
`recipientRandHash` echoed byte-identical; ticket recipient == orch. The Run 50b `CapabilitiesPrices`
vs `PriceInfo` split is gone — orch now applies overhead to both (e.g. flux-schnell `CapabilitiesPrices`
now `1060500/1`, was `1050000/1`).

On-chain reservation (session balance drop below the re-quoted grant level) = `ExpectedPrice × integer
units`, verified exact: flux-schnell `1060500 × {3,4}`, flux-dev `8837500 × {4,6}` — per-cap price
enforced on-chain.

### Metering UNITS — ❌ CORRECTNESS GAP (unchanged from Run 50b, now proven across unit kinds)

OpenMeter (`groupBy=pipeline_model`, M2M Basic) fires at **signer payment-gen (`platform_ingest`)**, so it
records **1 request at floor rate (~1–2 µUSD)** regardless of cap unit or quantity:

- Image megapixels, **video seconds** (ltx-t2v 6.12 s → advertised ≈ 0.042×6.12 ≈ **$0.257**, but metered
  **+2 µUSD**), and TTS characters are **not** reflected in `networkFeeUsdMicros`.
- The `groupBy=pipeline_model` view exposes only `requestCount` + `networkFeeUsdMicros` + fixed
  `retailRateUsd=0.000001` — **no raw unit quantity** (pixels/seconds/chars) is surfaced.
- Net: the **on-chain ticket** price is unit-aware and per-cap-correct; the **OpenMeter fee** is a flat
  per-request floor. Billing will under-report at full tariff once real per-cap fees flow. **Owner: John /
  pymthouse metering** (gate metering on orch acceptance + carry real unit quantity/fee).

### Labels — ✅ ALL 7

`groupBy=pipeline_model` shows `byoc/flux-schnell|flux-dev|nano-banana|recraft-v4|ltx-t2v|seedance-mini-t2v|gemini-tts`
— correct `byoc/<cap-name>`, none `unknown`, none mislabeled.

### OpenMeter before → final delta (per cap touched)

| pipeline/model | Δ reqs | Δ fee µUSD |
|---|---|---|
| byoc/flux-schnell | +3 | +3 |
| byoc/flux-dev | +3 | +3 |
| byoc/nano-banana | +1 | +2 |
| byoc/recraft-v4 | +1 | +2 |
| byoc/ltx-t2v | +1 | +2 |
| **totals** | **+9** | **+12** |

### Reproduce

```bash
# env-only (never commit): COMPOSITE_BEARER, BYOC_SIGNER_URL, PMTH_M2M_ID/SECRET, PMTH_APP
GWPY=../livepeer-python-gateway/.venv/bin/python
curl -sS https://sdk.daydream.monster/capabilities -o /tmp/caps.json          # advertised prices
GATEWAY_SRC=../livepeer-python-gateway/src CAPS_JSON=/tmp/caps.json "$GWPY" scripts/run53-multicap-probe.py
for CAP in flux-schnell flux-dev nano-banana recraft-v4 ltx-t2v; do
  GATEWAY_SRC=../livepeer-python-gateway/src BYOC_CAPABILITY=$CAP "$GWPY" scripts/run50-direct-signer-probe.py
done
curl -sS -u "$PMTH_M2M_ID:$PMTH_M2M_SECRET" \
  "https://pymthouse.com/api/v1/apps/$PMTH_APP/usage?groupBy=pipeline_model&include=retail"
```

---

---

# Run 54 — validate 503 ✅ RESOLVED (Vercel env) + new multi-unit billed E2E (2026-07-18)

## TASK 1 — validate 503: ✅ **FIXED**

The Run 52/53 root cause (stale prod `PYMTHOUSE_M2M_CLIENT_SECRET`) is **resolved**. A supplied Vercel API
token (scope `livepeer-foundation`) gave the agent write access to `naap-platform`
(`prj_PiZLLh1Ot3Qf6OBYr4f7Ebi77sP6`). Applied:

1. `vercel env add PYMTHOUSE_M2M_CLIENT_SECRET production --sensitive --force` = **current valid secret**
   (`pmth_cs_7a45…`) — **THE fix**.
2. `vercel env add PYMTHOUSE_API_KEY production --sensitive --force` = **underscore composite**
   (`app_98575870…_pmth_…`) — enables validate endpoint form.
3. Confirmed siblings already correct: `PYMTHOUSE_M2M_CLIENT_ID=m2m_5ad4…`,
   `PYMTHOUSE_PUBLIC_CLIENT_ID=app_98575870…`, `PYMTHOUSE_ISSUER_URL=https://pymthouse.com/api/v1/oidc`.
4. `vercel redeploy` latest prod (`dpl_HUw4…` → `naap-platform-cg41hqo2h`, aliased `operator.livepeer.org`).

**Verification:**

| Probe | Before (Run 52/53) | After (Run 54) |
|---|---|---|
| `POST …/keys/validate` + `naap_8056755b…` | **503** `Billing provider unavailable` | ✅ **200** `valid:true` |
| `signerSession` shape | — (503) | ✅ **endpoint form** `["url","headers"]`, url=test-production, Bearer=composite |
| `POST sdk.daydream.monster/inference` + `naap_` | 502 `IncompleteRead` | ✅ **200 + real image** (naap path works end-to-end) |

**503 fixed? YES — and the endpoint form is now the ideal `{url, headers}` composite (not token-bundle).**
The full `naap_` → validate → SDK → signer → gen path produces a real image. `capabilities[]` still empty
(`pymthouse_bpp_validate` OFF, non-blocking). Prior "agent cannot write Vercel env" blocker (Runs 48b–53)
is **cleared** with the supplied token.

## TASK 2 — Run 54 multi-unit billed E2E — **PASS** (6 caps, all NEW vs Run 53, 5 unit kinds)

| cap | type | gen? | price correct? | unit | metering unit correct? | label correct? |
|---|---|---|---|---|---|---|
| ideogram-v4 | image t2i | ✅ jpg | ✅ `14140000/1` | per-megapixel | ❌ floor | ✅ `byoc/ideogram-v4` |
| gpt-image | image t2i | ⚠️ paygen (real-gen timeout) | ✅ `742350/1` | per-image | ❌ | ✅ `byoc/gpt-image` |
| ltx-i2v | video **i2v** | ✅ mp4 (6.12 s) | ✅ `14140000/1` | per-second | ❌ | ✅ `byoc/ltx-i2v` |
| inworld-tts | audio TTS | paygen | ✅ `1767500/1` | per-1000-chars | ❌ | ✅ `byoc/inworld-tts` |
| gemini-text | text LLM | paygen | ✅ orch==Exp `13298333/500` (adv ε-round) | per-1000-tokens | ❌ | ✅ `byoc/gemini-text` |
| music | audio/music | paygen | ✅ `35350000/1` | per-call/track | ❌ | ✅ `byoc/music` |

- **Price:** orch `PriceInfo` == signer `ExpectedPrice` for all 6; `= advertised × 1.01` for 5/6 (gemini-text
  off only by per-token sub-unit rounding). On-chain reservation = `ExpectedPrice × integer units`
  (ideogram-v4 first gen = `14,140,000 × 6` exact).
- **Metering units:** ❌ still flat µUSD floor (`platform_ingest` at payment-gen); MP / seconds / chars /
  tokens / track quantities not reflected in `networkFeeUsdMicros`. Gap now proven across 5 unit kinds.
  **Owner: John / pymthouse metering.**
- **Labels:** ✅ all `byoc/<cap>`, none `unknown`. (Separate: `naap_` live-runner image labeled
  `live-video-to-video/unknown` — live-runner labeling gap.)
- **Spend:** +16 µUSD (`680416→680432`), +9 reqs (`341→350`) ≈ **$0.000016**. Real jpg + real i2v mp4.
  **Regressions: none.**

Detail: `USER-E2E-DEMO-RESULTS.md` Run 54.

---

## Related docs

- `BILLED-E2E-REMAINING-PLAN.md` — pillar plan (Run 35–46 era)
- `USER-E2E-DEMO-RESULTS.md` — Run 45/46 detailed probes
- `BPP-VALIDATE-V2-NAAP-DISCOVERY.md` — validate/discovery contract
- `SIGNER-ORCH-DEPLOY-PLAN.md` — signer-side deploy targets

---

# Run 55 (CORRECTED SCOPE) — billed one-shot BYOC path against the LR-orch `liverunner-staging-1` (2026-07-19)

**Goal:** repeat the Runs 50–54 billed BYOC payment path (composite bearer → test-production signer → caps-aware `get_orch_info` → `/generate-live-payment` → `/process/request` → gen) but target the **Live Runner orchestrator** instead of `byoc-staging-1`. (Distinct from the prior wrong-scope Run 55 which tested native `type=lv2v` streaming.)

## LR-orch = `https://liverunner-staging-1.daydream.monster:8935`

- **Not in discovery raw** (that endpoint lists only 29 public streamdiffusion orchs, no `lr` category, no `*-staging-1` hosts). LR-orch comes from the NaaP `lr` discovery category (PR #428, commit `59a68d43`), which is **not in the current branch `feat/opaque-session-signer-endpoint` ancestry**.
- **Reachable** via gRPC; recipient `0x180859c3…` (same wallet as byoc-staging-1), transcoder = itself, `ticket_params` present. DNS `136.66.21.17` (byoc-staging-1 = `8.229.77.130`).

## Result: billed path **FAILS** on LR-orch — root cause **zero pricing**

| probe | LR-orch | byoc-staging-1 |
|---|---|---|
| generic `PriceInfo` | **0/1** | 101/1 |
| `capabilities_prices` | **0 (empty)** | 136 |
| caps-aware `PriceInfo` (flux-schnell/dev/gpt-image/kontext) | **all 0/1** | 1060500 / 8837500 / 742350 / 14140000 |
| `/generate-live-payment` | **400 "missing or zero priceInfo"** | 200 valid `net.Payment` |
| `submit_byoc_job` | **400 "Could not verify job creds"** (unpaid; gateway skips payment on face_value=0) | **200 + real image** |

- **#3993 overhead fix on LR-orch?** **N/A / indeterminate.** LR-orch advertises no per-cap price at all, so there is no advertised-vs-bound overhead relationship to observe. The #3993 `invalid recipientRand` mismatch does **not** recur; a stricter zero-price blocker halts the path earlier.
- **Labels/metering (this run):** OpenMeter +1 req/+1 µUSD total = the **control** byoc-staging-1 flux-schnell gen (`byoc/flux-schnell`, label ✅). **LR-orch probes metered $0** (no payment minted; no new/`unknown` rows).
- **Regression check:** byoc-staging-1 still passes end-to-end (real jpg), so the composite/signer/#3993 stack is intact — the failure is LR-orch-specific.

## Blocker + owner

**P0 — `liverunner-staging-1` is not configured for one-shot BYOC billing.** Zero `PriceInfo`, empty `capabilities_prices`, rejects BYOC job creds for fal caps. **Owner: John / orch infra.** Either (a) deploy it with byoc-staging-1-parity BYOC per-cap pricing + `#3980`/`#3993` image + registered fal-cap workers, or (b) if it is only a native live-video-to-video orch, scope the #428 `lr` discovery category to native LV2V caps rather than dual-homing one-shot fal caps that it can't price/serve. **Spend: ≈ $0.000001** (control image only).

**Scripts:** `scripts/run55-lr-orchinfo-diag.py`, `scripts/run55-lr-generic-diag.py` (+ reused `run53-multicap-probe.py`, `run50-direct-signer-probe.py`).

---

# Run 55b — "Is LR-orch reconfig sufficient?" full-path dependency audit (2026-07-19)

**Question:** if we restart/reconfig `liverunner-staging-1` with pricing + caps + workers + the `#3993` image, will the billed one-shot BYOC payment path work end-to-end — or are OTHER changes needed elsewhere?

**Method:** read-only source trace of every hop against the committed configs of the repos that own each surface: `simple-infra` (LR-orch + BYOC deploy), `golivepeer/glp-combine@fix/byoc-e2e-v1-and-type-byoc` (orch/signer go-livepeer — the #3980+#3993+#3966/#3967 billed-fix branch), `livepeer-python-gateway` (SDK/gateway), NaaP (discovery `lr` category, signer wiring). No live probe this run (composite bearer is env-only; Run 55's live probes are the empirical anchor).

## SHORT ANSWER — **NO. Orch reconfig alone is NOT sufficient.**

`liverunner-staging-1` is **not a mis-priced BYOC orchestrator** — it is a **different orchestrator built on a different subsystem** (go-livepeer Live Runner protocol, `-useLiveRunners`) than the working billed path (`byoc-staging-1`, BYOC external-capability + on-chain PM). "Adding pricing + caps + workers + #3993" to the LR box is effectively **rebuilding it as a BYOC orchestrator** — it is not a config tweak. Below is the exact per-hop reason, split into **ON the LR-orch**, **ELSEWHERE**, and **already-OK**.

### THE ROOT ARCHITECTURAL FACT (why zero pricing is not a config typo)

`byoc-staging-1` (works) and `liverunner-staging-1` (fails) are deployed by **two different mechanisms** and register capabilities through **two different, non-overlapping code paths**:

| | `byoc-staging-1` (billed path works) | `liverunner-staging-1` (LR-orch) |
|---|---|---|
| Deploy | `simple-infra/scripts/deploy-byoc.sh` + `docker-compose/byoc-stack.yaml` | `simple-infra/live-runner/docker-compose.yml` (PR-1..PR-7, `#89–#100`) |
| Orch flags | `-network=arbitrum-one-mainnet -ethUrl -ethOrchAddr -pricePerUnit=100 -ticketEV`; keystore mounted | `-useLiveRunners -network=offchain -orchSecret`; **no** eth flags, **no** `-pricePerUnit`, **no** keystore |
| Workers | `inference-adapter` (byoc-adapter) registers each cap as a **BYOC external capability** with a **per-cap USD price** (`CAPABILITIES_JSON` + `PRICE_CURRENCY=USD`) → `node.ExternalCapabilities` + `GetPriceForJob` | `fal-app`/`ffmpeg-app`/`blender-app`/`hyperframes-app` register via **Live Runner protocol** (`register_runner`, `price=LR_PRICE` default **0**) → `LiveRunnerRegistry`, a **separate** store |
| Image | `…/go-livepeer:byoc-cap-price-overhead-20260717` (**#3980 + #3993**) | `livepeer/go-livepeer@sha256:3b3b8e55…` (tag `ja-live-runner`) — **no #3980, no #3993** |

**Code proof (glp-combine):** `core/orchestrator.go GetCapabilitiesPrices` builds `OrchestratorInfo.CapabilitiesPrices` **only** from (a) transcoding/AI `modelPrices` and (b) `orch.node.ExternalCapabilities.Capabilities` via `GetPriceForJob` (orchestrator.go:317-341). **Live Runner prices are never added here.** In `ai/runner/live_runner.go`, live-runner prices live in `liveRunner.PriceInfo` and are exposed **only** through the Live Runner `/discovery` endpoint (`LiveRunnerDiscoveryRunner.PriceInfo`) and `PaymentInfo(runnerID)` — the reserve→call→release live-video flow — **not** through `GetCapabilitiesPrices` / `OrchestratorInfo`. And offchain runners return **nil** price (`PaymentInfo`: `if runner.offchain { return nil }`; `discoveryRunner`: price omitted when `offchain`; `normalizeHeartbeat` even *skips* the positive-price requirement when offchain). Hence Run 55's `capabilities_prices = 0 (empty)` and `PriceInfo 0/1` is the **expected, structural** output of a live-runner/offchain orch — not a missing flag.

**Consequence:** even if you set `-pricePerUnit` and pass USD prices to `register_runner`, those prices land in `LiveRunnerRegistry`, **not** in `CapabilitiesPrices`, so the signer (which copies `CapabilitiesPrices → ExpectedPrice`) still sees nothing. To feed the one-shot BYOC billed path you must register the fal caps as **BYOC external capabilities** (the byoc-adapter path), i.e. run the **byoc-stack**, on an **on-chain** orch, on the **#3980/#3993** image.

## Per-hop answers to the 7 checks

### 1. Orch config itself — **config-only? NO. Needs the byoc-stack + specific image.**
- `-pricePerUnit`/`-pixelsPerUnit` nonzero base: **missing on LR-orch** (byoc-stack sets `-pricePerUnit=100`). Add.
- `capabilities_prices` populated per cap: **cannot come from live-runner registration** (§ root fact). Requires the **byoc-adapter** (`inference-adapter` container, `CAPABILITIES_JSON` + `PRICE_CURRENCY=USD`) registering BYOC external caps — i.e. `byoc-stack.yaml`, not `live-runner/docker-compose.yml`.
- `#3980` + `#3993` image: **required** (LR runs `ja-live-runner`, which has neither). Must swap `ORCH_IMAGE` to the byoc-cap-price-overhead image. **This is an image build/pin, not just config.**
- **Verdict:** to serve billed one-shot BYOC, `liverunner-staging-1` must run the **BYOC orchestrator stack** (on-chain go-livepeer + byoc-adapter + serverless-proxy) on the **#3980/#3993** image. The live-runner subsystem does not participate in this path.

### 2. Cap workers / byoc-adapter — **ELSEWHERE change required (deploy a byoc-adapter for LR-orch).**
- LR-orch has **no byoc-adapter**. Its fal caps are Live Runner apps. It needs its **own** `inference-adapter` (byoc-adapter) container pointed at the LR-orch's internal `:8936`, with the cap list + `PRICE_CURRENCY=USD`, to register priced BYOC external caps.
- Restart ordering (confirmed on byoc-staging-1, Run 51): after the orch (re)starts, the **adapter must (re)register** — the adapter re-registers on `REGISTER_INTERVAL` (byoc-stack.yaml `REGISTER_INTERVAL: "10"`), so a bounce settles within ~10s, but expect a re-register window after any orch restart.

### 3. Discovery routing — **depends on how the SDK targets the orch.**
- **Direct (`BYOC_ORCH_URL`)**: the gateway takes `orch_url` as **highest priority** (`byoc.py` submit path; `orch_info.get_orch_info(orch_url,…)`). Runs 50–55 (and the SDK node's `BYOC_ORCH_URL` in `deploy-byoc.sh`) target the orch **directly, bypassing discovery**. In this mode **discovery needs no change** — you just point `BYOC_ORCH_URL` at the (rebuilt) LR-orch.
- **Discovery-routed (`DISCOVERY_FROM_VALIDATE=1` / naap→SDK→discovery)**: the NaaP **`lr` discovery category (PR #428, commit `59a68d43`) is NOT in `feat/opaque-session-signer-endpoint`**. For real naap→discovery→LR-orch routing, discovery must (a) return the LR-orch **and** (b) advertise its caps **with the same per-cap prices** the orch advertises. That is a **NaaP discovery-service change**, separate from the orch.

### 4. Signer (test-production) — **already OK, no signer change.**
- The signer re-fetches `get_orch_info` (caps-aware) **per request** and copies `CapabilitiesPrices → ExpectedPrice` (confirmed Run 50b/51; "signer restart NOT needed"). **If the LR-orch advertises correct per-cap prices, the signer auto-picks them up.** No signer code/config/restart change.
- Recipient wallet: byoc-staging-1 uses `0x180859c3…`; the canary/LR reuse the same shared orch wallet (`scope-stg-orch-wallet`). Tickets are valid **only if the LR-orch is on-chain with that wallet's keystore mounted** (see #7). An **offchain** orch has `node.Recipient == nil` → `PriceInfo` returns nil and there is no valid ticket recipient at all.

### 5. Sender reserve — **already OK.**
- App-wallet reserve/deposit is **orch-independent** and **funded on-chain** (`0x6CAE3C7a…`: deposit 0.12335 ETH, reserve 0.28999 ETH — Run 50b). Valid against any recipient. **No change.**

### 6. `#3993` dependency — **CONFIRMED: image MUST include #3993 (and #3980).**
- If the LR-orch gets pricing but **not** `#3993`, the advertised-vs-bound 1% overhead split recurs → `invalid recipientRand` → the misleading `400 Could not parse payment` (Run 50b root cause). `#3980` is also required for the V1 `sign-byoc-job` creds verify (Run 55's `submit_byoc_job → 400 "Could not verify job creds"` is the unpaid/creds path). **The orch image must be the `byoc-cap-price-overhead` build (b1ea581 + #3993, which is on the #3980 lineage).**

### 7. Anything else — **on-chain registration is the big one.**
- **`-network` + eth wiring:** committed LR config is **`-network=offchain`** with **no** `-ethUrl`/`-ethOrchAddr`/keystore. On-chain PM (TicketParams, ProcessPayment, ticket redemption) is **impossible** offchain. Billed BYOC requires `-network=arbitrum-one-mainnet` + `-ethUrl` + keystore for the recipient wallet — the byoc-stack config.
  - ⚠️ **Discrepancy to verify on the VM:** Run 55 observed `ticket_params present` + `recipient 0x180859c3` on the live LR-orch, which is **inconsistent with the committed offchain config** (offchain ⇒ `Recipient==nil` ⇒ no ticket params). Either the deployed VM has **drifted on-chain** (someone added eth flags/keystore post-PR-1) or the observation conflated defaults. **Confirm the live `-network` before planning** — it changes the size of the change (offchain→on-chain conversion vs on-chain box that only lacks pricing+adapter+image).
- `-ticketEV`: byoc-stack sets `-ticketEV=800000000000`; LR-orch does not. Add.
- `txCostMultiplier`: the 1% overhead is derived from txCost; it is applied by the orch code once `#3993` is in the image (no separate flag needed beyond what byoc-staging-1 runs).
- `ServiceURI` on-chain registration / EthController round: an on-chain orch must be **registered/activated on-chain** with its `serviceURI`. byoc-staging-1's wallet `0x180859c3` is already a registered orch; **reusing that same wallet+ServiceURI for a second live host is a conflict** (one ServiceURI per orch address). If LR-orch reuses `0x180859c3`, its ServiceURI must point to `liverunner-staging-1` — which would **move** traffic off byoc-staging-1. Practically this means either (a) a **dedicated wallet** for LR-orch (new on-chain registration + reserve funding by the orch operator) or (b) accept that both share one identity and don't run them as two independent on-chain orchs. **Owner decision (John / orch infra).**

## DELIVERABLE

### Changes ON the LR-orch (`liverunner-staging-1`) — this is a re-deploy, not a reconfig
| # | Change | Detail | Owner |
|---|---|---|---|
| L1 | Run the **BYOC orchestrator stack**, not the live-runner stack | `byoc-stack.yaml` (on-chain orch + `inference-adapter` byoc-adapter + serverless-proxy). Live-runner registration does **not** feed `CapabilitiesPrices`. | John / orch infra |
| L2 | **On-chain** network | `-network=arbitrum-one-mainnet` + `-ethUrl` + keystore (currently `-network=offchain`) | John / orch infra |
| L3 | Base price + ticketEV | `-pricePerUnit` nonzero + `-ticketEV` (currently unset) | John / orch infra |
| L4 | **byoc-adapter** registering priced BYOC external caps | `inference-adapter` w/ `CAPABILITIES_JSON` + `PRICE_CURRENCY=USD`; re-registers ~10s after orch restart | John / orch infra |
| L5 | **#3980 + #3993 image** | swap `ORCH_IMAGE` to `…/go-livepeer:byoc-cap-price-overhead-20260717` (LR runs `ja-live-runner`, has neither) | John / orch infra |
| L6 | On-chain **ServiceURI/registration + wallet** | dedicated wallet + on-chain activation for LR host, OR resolve the ServiceURI conflict with byoc-staging-1's shared `0x180859c3` | John / orch infra |

### Changes ELSEWHERE (only for the discovery-routed path; the direct `BYOC_ORCH_URL` path needs none)
| # | Change | When needed | Owner |
|---|---|---|---|
| E1 | **NaaP `lr` discovery category (#428)** onto the working branch/prod | only if naap→SDK→**discovery**→LR-orch routing is the target (not in `feat/opaque-session-signer-endpoint`) | qiang / NaaP |
| E2 | **Discovery service** advertises LR-orch **with matching per-cap prices** | same — discovery must echo the orch's caps+prices or the gateway won't select/price it | qiang / NaaP + discovery ops |
| E3 | SDK node `BYOC_ORCH_URL` (or per-key `discovery.url`) pointed at the rebuilt LR-orch | for the direct path, this single env pin is the only "elsewhere" change | infra |

### Already OK — NO change
| Item | Why |
|---|---|
| **Signer (test-production)** | re-fetches orch info per request; copies `CapabilitiesPrices → ExpectedPrice`; auto-adopts correct prices. No code/config/restart. |
| **Sender reserve / app wallet** | funded on-chain (`0x6CAE3C7a…`), orch-independent, valid vs any recipient. |
| **Gateway / SDK image** | `byoc.py` dual-path already sends `capabilities` into `get_orch_info` and takes `orch_url` as top priority; nothing LR-specific to change. |
| **#3993 overhead fix logic** | already correct in the image — just needs to be the image the LR-orch runs (L5). |

### Bottom line
**"Reconfig LR-orch with pricing + caps + workers + #3993" is NOT sufficient and is not even a reconfig** — `liverunner-staging-1` is a Live-Runner/offchain orchestrator, a different subsystem from the BYOC/on-chain path. To bill one-shot BYOC on that host you must **redeploy it as a BYOC orchestrator** (L1–L6, all owned by John/orch infra). The **signer, sender reserve, and gateway need no change** (already-OK). The **only** "elsewhere" work is on the **discovery-routed** path (E1/E2, NaaP), and it is avoidable for a direct-target test by pinning `BYOC_ORCH_URL` (E3). Recommended, lower-risk alternative (unchanged from Run 55): if `liverunner-staging-1` is meant to be a **native live-video-to-video** orch, scope the `lr` discovery category to native LV2V caps and keep serving one-shot fal caps from the already-working `byoc-staging-1`, rather than dual-homing caps the LR box can't price/serve.

**Sources (read-only):** `simple-infra/live-runner/docker-compose.yml` + `README.md` + `fal-app/app.py` (offchain, `price=0`, live-runner registration); `simple-infra/docker-compose/byoc-stack.yaml` (on-chain + byoc-adapter + `PRICE_CURRENCY`); `golivepeer/glp-combine core/orchestrator.go GetCapabilitiesPrices` (BYOC-external-cap-only price source) + `ai/runner/live_runner.go` (live-runner prices are a separate store, nil offchain); `livepeer-python-gateway/src/livepeer_gateway/byoc.py` (`orch_url` top priority, per-request `get_orch_info` caps); Run 50b/51/55 live evidence above.

---

## VERIFICATION — "Fix B (durable): NaaP mints a user-scoped signer JWT" (2026-07-19)

**Task:** confirm whether the durable fix "NaaP mints a user-scoped signer-JWT (`mintUserSignerToken`) and forwards it — fully specced in `NAAP-SIGNER-JWT-EXCHANGE-PLAN.md`" is DONE. Verification only; no code changed.

### VERDICT: `MERGED-ENABLED-BUT-SUPERSEDED` (now orphaned/dead code)

Fix B was **coded, merged to `main`, reached prod behind an enabled flag** — then **replaced by two later approaches** and is now **dead code** (no non-test caller on `main` or on `feat/opaque-session-signer-endpoint`). Two premises in the claim are also **false**: the plan file does not exist, and the SDK primitive it names (`mintUserSignerToken`) was abandoned upstream.

### Evidence

**1. Plan file — DOES NOT EXIST.**
`NAAP-SIGNER-JWT-EXCHANGE-PLAN.md` is absent from the working tree AND from all git history/branches (`git log --all --name-only | rg -i 'SIGNER-JWT-EXCHANGE-PLAN'` → nothing). No `.md` in the repo matches `signer.?jwt`. The "fully specced in NAAP-SIGNER-JWT-EXCHANGE-PLAN.md" premise is unfounded.

**2. Function name mismatch.**
- `mintUserSignerToken` is a **builder-SDK** primitive, not a NaaP function. NaaP never defines it.
- The NaaP wrapper is **`mintUserSignerJwtForExternalUser()`** — `apps/web-next/src/lib/pymthouse-client.ts:285-315`. Real implementation (upsert user → `mintUserAccessToken` → return `{ jwt, expiresIn, scope }`), not a stub. Unit-tested in `pymthouse-client.test.ts:36-134`.
- #406 originally wrapped SDK `mintUserSignerToken` (clearinghouse mint: `client_credentials` + `scope=sign:mint_user_token` + `external_user_id`, `aud`=issuer). That path returned **`500 "Internal error during token mint"`** upstream, so #410 switched the wrapper to `mintUserAccessToken`. The clearinghouse `mintUserSignerToken` grant the claim describes is explicitly abandoned (see doc comment at `pymthouse-client.ts:277-281`).

**3. Merge history (all against `livepeer/naap`).**
- **#405** `feat/per-key-remote-signer` (P6, MERGED Jun 25) — added `PER_KEY_REMOTE_SIGNER_FLAG = 'per_key_remote_signer'` (`feature-flags.ts:84`, **default OFF** `:177-181`) and the validate front-door endpoint-swap plumbing (`keys/validate/route.ts:206-231`, try/catch fail-safe to token-bundle).
- **#406** `feat/per-key-signer-jwt-exchange` (P7, MERGED Jun 25, commit `02a87ae1`/`ff31f377`) — added `mintUserSignerJwtForExternalUser` + **wired `resolveSignerEndpoint()` to mint + forward the user JWT**, gated behind `per_key_remote_signer`. **This is Fix B.**
- **#410** `fix/per-key-signer-builder-user-token` (P7 fix, MERGED Jun 25) — switched the mint off the 500-ing clearinghouse grant to the Builder user-token JWT.
- **#412** `feat/pymthouse-api-key-signer-session` (MERGED Jun 30) — `exchangeApiKeyForSignerSession()` single-call contract (John's relocated durable exchange).
- **#421** `feat/composite-signer-bearer-pr210` (MERGED Jul 9) — `resolveSignerEndpoint()` emits composite `app_…_pmth_…` Bearer to the DMZ. **This is "Fix A".**
- **#424** builder-sdk 0.6.0 + RFC 8693 api-key exchange (merged).
- **#427** `feat/opaque-session-signer-endpoint` (current branch) — forward opaque `pmth_` session. **PR CLOSED (not merged).**

**4. Wiring TODAY — Fix B is orphaned on every branch.**
- `origin/main` `resolveSignerEndpoint()` (`pymthouse-adapter.ts`): API-key path first (composite → Bearer to DMZ; bare `pmth_` → `exchangeApiKeyForSignerSession`), else legacy fallback mints a **composite API key** via `createPymthouseApiKey`. It **does not call `mintUserSignerJwtForExternalUser`** (only a stale doc comment references it at ~line 271).
- current branch `feat/opaque-session-signer-endpoint` `resolveSignerEndpoint()` (`pymthouse-adapter.ts:270-279`): forwards the **opaque `pmth_` session** (`Authorization: Bearer ${session.accessToken}`); test explicitly asserts `mintUserSignerJwtForExternalUser` **not** called (`pymthouse-adapter.test.ts:155`).
- `rg 'mintUserSignerJwtForExternalUser' apps --glob '!*.test.ts'` → **only the definition**, zero call sites. Confirmed dead in the live path.

**5. Flag state.** `per_key_remote_signer` default **OFF** globally; **ON via per-team override for `livepeer-dev`** in prod Neon (audit Runs 48b/49). So the gate is enabled, but the code it now gates is the opaque/composite path, not the JWT mint.

### Is Fix B still needed given the composite-bearer path (Fix A)?
**No — it is superseded.** The remote-signer DMZ identity webhook accepts the composite `app_…_pmth_…` Bearer directly (Fix A, #421) and that path reached the orchestrator in Runs 50–54; the durable contract John relocated to is the **api-key signer-session exchange** (`exchangeApiKeyForSignerSession`, #412/#424). The user-scoped JWT mint (#406/#410) was an interim P7 attempt whose underlying clearinghouse grant 500'd; both `main` and the current branch have moved off it. Recommendation: treat `mintUserSignerJwtForExternalUser` as **removable dead code** (plus its stale doc reference in `pymthouse-adapter.ts`), not as pending work.

### If someone still wants Fix B "done" as specced
It would require (a) authoring the missing `NAAP-SIGNER-JWT-EXCHANGE-PLAN.md`, and (b) an upstream fix to the clearinghouse `mintUserSignerToken` 500 — neither is warranted while Fix A / api-key exchange work. Rough effort if pursued anyway: ~0.5 day NaaP re-wire + upstream pymthouse fix (out of NaaP's control).

**Sources (read-only):** `apps/web-next/src/lib/pymthouse-client.ts:285-315`, `.../pymthouse-adapter.ts:270-301` (branch) + `origin/main:pymthouse-adapter.ts:294-367`, `.../feature-flags.ts:84,177-181`, `.../keys/validate/route.ts:206-231`, `pymthouse-client.test.ts`, `pymthouse-adapter.test.ts:135-230`, `gh pr list` (#405/#406/#410/#412/#421/#424/#427), `git show 02a87ae1`.
