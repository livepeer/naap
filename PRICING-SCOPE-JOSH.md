# Per-Unit Billing — Minimal Scope for Josh (go-livepeer + python-gateway)

**From:** Storyboard/NaaP agent team · **To:** Josh
**TL;DR:** You were right — most of the original plan can be dropped. There is exactly **one** thing that genuinely breaks today and needs new code: **variable-size units** (image megapixels, TTS characters, LLM tokens) bill flat because the *quantity* never reaches the signer. Everything else already works or rides existing primitives.

---

## Why this matters (one paragraph)

Before a generation, the agent quotes the user a **USD price**. Today that quote can't match what actually settles on-chain, because the signer bills on **wall-clock time / a floor**, not on what the user actually consumed. A 4-MP image, a 6-second video, and a 2000-character TTS call all collapse to roughly the same ~1 µUSD blip. We verified this in code: `server/remote_signer.go` computes `fee = calculateFee(pixels, initialPrice)` where `pixels` is time-derived (`secSinceLastProcessed × PixelsPerUnit`, min 1) — **the request payload's real quantity is never seen by the signer.** We want `agent_quote_usd == on_chain_settled_usd`. That only requires the quantity to reach the signer for the units where it varies.

---

## What we AGREE stays simple / gets dropped

You said this doesn't need to be complicated. Verified against code and the live E2E audit — you're mostly right:

- **BYOC caps already bill.** `byoc-staging-1` already advertises per-cap prices in `GetCapabilitiesPrices` and bills real tickets today: nano-banana / recraft (per-image), ltx (per-second), ideogram (per-megapixel), gemini-text — all return 200 + real output + a real fee, with `orch PriceInfo == signer ExpectedPrice` after the #3993 overhead fix. **"Can't bill at all" is not true for BYOC.** No rework there.
- **Per-call (tools) and single per-image need NOTHING new.** These are `quantity = 1`. The existing flat/floor fee + the per-cap price already differentiate them. No new field, no new fee path, no new "fixed" type.
- **`type=live` / seconds path from #3992 is reused, not rebuilt.** It already proves runner-declared decimal-USD price → wei and a `type`-branched fee. We adopt it as the template; we do not fork it.
- **No new pymthouse meter is required for correct billing** (that's John's doc — spoiler: almost nothing). The existing fee meter + `eth_usd` bridge already invoice correctly *once the on-chain fee is right*.
- **lv2v / live streaming is untouched.**

---

## What genuinely breaks without new code (the tight case)

Exactly one class: **variable-size units.** The signer physically cannot infer these — only the gateway sees the payload:

| unit | why it breaks flat | fails as |
|---|---|---|
| **megapixel** (image) | a 1-MP and a 4-MP image at the same per-MP price must bill 1× vs 4× | signer bills a floor → both bill the same |
| **characters** (TTS) | `len(text)` varies per call | 100-char and 2000-char bill the same |
| **tokens** (LLM) | token count varies (and true output is post-inference) | can't bill per token at all |

For these, and only these, the **quantity must travel gateway → signer**. That is the whole ask.

---

## Required changes (minimum set)

### 1. Gateway — send `billing_unit_quantity` for variable units only
**Repo:** `python-gateway` · **Flag:** `SEND_UNIT_METERING` (default OFF)

- **Do:** extend the request `type` discriminator #3992 already sends (`live`/`lv2v`) with two optional keys on `/generate-live-payment`: `billing_unit_kind` + `billing_unit_quantity`. Compute quantity from the payload with one pure extractor per kind:
  - `megapixel` → `w × h × num_images / 2^20`
  - `characters` → `len(text)`
  - `tokens` → `input + output token count` (request-time estimate; see note below)
  - fixed kinds (`call`, single `image`) → **omit the field** (quantity is implicitly 1; existing behavior)
- **Reuse, don't rebuild:** #3992 already gives you the `second` basis for free and the `type` field to piggyback on.
- **Why necessary:** the signer never receives the payload (verified: `remote_signer.go` bills on time). This is the *only* place the natural quantity exists.
- **Done when:** table-driven test (`1024×1024×1 → ~1.0 MP`; `2000-char → 2000`; tokens → input+output). With flag OFF the request body has **no new keys** (byte-identical to today).
- **No regression:** OFF ⇒ identical; fixed caps never carry the field.

### 2. Signer — derive `fee = per_unit × quantity` for variable units
**Repo:** `go-livepeer` · **File:** `server/remote_signer.go` · **Flag:** `-unitMetering=off|observe|enforce` (default `off`)

- **Do:** on the existing `type`-branched path (state-locked, same `job type mismatch` guard), read the two optional fields and:
  - `observe`: stamp `billing_unit_kind`/`billing_unit_quantity` on the `create_signed_ticket` event, **fee unchanged** (lets us watch the numbers flow before money moves).
  - `enforce`: `fee_wei = (price_per_unit / price_scaling) × pixels_per_unit × billing_unit_quantity`.
  - fields absent ⇒ **today's time/floor path runs unchanged** (so fixed caps and lv2v are untouched).
- **Reuse, don't rebuild:** this mirrors the existing `calculateFee(pixels, initialPrice)` line — same shape, quantity swapped for the payload-derived value. `sanitizeUsageLabel` already exists for the kind string. Keep `price_scaling = 1_000_000`; **do not add a per-price scaling field** — the per-price term you need is the existing `pixels_per_unit`.
- **Guard:** assert `signer ExpectedPrice == orch advertised price` (the #3993 invariant) and cross-check the gateway quantity against the orch's request-derived quantity, so no untrusted layer becomes a fee authority.
- **Why necessary:** without the quantity in the fee, variable-size caps stay flat forever; this is where `agent_quote == on-chain settled` finally closes.
- **Done when:** hermetic Go unit test — variable-unit fee `== (price_per_unit/price_scaling) × pixels_per_unit × qty`; `off` and absent-fields ⇒ byte-identical fee to today; lv2v 30 s stream fee unchanged. Prod canary: after `enforce`, on-chain fee tracks the advertised per-unit price for ≥1 cap per variable unit; lv2v unaffected.

> **Merge note:** observe and enforce are **one PR, one flag** — not two deliverables. The old plan's separate "stamp-only" PR was safety theater; the flag gives you the same staged rollout in one change.

### 3. (Conditional) Orch — aggregate runner prices into `GetCapabilitiesPrices`
**Repo:** `go-livepeer` · **File:** `core/orchestrator.go` · **Flag:** `-aggregateRunnerPrices` (default OFF)

- **Only needed IF** you want to serve **one-shot** caps (image/tool) from a **live-runner orch**. We verified `GetCapabilitiesPrices` (L258–310) builds `CapabilitiesPrices[]` only from `modelPrices` — live-runner prices live on `/discovery` / the live-video `PaymentInfo` path and never enter it, so an LR-orch returns zero → `400 "missing or zero priceInfo"`. #3992 bridges the runner price into the **live-video** path only, not this one-shot path.
- **But** `byoc-staging-1` already bills these caps today. So this is a **migration enabler, not a billing prerequisite** — **defer it** unless moving one-shot caps onto the LR-orch is an active goal.
- **If done:** read each runner descriptor's `offering.price` (adopt #3992's decimal-USD `{price,currency,unit}` shape), map `unit` (`hour`→`second, pixels_per_unit=1`; `720p`→pixel-scaled), and apply the **same** `overhead = 1 + 1/txCostMultiplier` that `PriceInfoForCaps` already applies so `ExpectedPrice == RecipientRandHash`. OFF ⇒ `CapabilitiesPrices` byte-identical.

---

## The one cross-cutting must (prevents drift)

A **shared quantity-extractor spec + committed golden vectors** (one payload → expected qty per unit_kind), asserted in the Python gateway CI **and** the Go signer CI **and** the TS agent CI. This is the single thing that makes `gatewayQty == signerQty == agentQty` true *by construction* rather than by hope. It's small, and it's the difference between "reconciles" and "reconciles until someone edits one extractor."

## Honest edge to flag
**Tokens and true per-second-of-output video:** the *actual* usage is only known **post-inference**, so the gateway's request-time quantity is an estimate. For the minimum, bill the requested/max quantity at request time; a post-inference reconcile (via the orch's existing `DebitFees`) can true it up later if we care about the delta. Don't let this block the megapixel/characters case, which is exact at request time.

---

## Bottom line
Ship **#1 (gateway qty, variable units only)** + **#2 (signer fee=per_unit×qty, one flag)** + **the shared golden vectors.** Defer #3 unless the LR one-shot migration is on. Drop everything else. That's the complete set that makes per-unit billing correct with no agent/on-chain drift.
