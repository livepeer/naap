# OpenMeter Metering Fix Spec — for John

**Scope:** Two defects in the `create_signed_ticket` → OpenMeter seam, observed in Runs 32/50/53/54.
**Repos:** `go-livepeer` (remote signer, emits to Kafka) and `pymthouse` (OpenMeter collector + meter defs + retail billing).
**Verification targets:** ltx-i2v 6.12s must meter ≈ **$0.257** (257,000 µUSD), not $0.000001; an orch-rejected payment must meter **$0**.

---

## TL;DR — what John changes

| Gap | Repo | File | Change |
|----|----|----|----|
| **1 — unit-blind fee / µUSD floor** | pymthouse | `deploy/openmeter-collector/collector.yaml:139-143` | Remove the `.ceil()`-to-whole-µUSD floor; carry fee at sub-µUSD precision (pico-USD). |
| **1 — unit-blind fee** | pymthouse | `docker/openmeter/config.yaml:40-50`, `src/lib/openmeter/konnect-catalog.ts:29-58` | Repoint the fee meter's `valueProperty` to the new higher-precision field; keep `SUM`. |
| **1 — unit-aware retail (recommended)** | go-livepeer | `glp-combine/server/remote_signer.go:855-877` | Emit a canonical **unit count + unit kind** (video-secs / megapixels / TTS-chars / tokens) so pymthouse can price `units × retail_rate`. |
| **2 — meter-on-attempt** | go-livepeer | `glp-combine/server/remote_signer.go:848-878` | Move / gate the `create_signed_ticket` emit so it fires **only after orch accepts the job**, or emit a compensating reversal on failure. |

---

## Data flow (verified, with citations)

1. **Signer emits (payment-generation):** `go-livepeer` `GenerateLivePayment` builds the fee and fires a fire-and-forget Kafka event:
   - `glp-combine/server/remote_signer.go:855-877` — `monitor.SendQueueEventAsync("create_signed_ticket", {...})`
   - Payload includes: `computed_fee` (= `fee.FloatString(0)`, integer **wei**, line 872), `pixels` (line 870), `cost_per_pixel` (`orchPrice.FloatString(10)`, line 873), `billable_secs` (869), `num_tickets`, `pipeline`, `model_id`, `auth_id`.
   - `fee` is `calculateFee(pixels, initialPrice)` = `(PricePerUnit / PixelsPerUnit) × pixels` (`glp-combine/server/live_payment.go:339-342`). For BYOC jobs `pixels = ceil(billableSecs)` (`remote_signer.go:700`); for lv2v `pixels = pixelsPerSec × billableSecs` (`remote_signer.go:707-708`).

2. **Collector transforms wei → µUSD:** `pymthouse` Benthos collector:
   - `deploy/openmeter-collector/collector.yaml:142-143`:
     ```
     let fee_wei = $data.computed_fee.number().or(0)
     let fee_usd_micros = ($fee_wei * $eth_usd / 1000000000000).ceil()
     ```
   - Emits CloudEvent field `network_fee_usd_micros = fee_usd_micros` (line 160) plus pass-through `pixels` (163) and `fee_wei` (164) as **opaque strings that are never used for pricing**.

3. **Meter aggregates:** OpenMeter meter `network_fee_usd_micros`, `aggregation: SUM`, `valueProperty: $.network_fee_usd_micros`:
   - `docker/openmeter/config.yaml:40-50`
   - Konnect equivalent: `src/lib/openmeter/konnect-catalog.ts:29-44` (`value_property: "$.network_fee_usd_micros"`, `aggregation: "sum"`).

4. **Retail billing = markup multiplier on the meter:** retail charge is derived by *multiplying* the metered network micros by a per-capability markup rate — it does **not** re-derive units:
   - `src/lib/billing/retail-usage.ts:92-104` → `applyRetailRateToNetworkMicros(networkFeeUsdMicros, rate)`
   - `node_modules/@pymthouse/builder-sdk/dist/plan-pricing.js:83-94` → `micros × round((retailRate / 1e-6) × 1e6) / 1e6`.
   - **Consequence:** every downstream retail number is anchored to `network_fee_usd_micros`. If that base is a floored constant, retail is garbage no matter the markup.

---

## GAP 1 — unit-blind fee / 1-µUSD floor

### Root cause (precise)

For a **discrete one-shot generation** (ltx-i2v, image, TTS, LLM) there is essentially **one** payment → one `create_signed_ticket` event. The per-request **wholesale** fee (`computed_fee`, the price-based orchestrator debit in wei) is **sub-µUSD**:

- Observed metered value = 1 µUSD after `.ceil()`. Working backwards through `collector.yaml:143`:
  `fee_wei × eth_usd / 1e12 < 1` ⇒ at ETH≈$3,000, `fee_wei < ~3.3e8 wei ≈ $0.000001`.
- So the signer is emitting a **wholesale per-request fee of ≈ $0.000001**, and the collector's **`.ceil()` clamps it up to the 1-µUSD floor** (`collector.yaml:143`, comment lines 140-141 admit this: *"Ceil so sub-micro live-runner fees still count as at least 1 micro"*).

Two independent failures stack:

1. **Precision floor (pymthouse):** µUSD is too coarse to represent a sub-cent wholesale fee; `.ceil()` turns every tiny fee into a flat **1 µUSD/request**. This is the literal "unit-blind flat floor."
2. **No retail unit price in the pipeline (architecture):** the advertised retail price ($0.257 for ltx-i2v 6.12s) lives only in pymthouse's plan catalog (`planCapabilityBundles.retailRateUsd`, consumed in `retail-usage.ts:42-56`) and is applied as a **markup multiplier** on the floored base (`retail-usage.ts:98-103`). The signer's emitted `pixels` is **compute-seconds** (BYOC, `remote_signer.go:700`) or **synthetic lv2v pixels** (`remote_signer.go:707-708`) — **not** the true retail unit (video-secs / megapixels / chars / tokens). Nothing in the event carries the advertised per-unit retail price, so units × rate can never be computed.

**Answering the specific questions:**

1. **What does the signer emit today?** `fee_wei` (`computed_fee`) **and** a unit-ish count (`pixels`) **and** a per-unit wholesale price (`cost_per_pixel`) **and** `billable_secs`. But: `pixels` is compute-seconds / synthetic pixels (not the retail unit), and the collector ignores `pixels`/`cost_per_pixel` and prices **only** off `computed_fee`.
2. **Where is the rounding/floor?** In the **collector transform** `collector.yaml:143` (`.ceil()` to whole µUSD). The meter (`config.yaml:44`, `SUM` over `$.network_fee_usd_micros`) faithfully sums the already-floored integers — the meter def is not itself the floor.
3. **Which lever?** Both a **collector precision change** (stop rounding to µUSD floor) and, for true unit-aware retail, a **signer emit change** (real unit count + kind). Changing only the meter `valueProperty` is not enough on its own.

### Exact fix

#### Fix 1A — remove the µUSD floor (pymthouse collector; required, minimal)

Carry the fee at **pico-USD** (1 USD = 1e12 pico-USD) so sub-cent wholesale fees survive `SUM` without a 1-µUSD clamp. Replace `collector.yaml:139-143`:

```yaml
        # fee_wei * eth_usd / 1e18 = USD; * 1e12 = pico-USD (no floor, no ceil).
        let fee_wei = $data.computed_fee.number().or(0)
        let fee_usd_pico = ($fee_wei * $eth_usd / 1000000).round()
```

Emit the new field in the CloudEvent data (`collector.yaml:155-169`), keeping the old µUSD field for backward compatibility during cutover:

```yaml
              "network_fee_usd_pico": $fee_usd_pico,
              "network_fee_usd_micros": ($fee_usd_pico / 1000000).round(),  # legacy, no ceil
```

> Note: `1e6` divisor above = `1e18 (wei→ETH) / 1e12 (USD→pico)`. This preserves magnitude with 12-decimal USD precision and removes the `.ceil()` floor entirely.

#### Fix 1B — repoint the meter to the precise field (pymthouse)

`docker/openmeter/config.yaml:40-50` — change the fee meter's `valueProperty` (keep `SUM`):

```yaml
  - slug: network_fee_usd_pico
    description: Livepeer signed-ticket network fee (USD pico)
    eventType: create_signed_ticket
    aggregation: SUM
    valueProperty: $.network_fee_usd_pico
    groupBy: { client_id: $.client_id, external_user_id: $.external_user_id, pipeline: $.pipeline, model_id: $.model_id }
```

Mirror in Konnect def `src/lib/openmeter/konnect-catalog.ts:29-44` (`key`, `value_property: "$.network_fee_usd_pico"`). Downstream reads (`signed-ticket-events.ts:287`, `retail-usage.ts`, builder-sdk `NETWORK_USD_PER_MICRO`) then divide by 1e12 instead of 1e6.

#### Fix 1C — make it unit-aware retail (recommended; go-livepeer + pymthouse)

Fix 1A/1B recover the *true wholesale* fee (≈$0.000001), which is **correct for a "network fee" meter** but is still **not** the advertised **$0.257 retail**. To meter retail, price `units × retail_rate`:

- **go-livepeer** `remote_signer.go:855-877` — add the real billable unit to the emitted event:
  ```go
  "billing_units":      billableUnits,   // e.g. video seconds, megapixels, chars, tokens
  "billing_unit_kind":  unitKind,        // "video_sec" | "megapixel" | "tts_char" | "llm_token"
  ```
  (Derive from `req`/capability alongside `resolveUsageLabels`; do **not** overload `pixels`.)
- **pymthouse** — price retail from the catalog per-unit rate keyed by `(pipeline, model_id, billing_unit_kind)` instead of the markup-on-network-micros model in `retail-usage.ts:92-104`. This is a **product decision** (does "network fee meter" mean wholesale EV or advertised retail?) — John/metering owns the call. If retail == advertised, this is the only path that yields $0.257.

**Owner:** pymthouse/metering (1A, 1B). go-livepeer signer + pymthouse billing (1C).

---

## GAP 2 — metering fires on payment-generation, not on orch success

### Root cause (precise)

The `create_signed_ticket` event is emitted **inside the signer's `GenerateLivePayment`**, unconditionally after the state is signed and **before** the payment is ever forwarded to or accepted by the orchestrator:

- `glp-combine/server/remote_signer.go:848-878` — emit is guarded only by `if monitor.Enabled`, immediately after `signState(...)` (line 839) and before the handler returns the payment (line 881-888).
- The payment is forwarded to the orchestrator **later, by the gateway**, in `remotePaymentSender.SendPayment` — and only there is orch acceptance known: `glp-combine/server/live_payment.go:316-319` (`resp.StatusCode != http.StatusOK` ⇒ rejected).

So a payment the orchestrator later rejects (Run 50: +4 µUSD, no image) is already metered. Metering is decoupled from job outcome.

**Answering the specific questions:**

1. **Where is it published?** Signer payment-gen path (`remote_signer.go:855`), not an orch-success callback. There is **no** success-gated emit anywhere.
2. **Fix:** gate/relocate the emit to fire on confirmed orch success, or emit a compensating reversal on failure.

### Exact fix (choose one)

- **Fix 2A — emit on orch success (preferred):** delete the emit from `remote_signer.go:848-878` and return the metering payload fields on `RemotePaymentResponse` (`remote_signer.go:269-273`). Have the gateway emit `create_signed_ticket` **only** in the success branch after the orch returns 200: `live_payment.go:315-319` (emit right after the `StatusOK` check passes, before/after `updateSession`). This bills exactly the accepted jobs.

- **Fix 2B — compensating reversal (smaller diff, keeps signer emit):** keep the emit at `remote_signer.go:855`, but when the gateway sees a non-200 from the orch (`live_payment.go:316-319`), emit a second `create_signed_ticket`-family event with negated `computed_fee` / `network_fee_usd_pico` (a "void" event carrying the same `request_id`/`auth_id`) so the `SUM` meter nets to 0 for rejected payments. Requires the meter/consumer to accept negative values.

**Recommendation:** 2A (emit-on-success) — cleaner, no negative-value semantics, and it also fixes any double-count on session refresh/retry.

**Owner:** go-livepeer signer + gateway (`remote_signer.go`, `live_payment.go`).

---

## Verification after fix

1. **Gap 1:** run ltx-i2v 6.12s. Expected metered fee ≈ **$0.257** (257,000 µUSD / 2.57e11 pico-USD) — under Fix 1C (unit×retail). Under Fix 1A/1B alone the meter shows the true **wholesale** fee at full precision (no 1-µUSD floor); confirm it is no longer a flat 1 µUSD/request and scales with `billable_secs`.
2. **Gap 2:** force an orch rejection (Run-50 scenario). Expected metered fee for that request = **$0** (no event under 2A, or net-zero under 2B). Confirm the app is not billed for a payment with no delivered image.
3. Confirm `network_fee_usd_micros` (legacy) and `network_fee_usd_pico` (new) agree within rounding for a normal request during cutover.

---

## Notes
- The signer already emits `pixels`, `cost_per_pixel`, `billable_secs`, `fee_wei` — the collector just discards them for pricing. Any unit-aware fix should consume these (or a new explicit unit field), not re-derive from the floored µUSD.
- `retailRateUsd` is currently a **markup multiplier on network micros** (builder-sdk `applyRetailRateToNetworkMicros`), not a per-unit price. True unit-aware retail (Fix 1C) requires changing that model — flag for product sign-off.
