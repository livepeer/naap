# Pricing End-to-End — Upstream Scope for Owners

**From:** the Storyboard/NaaP agent team
**To:** John (pymthouse), Josh (go-livepeer), Rick (python-gateway)
**Deploy branch:** `fix/signer-composite-bearer-forward`
**Recon basis:** verified read-only 2026-07-21 against `github.com/livepeer/go-livepeer` branches.

This document is written from the **agent's point of view** — the agent quotes a USD number to the user before a generation, and today that number does not match what actually settles on-chain or gets metered in pymthouse. Below is exactly which change each of you owns to close that gap, in PR format, in plain language.

---

## The end state we are building toward

> **One Orchestrator → many Live Runners.** Each runner configures its own pricing on its **capability descriptor** (`offering.price`, carrying `unit_kind` + `quantity_source`). The agent **discovers** the runners/caps and their prices, and **selects** one. At inference, payment tickets are sent; **pymthouse meters per-unit**; the **signer signs** the on-chain ticket and derives the fee from the runner's per-unit price × the quantity actually consumed. **The agent only ever sees USD** — never wei, never pixels.

Because the fee, the meter, and the agent quote all derive from the **same descriptor price row** and the **same quantity** (produced by one shared extractor), the three numbers are equal by construction. That is the invariant every PR below serves:

> **`agent_quote_usd == on_chain_settled_usd == pymthouse_metered_usd`** for the relevant unit.

Wire arithmetic the invariant rests on (retain `pixels_per_unit` end-to-end):

```
fee_wei = (price_per_unit / price_scaling) × pixels_per_unit × billing_unit_quantity
```

`price_scaling` stays the single global constant `1_000_000`. Do **not** add a new per-price scaling field — the per-price term you need already exists as `pixels_per_unit`.

### The concrete symptoms we are fixing

1. **Everything meters ~1 µUSD flat.** The signer meters `pixels = ceil(billable_secs)` ("seconds-as-flat-unit") for every non-live cap, and the collector clamps it to a ~1 µUSD fee-floor. A 4-MP image, a 6-s video, and a 2000-char TTS call all bridge to the same blip.
2. **Live-Runner caps 400.** LR prices live only on `GET /discovery` and never enter `GetCapabilitiesPrices`, so the LR advertises zero → `400 "missing or zero priceInfo"`.
3. **Image and video bill identically.** With no `billing_unit_kind`/`billing_unit_quantity` on the event, there is no way to distinguish or price per natural unit.

### What Storyboard has already shipped (so you have context)

The descriptor is now a **lossless source of truth**: `PriceSchema` carries optional `unit_kind` (∈ `{megapixel, image, second, characters, call, tokens}`) and `quantity_source`; discovery-sync reads the real `price.unit_kind` instead of faking it from `display_unit`; the agent's USD estimate uses the same shared quantity extractor you'll consume downstream. **This is done — the descriptor already carries `unit_kind`/`quantity_source` for you to read.** None of it changes billing yet; it just makes the data correct so your changes have something to consume.

---

## Global posture for all three owners

- **Additive & optional.** Every new field is optional; when absent, behavior is **byte-identical to today**.
- **Flag-gated, default OFF.** Each new billing path sits behind a flag that defaults OFF.
- **Observe → enforce.** Data flows and is metered/logged first; money only moves on the new number after the delta is proven ~0.
- **Transition floor.** `billedUsd = max(unitCostUsd, feeUsd)` — we never under-bill the real on-chain fee while parity is being proven.
- **lv2v / live streaming untouched.** The existing pixel/elapsed-seconds paths keep working unchanged.

---

# Josh — `go-livepeer` (orchestrator + signer)

### ✅ Already exists — do NOT rebuild
- **Runner decimal-USD price schema** (`ai/runner/live_runner.go` — `LiveRunnerPriceInfo{price, currency:"usd", unit:"hour"|"720p"}` → wei) from **#3992**. This is the exact price shape PR3 must **adopt**, not reinvent.
- **USD→wei conversion** + per-session `net.PriceInfo` bridging via `server/ai_http.go runnerOrchInfo()` + `DiscoverLiveRunners()` (#3992).
- **Session `type` discriminator**: `RemotePaymentState.Type`, session-locked with the `job type mismatch` guard, branching billing on `type ∈ {lv2v, live}` (`server/remote_signer.go`, #3992). **Extend this — do not fork it.**
- **`sanitizeUsageLabel`** (trim + 128-rune cap, `server/remote_signer.go ~:383`) and `resolveUsageLabels` (on `feat/byoc-per-cap-pricing-and-usage-labels`). Reuse verbatim.
- **`calculateFee(billableUnits, initialPrice)`** pattern (#3992) — the precedent PR8 mirrors.
- **The runner/discovery surface** is deployed as `lr-orch` (#3938, image `livepeer/go-livepeer:ja-live-runner`).

> **Bottom line:** `GetCapabilitiesPrices` is **untouched** on every branch, and `billing_unit_kind`/`billing_unit_quantity`/`unit_kind` return **zero grep hits** across `ja/live-pricing`. The plumbing exists; the three changes below do not.

---

## PR3 — `feat(orch): aggregate runner descriptor prices into GetCapabilitiesPrices`

**Why / user story.** As a Storyboard user selecting a Live-Runner cap (e.g. a nano-banana image), my request must reach a runner that advertises a real price. Today the LR advertises zero → the gateway gets `400 "missing or zero priceInfo"` and my generation never bills. This PR makes the orch surface each runner's own per-cap price so one orchestrator can front many runners that each price themselves. **Fixes symptom #2.**

**What to change.**
- File: `core/orchestrator.go` — `GetCapabilitiesPrices` (`~:266`); overhead math `~:448–457`.
- Behind flag **`-aggregateRunnerPrices`** (default OFF), read each runner descriptor's `offering.price` from `/discovery` and merge into `CapabilitiesPrices[]`.
- **Adopt #3992's decimal-USD price shape** (`{price (decimal string), currency, unit}` → wei), **not** the old `{price_per_unit, pixels_per_unit}` integers. Map the pricing `unit` into our vocabulary: live `hour` → `unit_kind=second`, `pixels_per_unit=1`; live `720p` → pixel-scaled `megapixel/second`.
- Apply the **same** `overhead = 1 + 1/txCostMultiplier` that `PriceInfoForCaps` already applies, so `ExpectedPrice == RecipientRandHash` price (fixes the `invalid recipientRand` / `400 Could not parse payment` class).
- Additive / no-regression: OFF ⇒ `CapabilitiesPrices` byte-identical to today (default/gateway/BYOC only).
- **Watch (follow-up, non-blocking):** #3992 replaced per-cap max-price filtering with a single global `BroadcastCfg.MaxPrice()`; don't silently lose per-cap price-policy granularity.

**Acceptance / done when.**
- Unit (hermetic, no CGO): OFF ⇒ byte-identical; ON ⇒ LR caps present, `CapabilitiesPrices[cap] == PriceInfoForCaps[cap]`, #3992 decimal-`price` shape parses to the right `unit_kind`/`pixels_per_unit`.
- **Prod validation:** on staging orch with flag ON — LR cap returns non-zero `priceInfo` (no more `400 missing or zero priceInfo`); a billed LR generation completes; **`orch PriceInfo == signer ExpectedPrice`** for that cap.

---

## PR5 — `feat(signer): stamp billing_unit_kind/quantity on create_signed_ticket (observe, fee unchanged)`

**Why / user story.** As a user generating a 4-MP image vs a 6-s video, the on-chain event must record *what unit and how much* I consumed — otherwise pymthouse can never meter per-unit and image/video look identical on-chain. This PR stamps the two missing fields on the ticket **without changing the fee yet**, so we can observe them flowing before any money moves. **Enables the fix for symptom #3.**

**What to change.**
- File: `server/remote_signer.go` — `RemotePaymentRequest`; `GenerateLivePayment` (`~:489`); `SendQueueEventAsync("create_signed_ticket", …)` (`~:855`).
- Add `BillingUnitKind string` + `BillingUnitQuantity float64` (both `omitempty`). Sanitize kind via existing `sanitizeUsageLabel` (`~:383`); clamp quantity to a sane positive range. Stamp both on the event.
- **Extend #3992's `type` discriminator** (the same `RemotePaymentState.Type` + `job type mismatch` guard) — stamp the new fields on the same event; do not create a parallel path.
- **Watch:** #3992 renames the emitted `cost_per_pixel` → `cost`; account for that rename in event-schema / forbidden-field work.
- **Fee math untouched.** When fields absent ⇒ byte-identical to today.

**Acceptance / done when.**
- Go unit (hermetic): event with fields ⇒ carries kind+qty; event without ⇒ identical serialization; sanitize/clamp bounds tested.
- **Prod validation:** on staging, emitted `create_signed_ticket` for a billed gen carries correct `billing_unit_kind`/`billing_unit_quantity`; **`computed_fee`/`pixels` unchanged vs pre-PR baseline.**

---

## PR8 — `feat(signer): derive fee = per_unit × quantity behind UNIT_FEE_ENFORCE (flag flip)`

**Why / user story.** This is where the money finally matches. As a user, my agent's USD quote should equal what settles on-chain. Once the signer derives the fee from the runner's per-unit price × the quantity I actually consumed, `agent_quote_usd == on_chain_settled_usd`. **Closes the reconciliation invariant on the on-chain side.**

**What to change.**
- File: `server/remote_signer.go` fee path.
- Behind flag **`UNIT_FEE_ENFORCE`** (default OFF): when on and fields present, derive
  `fee_wei = (price_per_unit / price_scaling) × pixels_per_unit × billing_unit_quantity`
  for image / image-flat / video / TTS / tool / **tokens**. Mirrors #3992's `calculateFee` pattern, branched on the same session-locked `type`/`unit_kind` discriminator.
- **lv2v seconds path untouched.** Falls back to today's `req.Type` basis when the flag is off or fields absent.
- **Guard:** pin + assert `ExpectedPrice == orch advertised price`; cross-check `billing_unit_quantity` against the orch's request-derived qty.
- **Must-fix caveat:** #3992's `server/live_payment_processor.go processOne` still derives billable amount from **pixels (720p@30fps)** regardless of the new price unit (open upstream bug, "fix incoming"). **PR8 must not inherit this** — add a test that a non-pixel cap bills on `qty`, not pixels.

**Acceptance / done when.**
- Go unit (hermetic fee math): fee for image/image-flat/video/TTS/tool/tokens == `(price_per_unit/price_scaling) × pixels_per_unit × qty`; lv2v 30s stream fee unchanged; OFF ⇒ identical to today; signer `qty` matches the shared golden vector (M1).
- **Prod validation:** staging → prod canary — after flip, on-chain fee tracks advertised per-unit price; `max(unitCost, fee)` delta → ~0; lv2v streams unaffected. Invariant holds: **`agent_quote_usd == on_chain_settled_usd`** for ≥1 cap per unit_kind.

---

# Rick — `python-gateway`

### ✅ Already exists — do NOT rebuild
- The gateway pin `jm/live-runner-session-payments` already **sends the live-runner session payment** and the **`type` discriminator** (`live`/`lv2v`).
- #3992 gives the **`second` (elapsed-seconds)** quantity basis "for free" — you do **not** need to build the second-path.

> **Bottom line:** the request plumbing and the `second` basis exist. What's missing is the quantity extractors for every **non-second** unit and attaching the two fields to the request.

---

## PR4 — `feat(gateway): compute billing_unit_quantity from payload, send unit+qty on /generate-live-payment`

**Why / user story.** As a Storyboard user generating a 4-MP image (or a 6-s video, a 2000-char TTS, a tool call, or an LLM token request), I should be billed for what I **actually consume** — not a flat blip. The gateway is the one place that sees the request payload, so it must compute the natural-unit quantity and send it downstream. Without this, the signer has nothing to stamp and pymthouse has nothing to meter. **Root of the fix for symptom #1 and #3.**

**What to change.**
- Add **one pure extractor per `quantity_source`**, defined by a **shared extractor SPEC + committed golden vectors (M1)** that the signer (Go) and agent (TS) reuse **verbatim**:

  | unit_kind | quantity |
  |---|---|
  | megapixel (image) | `w × h × num_images / 2^20` |
  | image (per-image) | `num_images` |
  | second (video) | `requested_seconds` |
  | characters (TTS) | `len(text)` |
  | tokens (LLM) | `input + output token count` |
  | call (tool) | `1` |

- **Per-call and per-image are NOT a new payment type** — they ride the same quantity mechanism (`quantity_source = const_1` for call; `= num_images` for image). No special fee path.
- Attach `{billing_unit_kind, billing_unit_quantity}` to **`/generate-live-payment`**, extending the **same request `type` discriminator** #3992 uses for `lv2v`/`live` — don't fork it.
- Behind flag **`SEND_UNIT_METERING`** (default OFF): OFF ⇒ request body has **no new keys** (byte-identical).

**Acceptance / done when.**
- Unit (table-driven): `1024×1024×1 → ~1.0 MP`; `2 images → 2`; `2000-char → 2000`; token payload → input+output; tool → `1`. The **committed golden vector** (same payload → expected qty per unit_kind) is asserted here **and** in the Go signer + TS agent CI (M1 — cross-language parity, no drift).
- **Prod validation:** on staging with flag ON, capture the `/generate-live-payment` body for image/video/TTS/tool — assert correct `billing_unit_kind` + quantity; fee/behavior unchanged (signer still ignores for fee at this stage).

---

# John — `pymthouse` (collector + OpenMeter)

### ✅ Already exists — do NOT rebuild
- The **`network_fee_usd_micros`** fee meter and **`signed_ticket_count`** — keep them **untouched** and **forever** (on-chain truth / floor).
- The **`eth_usd` bridge** (wei → USD) already exists and converts correctly — the reconciliation gap is **upstream** of the bridge, not in it.

> **Bottom line:** you are **adding** one new meter and a passthrough, not touching the existing fee metering or the bridge.

---

## PR6 — `feat(collector): passthrough unit_kind+quantity + one usage_units SUM meter`

**Why / user story.** As the billing system, once the signer stamps `billing_unit_kind`/`billing_unit_quantity` on the ticket, pymthouse must carry those fields through the collector and expose one meter that sums the quantity per unit_kind — so we can report and later cost per natural unit. Today none of that lands, so a 4-MP image and a 2000-char TTS are indistinguishable. **Enables per-unit reporting; prerequisite for costing.**

**What to change.**
- Collector passthrough: map `unit_kind = billing_unit_kind ?: "unknown"`, `unit_quantity = billing_unit_quantity | 0`.
- Add **one** meter: **`usage_units: SUM($.unit_quantity)`** grouped by `unit_kind` / capability / model. (Model A only — no per-cap/per-modality meter proliferation, no rules engine.)
- Add both fields to the schema **forbidden-field list** (BPP hygiene). Keep `network_fee_usd_micros` + `signed_ticket_count` untouched.
- Additive: the meter reads **0** until producers emit — so it can deploy **first** (Phase 0), ahead of PR5.

**Acceptance / done when.**
- Collector test: synthetic `create_signed_ticket` with new fields → CloudEvent carries `unit_kind`/`unit_quantity` **and still** `network_fee_usd_micros`. Backward-compat: no-field event → `usage_units = 0`.
- OpenMeter integration: ingest → query `usage_units` grouped by unit_kind.
- **Prod validation:** on staging, `usage_units` provisions; existing fee meter unchanged; ingest a real signed ticket → per-unit SUM appears grouped by unit_kind for image/video/TTS/tool.

---

## PR7 — `feat(pymthouse): cost = quantity × per_unit_usd, observe→enforce, reconcile vs on-chain fee`

**Why / user story.** As the billing system, the invoice a customer sees must equal the advertised per-unit price × what they consumed — and it must reconcile against the on-chain fee. This PR computes cost from the metered quantity and the descriptor's per-unit USD, first observing (logged-only) then enforcing. **Closes the reconciliation invariant on the metering side.**

**What to change.**
- Cost = `billing_unit_quantity × per_unit_usd`, where `per_unit_usd = descriptor.offering.price.display_usd`.
- Behind flag **`UNIT_COST_ENFORCE`** (default OFF = observe). Observe = logged-only; enforce settles `max(unitCostUsd, feeUsd)` (the transition floor). `unit_quantity` absent/zero ⇒ falls back to `feeUsd` (identical to today).
- Add a **reconciliation delta metric** `|unitCostUsd − feeUsd|` per cap that alerts on drift. Per-unit USD reporting per customer / cap / model.

**Acceptance / done when.**
- Unit: `unitCostUsd` per unit_kind matches `display_price_usd × qty`. CI parity: **`agent_quote_usd == pymthouse_metered_usd`** per unit_kind. Backward-compat: missing qty → falls back to fee.
- **Prod validation:** observe phase in prod — dashboards show `unitCostUsd` tracking `feeUsd` within tolerance for ≥1 cap per unit_kind **before** flipping `UNIT_COST_ENFORCE`; after enforce, invoices reconcile to advertised prices. Invariant holds: **`agent_quote_usd == on_chain_settled_usd == pymthouse_metered_usd`**.

---

# Cross-owner dependencies & ordering

```
Storyboard PR1 + PR2  ✅ SHIPPED  (descriptor carries unit_kind + quantity_source)
        │
        ├───────────────────────────────────────────────┐
        ▼                                                 ▼
 Josh · PR3 (orch aggregate)                     Rick · PR4 (gateway qty)
 -aggregateRunnerPrices                          SEND_UNIT_METERING
 closes G1 / the 400                                     │  pairs with
        │                                                ▼
        │                                        Josh · PR5 (signer stamp, observe)
        │                                                │
        │                                                ▼
        │                                        John · PR6 (collector + usage_units meter)
        │                                        (can deploy first, reads 0)
        │                                                │
        │                                                ▼
        │                                        John · PR7 (cost = qty × per_unit, observe→enforce)
        │                                                │  proves delta ~0
        ▼                                                ▼
        └────────────────►  Josh · PR8 (fee = per_unit × qty, UNIT_FEE_ENFORCE)  ◄─────────┘
                            requires PR3 done + PR7 observe proving delta ~0
```

**Ordering rules (read these):**
1. **`PR3` before `PR8`.** The signer's fee-from-qty enforce depends on the orch advertising the correct per-cap price to pin against.
2. **`PR4` pairs with `PR5`.** The gateway computes+sends the quantity; the signer stamps it. PR5 depends on PR4.
3. **`PR6` before `PR7`.** The meter must exist before cost is computed from it. (PR6 can deploy first, reading 0.)
4. **`PR5` before `PR6` for real data**, but PR6 can ship ahead reading 0.
5. **`PR8` last**, and only after **PR7 observe** proves the `|unitCostUsd − feeUsd|` delta is ~0.
6. **Storyboard `PR1`/`PR2` are already shipped** — the descriptor `unit_kind`/`quantity_source` you all read from is live; nothing waits on us.

**Shared artifact you must all agree on:** the **quantity extractor SPEC + golden vectors (M1)** — one committed fixture (payload → expected qty per unit_kind) asserted in Rick's Python CI, Josh's Go signer CI, and the TS agent CI. This is what guarantees no cross-language drift.
