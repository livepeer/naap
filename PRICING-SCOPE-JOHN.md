# Per-Unit Billing — Minimal Scope for John (pymthouse)

**From:** Storyboard/NaaP agent team · **To:** John
**TL;DR:** You were right — for **billing**, pymthouse needs **nothing new**. Your existing fee meter + `eth_usd` bridge already invoice correctly *once the on-chain fee is right* (that's Josh's signer change). The only thing worth adding is a small, **optional, read-only** observe hook so we can prove the numbers line up before flipping — and even that can wait.

---

## Why this matters (one paragraph)

Before a generation the agent quotes the user a **USD price**, and that number must match what settles on-chain and what pymthouse invoices. Today it doesn't: the signer bills flat (wall-clock/floor), so image, video, and TTS all meter roughly the same ~1 µUSD blip. The fix lives **upstream in the signer** (Josh): make the on-chain fee equal `per_unit_price × quantity_consumed`. Under **Model A** (the on-chain event is the single source of truth), your side is already correct by construction — you bridge wei → USD with the `eth_usd` bridge you already have. So this doc is mostly about what you *don't* have to build.

---

## What we AGREE stays simple / gets dropped

- **Keep `network_fee_usd_micros` + `signed_ticket_count` exactly as they are — forever.** They are on-chain truth and the billing floor. Untouched.
- **The `eth_usd` bridge already works.** The reconciliation gap was **upstream** of the bridge (the signer billing flat), not in it. Nothing to fix here.
- **No new cost engine required.** The old plan's PR7 (`cost = qty × per_unit_usd`, then *enforce* `max(unitCostUsd, feeUsd)`) is **unnecessary**: once Josh's signer fee is correct per unit, `feeUsd` is already right, so `max(feeUsd, feeUsd) = feeUsd`. Enforcing a second computed cost just recreates a second source of truth — the exact thing Model A avoids. **Drop the enforce path.**
- **No rules engine, no per-cap/per-modality meter zoo.**

---

## What (optionally) helps — and why it's small

Everything below is **additive, read-only, and defaults to no-op.** None of it is required to bill correctly. It exists only to (a) give per-unit **reporting** and (b) let us **watch drift** before Josh flips the signer to enforce.

### 1. (Optional) Passthrough + one `usage_units` SUM meter
**When:** only if we want per-unit usage analytics ("how many MP / characters / tokens did this customer consume"), or as the observe harness for the rollout.

- **Do:** in the collector, map `unit_kind = billing_unit_kind ?: "unknown"` and `unit_quantity = billing_unit_quantity | 0`, then add **one** meter: `usage_units: SUM($.unit_quantity)` grouped by `unit_kind` / capability / model. Add both fields to the schema forbidden-field list (BPP hygiene).
- **Why safe:** the meter **reads 0** until the signer starts stamping, so it can deploy anytime, ahead of everything, with zero behavioral change. `network_fee_usd_micros` stays the billing meter.
- **Done when:** synthetic `create_signed_ticket` with the new fields → CloudEvent carries `unit_kind`/`unit_quantity` **and still** `network_fee_usd_micros`; a no-field event → `usage_units = 0`.

### 2. (Optional, recommended for the rollout) Observe-only reconciliation delta
**When:** during Josh's signer `observe → enforce` transition, so we don't flip blind.

- **Do:** logged-only, compute `unitCostUsd = unit_quantity × per_unit_usd` (`per_unit_usd = descriptor.offering.price.display_usd`) and emit a **delta metric** `|unitCostUsd − feeUsd|` per cap. **This never settles anything** — it's a dashboard/alert only.
- **Why:** it's the cheap safety check that proves `agent_quote == on-chain fee == metered` for a cap *before* Josh sets the signer to `enforce`. After that, `feeUsd` is authoritative and this metric just stays green.
- **Done when:** dashboards show `unitCostUsd` tracking `feeUsd` within tolerance for ≥1 cap per variable unit (megapixel / characters / tokens). No enforce step — settlement stays on the existing fee meter.

> Both items are **flag-free no-ops** until the signer emits the fields. If you'd rather ship nothing until Josh's change lands and reporting is actually requested, that's a legitimate call — billing correctness does **not** depend on either one.

---

## Bottom line
- **Required of pymthouse for correct billing: nothing.** Keep the fee meter + `eth_usd` bridge; they're already right once the signer fee is right.
- **Optional (do when useful):** one additive `usage_units` SUM meter for per-unit reporting, plus a read-only reconciliation delta metric to de-risk Josh's enforce flip.
- **Explicitly dropped:** the PR7 cost-enforce / `max(unitCostUsd, feeUsd)` path, and any new billing meter. No second source of truth.
