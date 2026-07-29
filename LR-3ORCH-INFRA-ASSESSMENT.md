# LR 3-Orch Infra — Assessment (SDK swap + 2 more LR orchs + standard schema)

**Type:** ASSESSMENT ONLY — read-only, findings only. **No implementation / deploy / build / mutation.**
`byoc-staging-1` inspected read-only, **never touched**. `byoc-staging-1` stays non-regressing throughout.
**Date:** 2026-07-28 · **Branch:** `docs/pricing-scope-simplified` · **Author:** seanhanca

**Question assessed (NOT to build):** deploy the latest `ja/live-runner` gateway SDK to replace the
current `sdk.daydream.monster` / `sdk-staging-1` image; stand up **two more** live-runner orchs
(`liverunner-orch2`, `liverunner-orch3`), each hosting ~half of the 137 fal caps in a one-orch →
many-runner layout (one runner per cap, each with its own price, standard Storyboard capability schema
in `runners.json`); do **not** touch `byoc-staging-1`.

---

## 0. Verdict (one line)

> The plan's **SDK swap + 2 orchs + standard schema is NECESSARY but NOT SUFFICIENT.** The gateway sends
> the fal single-shot runners as **`type=fixed`**, and **neither currently-deployed signer implements
> `RemoteType_Fixed`** — so **BOTH signer paths BREAK for the fal (`type=fixed`) caps with
> `HTTP 400 {"error":{"message":"invalid job type"}}`** until the signer(s) gain `RemoteType_Fixed`
> (the merged `fixed`+`byoc` image, per the no-regression plan). **BYOC + daydream `lv2v` do NOT
> regress** — precisely because the signers are untouched (both retain `lv2v` + `/sign-byoc-job`), the
> gateway swap is additive, and discovery repoint is additive. `byoc-staging-1` is untouched.

**Ground truth (run61, 2026-07-28 PM):** on the clean v0.9.0 orch `:8936` per-cap flux-schnell
challenge — **native 402 PASS** (per-cap fixed price `1650818680214/1 ≈ $0.00315`, ticket params,
funded reserve `0x6CAE3C7a…` live); **`/generate-live-payment type=fixed` → `400 invalid job type`**
on the deployed pymthouse signer (no `RemoteType_Fixed`); `lv2v` → `numTickets … exceeds maximum of 100`;
`byoc` → `500`. Both deployed signers (daydream `c0e79ccb`, pymthouse `sha-4214202f`) lack `fixed`.

---

## A. daydream-signer path — works / breaks

**Signer:** shared `signer.daydream.live` (= `signer-staging-1` + `signer-staging-2`), running
`go-livepeer:c0e79ccb` (2026-06-10) — `lv2v`-only, **has `/sign-byoc-job`**, **no `RemoteType_Fixed`**.
`_effective_signer` resolves a **daydream key → the daydream signer** (one signer per request, keyed by
key type). Signer is **NOT touched** by this plan.

| # | Path (daydream key) | Works / Breaks | Exact behavior + evidence |
|---|---|---|---|
| A1 | Existing daydream `lv2v` / daydream-plane generation | ✅ **WORKS — no regression** | Signer untouched ⇒ `RemoteType_LiveVideoToVideo` (`lv2v`) + `RemoteType_Live` retained; `/generate-live-payment` unchanged. Gateway swap is **additive** (`ja/live-runner` carries both `call_runner` AND the full byoc symbol set). run61 daydream e2e PASSED on the daydream/fal plane (metered $0.00320), which routes via production daydream infra, **not** `:8936`. |
| A2 | daydream key → **new LR orch fal caps** (gateway sends `type=fixed`) | ❌ **BREAKS** | The daydream signer `c0e79ccb` has **no `RemoteType_Fixed`**; `type=fixed` is neither `byoc`/`lv2v`/`""` → hits `else if req.Type != "" { errors.New("invalid job type") }` → **`HTTP 400 "invalid job type"`** at `/generate-live-payment`. No payment mints, generation never reached. |
| A3 | byoc caps via daydream signer (`/sign-byoc-job`) | ✅ **WORKS — unaffected** | Signer untouched ⇒ `POST /sign-byoc-job` (`SignBYOCJobRequest`) retained; `byoc-staging-1`'s on-chain caps that use the shared signer keep signing. `signers.yaml`: image MUST include `/sign-byoc-job` — satisfied at `c0e79ccb`. |

**Gate for A2 to work:** the **daydream signer must gain `RemoteType_Fixed`** — but only *if daydream
keys are intended to route to the new LR fal caps*. The no-regression plan's design is that **LR fal
caps are served on the naap/pymthouse path only**; if daydream keys stay on the daydream/lv2v plane,
the daydream signer needs **no change** and nothing regresses (A2 simply isn't exercised). If you *do*
route daydream keys to LR fal caps, upgrade the shared signer to a **merged `fixed`+`/sign-byoc-job`+`byoc`**
image (never raw v0.9.0 — that drops `/sign-byoc-job` and hard-breaks all 137 byoc caps on the shared
signer).

---

## B. pymthouse-signer path — works / breaks

**Signer:** pymthouse DMZ signer (`SIGNER_FROM_VALIDATE=1`, naap billed path), pinned
`go-livepeer:sha-4214202f` (2026-07-11) — `lv2v` + `byoc` (+ per-cap `useByocPricing`), **has
`/sign-byoc-job`**, **no `RemoteType_Fixed`**. `_effective_signer` resolves a **naap key → the pymthouse
signer**. Signer is **NOT touched** by this plan.

| # | Path (naap key) | Works / Breaks | Exact behavior + evidence |
|---|---|---|---|
| B1 | naap key → **new LR orch fal caps** (gateway sends `type=fixed`) | ❌ **BREAKS** | Confirmed **empirically at run61**: `/generate-live-payment type=fixed` → **`HTTP 400 {"error":{"message":"invalid job type"}}`**. `sha-4214202f` has no `RemoteType_Fixed`; `type=fixed` falls through the type switch → `"invalid job type"`. (`byoc` → 500; `lv2v` → `numTickets > 100`. None of the three usable mint types produce a valid fixed payment.) |
| B2 | byoc caps via pymthouse signer (`/sign-byoc-job`) | ✅ **WORKS — unaffected** | Signer untouched ⇒ `SignBYOCJobRequest` + `RemoteType_BYOC` + per-cap byoc pricing retained at `sha-4214202f`. Any byoc cap a naap key requests still signs. |
| B3 | naap validate / composite-bearer path under the SDK swap | ✅ **WORKS — unaffected** | run60: naap key → `/keys/validate` → endpoint-form `signerSession {url,headers}`, composite bearer **byte-identical** to the supplied token; validate resolves the per-key signer. The `ja/live-runner` swap is additive and does not change `_effective_signer` (`app.py:904-923`) or the validate→composite chain. Auth ✅, discovery/price ✅, payment-mint = the only broken step (B1). |

**Gate for B1 to work:** the **pymthouse DMZ signer must be upgraded to a MERGED image** =
`RemoteType_Fixed` (v0.9.0 / #3999) **+** `SignBYOCJobRequest` / `/sign-byoc-job` **+** `byoc` per-cap
pricing (it already has the last two). Raw v0.9.0 there would 404 `/sign-byoc-job` for any naap-key byoc
cap — a regression on the naap path — because `_effective_signer` returns **one** signer for **both** the
LR dispatch and the byoc dispatch (no per-cap signer routing). No single existing ref has both `fixed`
and `/sign-byoc-job` (v0.9.0 and `feat/add-byoc-signing` diverged at `cbd29d89`, 2026-06-30) → a merge
is required.

---

## Gating prerequisite (both paths, one sentence)

> **A fixed-capable signer must be deployed per path:** the **pymthouse DMZ signer** MUST gain
> `RemoteType_Fixed` (merged with `/sign-byoc-job`+`byoc`) for the naap→LR-fal path (B1); the **daydream
> signer** MUST gain `RemoteType_Fixed` (also merged) **only if** daydream keys are routed to LR fal caps
> (A2) — otherwise leave it untouched. **`signer.daydream.live` must NEVER go to raw v0.9.0** (drops
> `/sign-byoc-job` → all 137 byoc caps fail). The SDK swap, the 2 orchs, and the schema are all
> necessary but change **nothing** about this: fixed still 400s until the signer(s) implement it.

---

## C. The 2-more-orch topology specifics

### C.1 Per-orch prerequisites beyond authoring 137 standard-schema descriptors

Splitting 137 caps across `orch2` + `orch3` introduces **more than descriptor authoring**. Each new orch is
a distinct on-chain orchestrator and needs its own operational footprint:

| Prerequisite | Per new orch (orch2, orch3) | Evidence / note |
|---|---|---|
| On-chain identity + `serviceURI` | **Each orch = its own wallet / on-chain registration + `SetServiceURI`** (gas). v0.9.0 boot reuses the funded orch wallet in memory only; a genuinely separate orch needs its own funded identity. | v0.9.0 onchain registration; `SetServiceURI` is a fund-spending tx (owner = orch-wallet holder). |
| Funded sender reserve | **Each orch's payer needs a funded TicketBroker deposit/reserve** so `type=fixed` tickets are redeemable. run61 proved the reserve gate is live: a random payer → `500 insufficient sender reserve`; only the funded payer `0x6CAE3C7a…` passes. | A fresh unfunded payer signs but the orch rejects on reserve. |
| Discovery entry (SDK fan-out) | **`LR_ORCH_DISCOVERY` / `SELECT_PROVIDER_LR_CAPS` must fan out across all 3 LR orchs** (v09 `:8936` + orch2 + orch3). Today discovery points at a single `:8936`. | `LR_ORCH_DISCOVERY` feeds ONLY the LR dispatch; byoc routing (`ORCH_URL`/`CAPABILITY_ORCH_MAP` → `:8935`) is untouched; LR failure fails-open to BYOC. |
| Cap-name-collision safety | **No LR cap NAME may collide with any of the 137 byoc cap names**, and cap names must be **disjoint across orch2/orch3** (one runner per cap, split ~half each). A collision diverts a byoc cap to an LR orch. | Highest-risk footgun; keep `SELECT_PROVIDER_LR_CAPS`/`LR_OFFERINGS_JSON` names disjoint. |
| TLS / DNS | Each orch needs its own hostname + Caddy Let's-Encrypt front on `:443` → self-signed `:8935/:8936`. | Same two-layer pattern as the current LR VM. |

**Net:** authoring 137 standard-schema runner descriptors is the *smallest* part. Each new orch also
needs **its own funded on-chain identity + serviceURI + funded sender reserve + discovery fan-out entry**,
plus disjoint cap names. None of this is `byoc-staging-1`-touching.

### C.2 Do ALL 137 caps map to the live-runner single-shot model? — NO; categories + gaps

The 137 is the **full `byoc-staging-1` cap count**. The ground-truth docs fully author only **13** of them
(8 fal + 5 tool). Expressibility by category:

| Category | Maps to LR single-shot `type=fixed`? | Notes / gaps |
|---|---|---|
| **fal image** (t2i/edit): flux-schnell, flux-dev, gpt-image, kontext-edit | ✅ **Yes** — single request/response | Authored + schema-valid. `gpt-image` has `model_id` drift (`openai/gpt-image` in the table vs fal `fal-ai/gpt-image-1/text-to-image`). |
| **fal video** (i2v/t2v): pixverse-i2v, veo-t2v, seedance-mini-i2v | ✅ **Yes** — single-shot request/response (render-and-return, **not** real-time streaming) | `seedance-mini-i2v` price is a **GAP** (null in pricing-table/wire; $0.0394/s docs-only). |
| **fal audio** (tts): chatterbox-tts | ✅ **Yes** — single-shot | Authored + schema-valid. |
| **tool caps**: ffmpeg-concat/trim/export, hyperframes-render, blender-headless | ✅ **Yes** — single-shot `/run`, per-verb static runners | 3 prices **PROVISIONAL/null** (`ffmpeg-trim`, `hyperframes-render`, `blender-headless`); dispatch needs `LR_OFFERINGS_JSON` constant-verb injection (config, owner-gated). Live today on `tool-staging-1`. |
| **genuine streaming / real-time**: `live-video-to-video/scope` (lv2v) | ❌ **NO** — continuous/real-time, stays on `lv2v` (time-based) | NOT single-shot; not expressible as `type=fixed`. |
| **remaining ~124 unenumerated byoc caps** | ⚠️ **UNVERIFIED** | The docs explicitly say "enumerate before migrating." "ALL byoc-staging-1 fal caps covered in full" is **not yet substantiated** — the single-shot expressibility, prices, and unit_kinds of the ~124 caps beyond the 13 are not established here. Some are likely streaming/tool/non-image. |

**Gap summary:** (1) genuine streaming caps (`lv2v`/`scope`) are **not** single-shot and must stay on
`lv2v`; (2) several caps lack finalized prices/unit_kind (seedance + 3 tool caps); (3) `model_id` drift
(`gpt-image`); (4) the bulk of the 137 (~124) is **not enumerated** — the "full coverage" claim needs a
per-cap census first.

### C.3 Standard-schema conformance (single source of truth)

The single-source-of-truth path **applies and is enforceable now**: each runner entry in `runners.json`
embeds a Storyboard `capability` descriptor, and `live-runner-v2/scripts/lr-gen-runners.mjs` runs the
**exact `validateDescriptor` the discovery-sync uses**, asserts native `price_info` ({price,currency:"usd",
unit ∈ fixed|720p|hour}) is **derived-consistent** with `capability.offering.price` (price == display_usd,
app/mode/capacity match, `health_url` required), and runs the pure `planDiscoverySync` dedup planner
against the committed `registry.json`. Current committed state: **13 runners → 13 ADD-CAPACITY, 0
SYNONYM-SKIP, 0 invalid**. Extending to 137 requires 137 conformant descriptors; **any cap missing
`display_usd`/`unit_kind` fails schema-completeness** (seedance, 3 provisional tool caps today). This is a
CI-gated authoring task, not a topology change.

---

## D. The `type=fixed` question — definitive verdict

### D.1 Is `type=fixed` the correct payment type for ALL fal caps, and does `type=fixed == single-shot`?

**Yes.** `type=fixed` **is** the single-shot payment type: **one payment per request**. On a
`fixed`-capable signer (#3999 / v0.9.0), `RemoteType_Fixed` sets `billableUnits = 1` →
`fee = calculateFee(1, initialPrice)` → **`numTickets ~1`**; the orch's `reservePaidLiveRunnerSession`
requires `PixelsPerUnit == 1`, accounts **`units:1` once**, and **rejects follow-up payments** on a fixed
session (`TestLiveRunnerFixedPriceSessionAccountsOnce`). So `type=fixed` ≡ "charge exactly one flat unit
per request/session" ≡ single-shot. This is exactly what every fal cap needs (each `/generate` or `/run`
is one request → one response → one payment).

### D.2 unit_kind → payment-type mapping

The **native payment `unit`** (`fixed` | `720p` | `hour`) is derived independently of the descriptor's
**`unit_kind`** (the *metering-granularity* dimension). All single-shot request/response caps → **`fixed`**;
only genuine continuous streaming → time-based (`lv2v`/`720p`/`hour`).

| descriptor `unit_kind` | example caps | single-shot? | native payment `unit` / `type` |
|---|---|---|---|
| `image` | gpt-image, kontext-edit | ✅ yes (1 call = 1 image) | **`fixed`** — exact |
| `call` | ffmpeg-concat/trim/export, hyperframes, blender | ✅ yes (1 call = 1 job) | **`fixed`** — exact |
| `megapixel` | flux-schnell, flux-dev | ✅ yes (single request) | **`fixed`** — flat per call (metering-approx, see D.3) |
| `second` | pixverse-i2v, veo-t2v, seedance-mini-i2v | ✅ yes (single render-and-return; **not** real-time) | **`fixed`** — flat per call (metering-approx) |
| `characters` | chatterbox-tts | ✅ yes (single request) | **`fixed`** — flat per call (metering-approx) |
| `tokens` | (LLM-style single-shot caps, if any) | ✅ yes (single request) | **`fixed`** — flat per call (metering-approx) |
| *(continuous)* | `live-video-to-video/scope` | ❌ **no** — real-time streaming | **`lv2v`** (time-based `720p`/`hour`) — the **only** non-fixed case |

### D.3 Per-second / per-char caps: is `fixed` correct as a PAYMENT type?

**Yes.** For per-MP/second/char caps, `fixed` is the correct **payment type** even though the descriptor's
metering granularity is per-unit. The per-unit exactness (a per-MP/second/char cap billed at a flat
reference amount over/under-charges vs true output size) is a **metering concern (gap F)**, **not a
payment-type concern**. These caps are still single-shot request/response — the payment is one flat
charge per request; only the *amount's* per-unit precision is deferred to a future per-unit USD metering
seam. That gap does not make them non-`fixed` and does not make them streaming.

### D.4 Precise verdict (as requested)

> **Yes, `fixed` is right for all single-shot fal caps** (image / call / megapixel / second / characters /
> tokens — every render-and-return request/response cap). **`type=fixed == single-shot` = one payment per
> request** (`billableUnits=1`, `PixelsPerUnit=1`, session accounts once). **The only non-`fixed` case is
> genuine streaming** (real-time `live-video-to-video/scope` → `lv2v`, time-based). **Per-unit exactness is
> a metering concern, not a payment-type concern** — per-second/per-char caps stay `fixed`; their billed
> amount is a flat reference until per-unit USD metering (gap F) lands. The evidence matches this verdict;
> no correction needed.

---

## Overarching conclusion

1. **SDK swap + 2 orchs + standard schema = necessary, not sufficient.** The `ja/live-runner` gateway
   sends the fal single-shot runners as `type=fixed`; **both deployed signers lack `RemoteType_Fixed`**,
   so **both signer paths BREAK for the fal caps** with `HTTP 400 "invalid job type"` (empirically
   confirmed on the pymthouse signer at run61; identical fall-through on the daydream signer `c0e79ccb`).
2. **Which signer must be upgraded, per path:**
   - **pymthouse (naap) path (B1):** upgrade the **pymthouse DMZ signer** to a **merged** image
     (`RemoteType_Fixed` + `/sign-byoc-job` + `byoc`). Mandatory for LR fal caps; preserves naap-path byoc.
   - **daydream path (A2):** upgrade the **daydream signer** to a **merged** image **only if** daydream keys
     route to LR fal caps. If daydream stays on its `lv2v` plane, **leave `signer.daydream.live` untouched**
     (no regression). Never deploy raw v0.9.0 to the shared signer.
3. **No regression to working paths:** BYOC (both signer paths, via `/sign-byoc-job`) and daydream `lv2v`
   are **untouched** because the signers are untouched, the gateway swap is additive (both `call_runner`
   and byoc symbols present), and discovery repoint is additive with fail-open to BYOC.
4. **`byoc-staging-1` stays non-regressing throughout** — the plan touches the SDK image, the pymthouse
   signer, and LR discovery/orchs only; the shared signer retains `/sign-byoc-job`, so all 137 on-chain
   byoc caps keep signing. `byoc-staging-1` is never a target.
5. **137-cap caveats:** only 13 caps (8 fal + 5 tool) are authored/validated today; ~124 are
   unenumerated; genuine streaming (`lv2v`/`scope`) is **not** single-shot; several caps lack finalized
   prices/unit_kind (seedance + 3 tool caps). A per-cap census + standard-schema authoring (CI-gated by
   `lr-gen-runners.mjs`) precedes any "full coverage" claim.

---

## Evidence index (all read-only)

- **run61 (decisive `type=fixed`):** `LR-V0.9.0-EXECUTION-REPORT.md` §"`type=fixed` decisive addendum" —
  native 402 PASS on `:8936`; `type=fixed` → `400 invalid job type`; `byoc` → 500; `lv2v` → `numTickets>100`;
  funded reserve `0x6CAE3C7a…`; probe `scripts/run61-lr-fixed-probe.py`.
- **Both signers lack fixed / SDK swap safe:** `LR-SDK-ONLY-DEPLOY-VERIFICATION.md` (claims (a)–(f);
  signer inventory: daydream `c0e79ccb` lv2v-only+`/sign-byoc-job`; pymthouse `sha-4214202f` lv2v+byoc+`/sign-byoc-job`, no fixed).
- **BYOC-regression / merged-signer requirement:** `LR-DEPLOY-REGRESSION-ASSESSMENT.md` (v0.9.0 drops
  `/sign-byoc-job`; no single ref has both `fixed` + `/sign-byoc-job`; diverged `cbd29d89`).
- **`unit=fixed`→`type=fixed` native, deploy-not-code:** `LR-AUTHOR-INPUTS-INVESTIGATION.md`
  (`_RUNNER_PAYMENT_TYPES_BY_UNIT["fixed"]="fixed"`; `RemoteType_Fixed → billableUnits=1`; deployed builds stale).
- **Fixed == single-shot mechanics:** `LR-SINGLESHOT-VS-LV2V-ASSESSMENT.md`, `LR-TEST-WITHOUT-NEW-SIGNER.md`
  (`billableUnits=1`, `PixelsPerUnit=1`, session accounts once, rejects follow-ups; offchain payment-skip).
- **One-orch→many-runner topology + unit_kind table + gaps:** `LR-ONE-ORCH-MANY-RUNNER-SETUP.md`
  (per-cap runners, USD→wei, per-unit metering gap F, seedance gap H, model_id drift).
- **Standard-schema single-source-of-truth:** `live-runner-v2/runners.json`,
  `live-runner-v2/scripts/lr-gen-runners.mjs` (validateDescriptor + native derivation + dedup plan);
  tool-cap authoring `LR-V1-RETIRE-REPORT.md`, `LR-V1-TOOLCAP-MIGRATION-PLAN.md`.
- **Deploy sequencing / 137-byoc-name-collision:** `LR-JOHN-DEPLOY-RUNBOOK.md`.
