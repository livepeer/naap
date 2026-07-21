# PR #3992 ("Ja/live pricing") — Fixed / Live-Runner Pricing Analysis

> SCRATCH NOTES — do not treat as design doc. Written while `NETWORK-PRICING-ARCHITECTURE.html`
> and `PRICING-EXECUTION-PLAN.html` are being edited concurrently by another worker.
> Source: `gh pr diff 3992 --repo livepeer/go-livepeer` (state: **DRAFT**, author rickstaa,
> branch `ja/live-pricing`, base is a feature branch not `main`, stacked with #3938).

---

## 0. TL;DR verdict (read this first)

**The user's mental model does not match what #3992 actually does.** There is **no `type=fixed`
per-request/per-image payment type in this PR** — the string `fixed` does not appear anywhere in the
diff. What #3992 actually ships is:

1. A **new runner price schema** (`LiveRunnerPriceInfo`) that advertises a **decimal USD price** with
   a `unit ∈ {hour, 720p}` discriminator (flat-hourly vs per-pixel), converted to **wei** for the wire.
2. A **new signer job `type=live`** that bills **elapsed wall-clock seconds** (time-metered, 10s
   minimum), alongside the existing pixel-based `type=lv2v`.

Both mechanisms are **time-based / streaming** (live video). Neither is a "flat $X per request/image".
So:

- **Per-call (tools) and per-image (nano-banana) are NOT natively covered by #3992.** Those are discrete
  request/response caps; #3992's `type=live` meters seconds, which is the wrong basis for a per-call fee.
- **`price=0.001` is NOT `$0.001 per request`.** It is `$0.001 per hour` (unit=hour) or per 720p-hour
  (unit=720p), USD, prorated to elapsed seconds, then converted to **wei** at settlement.
- **Tokens is a real gap, but it is NOT the *only* gap** relative to the user's thesis: per-call and
  per-image still need the `billing_unit_kind`/`billing_unit_quantity` quantity design (PR4/PR5). Under
  the *design's* per-unit-quantity mechanism (not #3992), quantity=1 handles per-call/per-image trivially
  and **tokens is the residual B3 blocker**.

Net: #3992 **validates** two pillars of our design (runner-advertised decimal USD price; signer branching
fee logic on a `type`), but it **does not reduce** the need for the quantity-stamping design for discrete
caps, and it does **not** solve the tokens gap.

---

## 1. What PR #3992 actually changes (file:line)

### 1a. Runner price schema: `price/currency/unit` replaces `price_per_unit/pixels_per_unit`
`ai/runner/live_runner.go` — `LiveRunnerPriceInfo` (diff hunk @ `type LiveRunnerPriceInfo struct`, ~L79):

```go
// BEFORE
PricePerUnit  int64  `json:"price_per_unit"`
PixelsPerUnit int64  `json:"pixels_per_unit"`
Unit          string `json:"unit,omitempty"`      // "USD" | "WEI"
// AFTER
Price    json.Number `json:"price"`               // decimal, e.g. "0.001990656" (string on wire)
Currency string      `json:"currency,omitempty"`  // runner side: must be "usd" (default)
Unit     string      `json:"unit,omitempty"`      // "hour" (default) | "720p"
```

- `priceRat()` (`ai/runner/live_runner.go`, new): parses `Price` as a positive `big.Rat`; requires it.
- `normalizeLiveRunnerPriceInfo()` (new): currency defaults to `usd` and **must** be `usd`
  (`price_info.currency must be usd`); unit defaults to `hour`, allowed `{hour, 720p}` else
  `price_info.unit must be hour or 720p`.
- `normalizeHeartbeat()` (~L869): now calls `normalizeLiveRunnerPriceInfo` instead of the old
  positive-int + `USD|WEI` check.

### 1b. USD→wei conversion + unit semantics
`ai/runner/live_runner.go` — `newConverterForRunner()` / `convertPrice()` (~L1663):

- `unit=hour`  → denom `3600` → **wei per second**; converted `Unit = "seconds"`.
- `unit=720p`  → denom `3600 * 1280*720*30` (720p@30fps) → **wei per pixel-second**;
  converted `Unit = "720p-pixel-seconds"`.
- Conversion goes through `core.NewAutoConvertedPrice("USD", …)` + `common.PriceToInt64` (PriceFeedWatcher),
  emitting `{Price: <wei>, Currency: "wei", Unit: "seconds"|"720p-pixel-seconds"}`.
- `PaymentInfo()` (~L958) and `discoveryRunner()` (~L1608) now call `runner.convertPrice()`.

### 1c. Orch → net.PriceInfo bridge and discovery advertisement
`server/ai_http.go`:
- `runnerOrchInfo()` (~L411): reads `priceInfo.Price.Int64()` (must be >0), sets
  `net.PriceInfo{PricePerUnit: <wei>, PixelsPerUnit: 1}` → `TicketParams`.
- `DiscoverLiveRunners()` (~L814): advertises `{Price: <wei str>, Currency: "wei", Unit: "720p-pixel-seconds"}`.

### 1d. Discovery validation on the consumer/signer side
`server/remote_discovery.go`:
- `validateRunner()` / `validateRunnerPrice()` (new, replacing `remoteDiscoveryRunnerEligible`): requires
  `currency == "wei"` and `unit ∈ {seconds, 720p-pixel-seconds}`; positive decimal price; enforces the
  **global** `BroadcastCfg.MaxPrice()` (no longer per-capability/model max — see test churn in 1f).
  (This is "option 1" from go-livepeer issue #3985 to unblock apps in remote discovery — confirmed by j0sh
  in PR comments.)

### 1e. ⭐ Signer `type=live` — the actual new "payment type" (time-based, not fixed-per-call)
`server/remote_signer.go` — `GenerateLivePayment()`:
- `const RemoteType_Live = "live"` (~L36) added next to `RemoteType_LiveVideoToVideo = "lv2v"`.
- `RemotePaymentState` gains a `Type` field (~L220); `RemotePaymentRequest.Type` doc now lists
  `live, lv2v` (~L245).
- **Type is locked per session**: if `state.Type != "" && state.Type != req.Type` → `job type mismatch`
  (400) (~L429). First payment stores `state.Type = req.Type`.
- Billing branch (~L531):
  ```go
  pixels := int64(0)
  billableUnits := int64(req.InPixels)
  if <lv2v ...> {
      pixels = int64(pixelsPerSec * billableSecs)   // pixel-based
      billableUnits = pixels
  } else if req.Type == RemoteType_Live {
      if billableSecs <= 0 { billableSecs = 10 }     // 10-second minimum on first tick
      billableUnits = int64(math.Ceil(billableSecs)) // <-- bills ELAPSED SECONDS
  } else if req.Type != "" { error "invalid job type" }
  fee := calculateFee(billableUnits, initialPrice)   // wei/second * seconds
  ```
- Test `TestGenerateLivePayment_LiveBillsElapsedSeconds` confirms: first tick bills the 10s minimum
  (`10s * 3 wei/s = 30 wei`), follow-up bills real elapsed (`12s * 3 wei/s = 36 wei`). So it is a
  **running per-session, per-second meter**, not a per-request flat fee and not a single per-session fee.

### 1f. Test churn worth noting
- Per-capability/model max-price filtering in remote discovery is **removed** in favor of a single global
  `BroadcastCfg.MaxPrice()` (`TestRemoteSigner_Discovery_FiltersRunnerDiscoveryPricing` rewritten).
- Runner wire prices in every test switch from `{price_per_unit,pixels_per_unit,unit:"WEI"}` to
  `{price, currency:"wei", unit:"seconds"|"720p-pixel-seconds"}`.

### 1g. Known open issue flagged in review (accounting not updated)
rickstaa flagged (PR comment) that `server/live_payment_processor.go` `processOne` still derives billable
amount from **pixels (720p@30fps)** regardless of the new price unit — j0sh confirmed "great catch, fix
incoming". **So even the elapsed-seconds path is not fully wired through the live payment processor yet.**
This is a draft PR.

---

## 2. Validating the user's model against the PR

| User's claim | Reality in #3992 | Accurate? |
|---|---|---|
| A `type=fixed` payment type is added | No `fixed` type. New type is `type=live` (elapsed-seconds). `unit=hour` is the closest "flat/pixel-agnostic" concept, but it's still time-metered. | ❌ |
| `price=0.001` ⇒ orch pays ~$0.001 **per request** | `price` is USD **per hour** (or per 720p-hour), prorated to elapsed seconds. Not per-request. | ❌ |
| Per-session configurable | Billing is a **running per-second meter within a session** (SequenceNumber/LastUpdate), 10s min on first tick. Not a single per-session flat charge, not per-request. No "per-session flat" mode. | ⚠️ partial |
| wei or USD? | Runner advertises **USD** (`currency` must be `usd`); converted to **wei** for the wire/settlement. Both, at different layers. | ✔ (clarified) |

---

## 3. Unit-coverage matrix (unit_kind → #3992 mechanism → covered? → gap)

Design's closed enum today: `unit_kind ∈ {megapixel, image, second, characters, call}` (+ `tokens` = B3
blocker). Mapping each to how it would price under (a) #3992's live-runner mechanisms and (b) the
execution-plan quantity design (PR4/PR5):

| unit_kind | Natural pricing basis | Covered by #3992? | Covered by design PR4/PR5 (qty)? | Gap / notes |
|---|---|---|---|---|
| **second** (video/lv2v) | per elapsed second | ✅ `type=live` (elapsed s) + `unit=hour`; `type=lv2v` = pixel/s | ✅ qty = requested_seconds | #3992 is the *proof* for this path |
| **megapixel/pixel** (image, lv2v) | per pixel | ✅ `unit=720p` → wei/pixel-second (streaming only) | ✅ qty = w×h×n / 2²⁰ | For **discrete** image gen, #3992's pixel-second is stream-shaped; discrete needs qty extractor |
| **image** (per-image, nano-banana) | flat per image, qty = n | ❌ not time-based; no per-image charge | ✅ qty = num_images, price fixed/image | **#3992 does NOT cover this** |
| **call** (tools) | flat per call, qty = 1 | ❌ #3992 meters seconds, not calls | ✅ qty = 1, price fixed/call | **#3992 does NOT cover this** |
| **characters** (TTS) | per character, qty = len(text) | ❌ | ✅ qty = len(text) | Covered by design, not #3992 |
| **tokens** (LLM, gemini-text) | per token, qty = input/output tokens | ❌ | ❌ (B3: enum omits `tokens`) | **Residual gap everywhere** |

**Key correction to the thesis:** "fixed" (quantity=1 per-call, or qty=n per-image) is **not** a new
payment type at all — it is just the ordinary per-unit-quantity mechanism with `quantity = 1` (call) or
`quantity = num_images` (image). #3992's `type=live` is an *orthogonal, time-based* thing and does **not**
supply that. So per-call + per-image remain squarely in PR4 (gateway quantity) + PR5 (signer stamp).

**Does #3992's "fixed" reduce the need for `billing_unit_kind`/`billing_unit_quantity`?**
- For **second** caps: partially — #3992 shows the signer can bill on a runner-declared decimal price and
  branch on a `type`. But the quantity is still needed to make image/tools/TTS/tokens reconcile.
- For **call/image**: no reduction. The compute question *is* simpler (qty trivially 1 or n), but you still
  need the fields on the event so pymthouse meters per-unit (PR5/PR6) and the signer can derive
  `fee = per_unit_price × qty` (PR8).
- For **pixel/second**: existing mechanism (and #3992's lv2v/720p path) applies.
- **Tokens**: residual, unaffected by #3992.

---

## 4. Consistency with our descriptor-as-single-source-of-truth + one-orch→many-runner model

What #3992 gets **right** for our design:

- **Runner advertises its own price.** The runner sets `price` (decimal USD) + `unit` in its heartbeat;
  the orch converts + advertises it on `/discovery`; the signer honors it. This is exactly the
  "runner configs its own pricing" goal (NETWORK-PRICING-ARCHITECTURE Part 0.5: descriptor `offering.price`
  authoritative; one-orch→many-runner: each runner ships its own price, orch aggregates, signer stamps).
- **Decimal USD on the wire.** `price` as `json.Number` (string) + `currency` mirrors our
  `display_usd`/`display_unit` intent — a strong precedent to make `offering.price.display_usd` the wire
  price the runner declares (not a hand-kept `price.json`).
- **A pricing discriminator on the price.** `unit ∈ {hour, 720p}` is a real precedent for a pricing
  *kind/type* field on the price segment — analogous to our `unit_kind`/`quantity_source` additive fields
  (PR1). #3992 = "flat vs per-pixel"; ours generalizes to `{megapixel, image, second, characters, call,
  tokens}`.
- **Signer branches fee on a `type` + locks it per session.** `type ∈ {lv2v, live}` with `job type
  mismatch` guard is the same shape PR5/PR8 need to branch `fee = per_unit × qty` by `billing_unit_kind`.

Where it does **not** yet fit (and must not be over-read):

- Its `type/unit` vocabulary is **live-video-specific** (`hour`, `720p`, `seconds`, `720p-pixel-seconds`,
  `type=live`). It is **not** a general unit_kind system and cannot represent image/call/characters/tokens.
- It removed **per-capability/model max price** filtering in remote discovery in favor of a **global**
  max — orthogonal to our per-cap pricing, but worth noting it narrows price policy granularity.
- The **live payment processor still bills pixels** (1g) — the elapsed-seconds path is not end-to-end.

Impact on execution-plan PRs:

- **PR3 (orch aggregation):** #3992 changes the *shape* of the runner price the orch reads from
  `/discovery` (`{price, currency:"wei", unit:"seconds"|"720p-pixel-seconds"}` instead of
  `{price_per_unit, pixels_per_unit}`). PR3's aggregator must parse the **new** decimal-`price` +
  `currency`/`unit` schema (and map `unit` → `pixels_per_unit`/`unit_kind`) when merging into
  `CapabilitiesPrices`. Do **not** code PR3 against the old `price_per_unit/pixels_per_unit` fields.
- **PR4 (gateway quantity):** unchanged in intent, and specifically **still required** for
  call/image/characters/tokens — #3992 gives you `second` for free but nothing else. The `type=live`
  vs `type=lv2v` request `type` is the same field the gateway sends; PR4/PR5 should extend the same `type`
  discriminator rather than invent a parallel one.
- **PR5 (signer stamp):** #3992 is a near-template — it already added a `Type` to `RemotePaymentState`
  and branches billing on it. PR5 should stamp `billing_unit_kind`/`billing_unit_quantity` on
  `create_signed_ticket` the same way, and PR8's `fee = per_unit × qty` mirrors the `calculateFee(
  billableUnits, initialPrice)` line. **Watch:** #3992 renamed the emitted log field `cost_per_pixel` →
  `cost` — PR5's event-schema/forbidden-field work must account for that rename.
- **B3 (tokens blocker):** **unchanged.** #3992 does nothing for tokens; the closed enum must still add
  `tokens` (and audit `track, clip, mesh, minute, training, audio_seconds`) before freezing.

---

## 5. Recommendation — how to fold #3992 into the design (keep it simple)

1. **Do not adopt `type=fixed` language — it does not exist.** Correct the design docs' framing: the
   live-runner contributes a **time/second** pricing path (`type=live`, `unit=hour|720p`), not a
   per-call/per-image fixed type. Per-call/per-image "fixed" is just `quantity = 1` / `quantity = n` under
   the existing per-unit mechanism — no new type needed.

2. **Reconcile the wire schema.** Adopt #3992's **decimal `price` + `currency` + `unit`** as the runner
   price on the wire, and make PR2/PR3 read that shape. Map:
   - live `unit=hour`  → `unit_kind = second` (flat/time), `pixels_per_unit = 1`.
   - live `unit=720p`  → `unit_kind = megapixel/pixel` (resolution-scaled).
   This keeps one vocabulary; the live-runner's `{hour,720p}` becomes a special case of `unit_kind`.

3. **Map unit_kinds to pricing "type" cleanly (two types, not a zoo):**
   - `per_unit` (quantity-metered): megapixel, image, second, characters, tokens — `fee = price × qty`.
   - `fixed` (quantity ≡ 1): call — a *degenerate* `per_unit` with qty=1, so it needs **no special code**.
   Treat "fixed" as `per_unit` with `quantity_source = const_1`, avoiding a parallel fee path.

4. **Keep the signer branching pattern from #3992** for PR5/PR8: a single `type`/`unit_kind` discriminator,
   state-locked per session (`job type mismatch` guard), `fee = per_unit_price × billing_unit_quantity`.
   Do not fork into a separate "fixed" signer path.

5. **Tokens is the real residual (B3).** #3992 does not help. Add `tokens` to the enum + PR4/PR8 extractors
   + §5 parity matrix, and audit the other live display units before freezing.

6. **Flag the two #3992-specific follow-ups** so our PRs don't inherit them: (a) the `live_payment_processor.go`
   pixel-based accounting bug (1g) is still open; (b) remote discovery moved to a **global** max price.

**Bottom line for the docs:** fold #3992 in as *evidence the architecture works for the `second` unit and
for runner-declared decimal USD pricing*, and as the *template for the signer's type-branched fee* — **not**
as a per-call/per-image "fixed" solution. Per-call and per-image stay on PR4/PR5 (quantity = 1 / n), and
`tokens` remains the one true gap (B3).
