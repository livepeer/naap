# Billed E2E Blocker Audit — naap_ → Billed Inference → OpenMeter

**Date:** 2026-07-17 (Run 47 — live probes + code review)  
**Method:** Live HTTP probes against prod/staging endpoints, `gh` PR status, gateway commit `1bf13cd` source review, gateway venv `submit_byoc_job` (certifi), Storyboard MCP regression.  
**Honesty rule:** This doc states what **failed today**, not what passed last week.

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
| B5 | **`recipientRand` / ticket param alignment** | If per-cap ON but orch/signer ticket params diverge → payment reject (not seen today — blocked earlier) | j0sh / John |
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

## Related docs

- `BILLED-E2E-REMAINING-PLAN.md` — pillar plan (Run 35–46 era)
- `USER-E2E-DEMO-RESULTS.md` — Run 45/46 detailed probes
- `BPP-VALIDATE-V2-NAAP-DISCOVERY.md` — validate/discovery contract
- `SIGNER-ORCH-DEPLOY-PLAN.md` — signer-side deploy targets
