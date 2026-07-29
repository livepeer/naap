# Testing the Live-Runner Fixed-Price Path WITHOUT Deploying a New/Upgraded Signer

**Mode:** Investigation only — read-only. No code / infra / deploy changes performed. `byoc-staging-1` untouched.
**Operator:** qiang@livepeer.org (gcloud `livepeer-simple-infra`, read-only); doc commit as `seanhanca`.
**Question:** Without deploying a new/upgraded (v0.9.0 / merged) signer to production, what are the concrete ways to test whether the live-runner **fixed-price** path on the v0.9.0 orch (`:8936`, `liverunner-v09-orch`) works — and is *"offchain only"* truly the only option?
**Evidence base:** go-livepeer `v0.9.0` source (tag `df527c37`, local checkout `golivepeer/glp-numtickets`), the `ja/live-runner` gateway source (`livepeer-python-gateway` `origin/ja/live-runner`), orch flags in `cmd/livepeer/starter/starter.go`, and prior probe reports ([`LR-V0.9.0-EXECUTION-REPORT.md`](./LR-V0.9.0-EXECUTION-REPORT.md), [`LR-SDK-ONLY-DEPLOY-VERIFICATION.md`](./LR-SDK-ONLY-DEPLOY-VERIFICATION.md), [`LR-AUTHOR-INPUTS-INVESTIGATION.md`](./LR-AUTHOR-INPUTS-INVESTIGATION.md)).

---

## TL;DR

- **YES, you can test the live-runner path without a new signer — but only the *generation* half.** The exact lever is the orch's **offchain registry**: when the live-runner registry is `offchain`, `PaymentInfo()` returns `nil`, and both the native single-shot path (`ProxyLiveRunnerSingleShot`) and the session path (`ReserveLiveRunnerSession`) **skip the 402 challenge entirely** and proxy straight to the runner — **no signer, no payment, no wallet**. The offchain flag is `-network=offchain` (which is also the go-livepeer default). This proves dispatch + discovery + runner generation, but **cannot** prove the paid `type=fixed` mint, on-chain payment, or metering.
- **A "zero-price runner that bypasses the 402" does NOT exist on an on-chain orch.** v0.9.0 rejects any non-positive price (`price_info.price must be a positive decimal`). The *only* way to get `priceInfo == nil` (the payment-skip branch) is the offchain registry. So "zero-price" ≡ "offchain," confirmed from source.
- **"Offchain only" is accurate for a *no-signer-at-all* test, but it is NOT the only way to prove the fixed path.** The paid `type=fixed` mint **can** be exercised with an **ephemeral / throwaway v0.9.0 (or merged) remote-signer** — pointed at by a *test* SDK `SIGNER_URL` — **without touching `signer.daydream.live` or the pymthouse DMZ signer**. That is the only route that also validates signing + on-chain payment + per-cap metering.
- **Recommended fastest high-confidence path:** stand up an **ephemeral v0.9.0 signer** (reusing the already-funded payer key `0x6cae3c7a…`) and drive the real NaaP/test SDK config against the existing on-chain `:8936` orch. This exercises the *exact* production code path (real `type=fixed` → `billableUnits=1` → `numTickets ~1` → orch `ProcessPayment` + `AccountPayment`) minus only the prod-signer deploy — it is the sole option that turns the current "walled at payment-mint" result green.

---

## Options table

| # | Option | What it needs | What it PROVES | What it CANNOT prove | Effort / Risk |
|---|--------|---------------|----------------|----------------------|---------------|
| 1 | **Direct-to-runner** (curl the runner app directly, bypass the orch) | The runner app URL + fal/backend creds. No orch, no signer. | Runner *generation* itself works (already shown: `blender-app /run` → HTTP 200). | Nothing about the orch, dispatch, discovery, pricing, payment, or the fixed path. | **Trivial / none.** Read-only HTTP. |
| 2 | **Direct-to-orch, on-chain `:8936`** (`POST /apps/{runner}/app/generate` with no payment header) | Just HTTP to `:8936`. No signer. | Dispatch reaches the orch; the **402 challenge** is correctly emitted with `payment_params`=`OrchestratorInfo` at the per-cap price (validates discovery + pricing + challenge). | Anything past the 402: no generation, no mint, no metering. **This is exactly where the wall is today.** | **Trivial / none.** Read-only; already done in prior probes. |
| 3 | **Offchain orch mode** (`-network=offchain` → registry `offchain=true` → `PaymentInfo()==nil` → challenge skipped, proxy directly) | Restart the `:8936` orch (or stand up a 2nd orch) with `-network=offchain`. **No signer, no wallet, no eth.** SDK call with `signer_url` unset. | Full **orch → runner dispatch + proxy** end-to-end and a **real generated asset through the orch** — the complete path *minus billing*. | Real ticket mint, on-chain payment, per-cap metering, and the `type=fixed` signer branch — **all skipped by definition when offchain.** | **Low–medium.** Requires an orch config/restart (mutates `:8936`) or a second orch → an infra change, though *no new signer*. Reversible. |
| 4 | **Ephemeral / throwaway fixed-capable signer** (v0.9.0 or merged binary, run locally / temp VM, pointed at by a *test* SDK `SIGNER_URL`) | A v0.9.0-class go-livepeer signer + **a payer wallet key + `-ethUrl` + a funded deposit/reserve** (reuse the already-funded `0x6cae3c7a…`). Drive against the existing on-chain `:8936`. | The **real paid `type=fixed` path**: signer mints `billableUnits=1` → `numTickets ~1`, orch `reservePaidLiveRunnerSession` accepts, `ProcessPayment` + `AccountPayment(units:1)` runs → **generation + metering**. | Nothing material — this is the production path. (Only caveat: a *fresh unfunded* signer key proves signing but not on-chain acceptance; reuse the funded payer to prove payment too.) | **Medium.** No prod-signer touch, but needs a wallet key + funded reserve. Highest confidence. |
| 5 | **Deploy new/upgraded prod signer** (out of scope) | Prod signer deploy. | Everything, in prod. | — | Out of scope for this question. |

---

## The exact offchain / payment-skip mechanism (source-grounded, v0.9.0 `df527c37`)

### 1. The flag

`cmd/livepeer/starter/starter.go:2043` builds the live-runner registry:

```go
n.LiveRunnerManager = runner.NewLiveRunnerRegistry(runner.LiveRunnerRegistryConfig{
    Host:             liveRunnerHost{RunnerHost: orch, LivepeerNode: n},
    Onchain:          *cfg.Network != "offchain",   // ← the single switch
    ProxyURLTemplate: *cfg.LiveRunnerProxyURL,
})
```

- `defaultNetwork := "offchain"` (`starter.go:209`) — offchain is the **default**; on-chain is opt-in via `-network=arbitrum-one-mainnet`.
- `NewLiveRunnerRegistry` sets `offchain: !config.Onchain` (`ai/runner/live_runner.go:327`). So `-network=offchain` (or omitting `-network`/eth flags) ⇒ `registry.offchain = true`.

### 2. The payment-skip branch (native single-shot AND session)

`server/ai_http.go` — both entry points gate on `PaymentInfo`:

```go
// ProxyLiveRunnerSingleShot (native /apps/{runner}/app/... path), ai_http.go:769
priceInfo, err := manager.PaymentInfo(runnerID)
...
if priceInfo == nil {
    sessionID, endpoint, err = manager.ReserveSession(runnerID)   // ← NO challenge, NO payment, straight to proxy
} else {
    sessionID, endpoint, reserved = h.reservePaidLiveRunnerSession(...)   // ← 402 challenge path
}
```

The identical `priceInfo == nil ? ReserveSession : reservePaidLiveRunnerSession` shape is in `ReserveLiveRunnerSession` (`ai_http.go:242`). So **the native `/apps/...` path is NOT payment-mandatory** — it is payment-mandatory *only when the orch is on-chain* (which makes `PaymentInfo` non-nil).

### 3. Why `PaymentInfo` is nil offchain (and never nil-via-zero-price on-chain)

`ai/runner/live_runner.go:1009 PaymentInfo()`:

```go
if runner.offchain {
    return nil, nil          // ← offchain ⇒ nil ⇒ payment skipped
}
priceInfo, err := runner.convertPrice()   // on-chain: always returns a price object
...
return &priceInfo, nil       // ← on-chain ⇒ non-nil ⇒ 402 challenge
```

And a **zero price cannot sneak past on-chain**: `priceRat()` (`live_runner.go:88`) rejects it — `price_info.price must be a positive decimal` (`rat.Sign() <= 0`). `normalizeLiveRunnerPriceInfo` and `normalizeHeartbeat` enforce this for every on-chain runner. Offchain, `normalizeHeartbeat` returns **before** price validation (`if r.offchain { return req, nil }`, `live_runner.go:891`), and `discoveryRunner()` drops the price from `/discovery` (`if !runner.offchain && … `, `:1718`).

**Conclusion for Q1 & Q2:** the offchain registry is the exact and only mechanism that bypasses the 402. There is no separate "free/zero-price runner" or `SkipPaymentCycle` orch flag that does this on an on-chain orch. (`SkipPaymentCycle` is a *gateway-side* HTTP-482 signal, not an orch payment bypass.)

### 4. SDK path works offchain with NO signer

`ja/live-runner` gateway `call_runner()` gates the entire mint on `if signer_url:`. Called with `signer_url` unset, it sends **no** `Livepeer-Payment` header and just posts to the runner endpoint — which an offchain orch answers with 200 (no 402). So an offchain orch can be exercised through the real SDK/gateway with **zero signer involvement**. (Against an on-chain orch, an unset `signer_url` just surfaces the 402 as an error — the wall in Option 2.)

### What offchain validates vs. does NOT

- **Validates:** SDK dispatch → orch → runner proxy, discovery resolution, runner generation of a real asset, the single-shot routing plumbing.
- **Does NOT validate:** the `type=fixed` signer branch, ticket mint (`numTickets`), on-chain `ProcessPayment`, and per-cap `AccountPayment` metering — all short-circuited when `priceInfo == nil`. Offchain also **drops price from `/discovery`**, so it doesn't even validate the priced-discovery display.

---

## Ephemeral fixed-capable signer — recipe outline (the only no-prod-deploy way to test the PAID mint)

**Goal:** exercise the real `type=fixed` mint against the existing on-chain `:8936` orch, without touching `signer.daydream.live` or the pymthouse DMZ signer.

**What a v0.9.0 remote-signer actually needs** (from `server/remote_signer.go`):

- `GenerateLivePayment` requires `LivepeerNode.Balances` **and** `LivepeerNode.Sender` (`remote_signer.go` — errors "missing balances or sender" otherwise). ⇒ the signer node is the **payer/broadcaster**: it needs a **wallet key (keystore) + `-ethUrl`** and a **funded TicketBroker deposit/reserve** to mint redeemable tickets.
- For `req.Type == RemoteType_Fixed`: `billableUnits = 1` → `fee = calculateFee(1, initialPrice)` → **`numTickets ~1`** (this is exactly what the deployed pre-`#3999` signers lack, which is why they blow the 100-ticket cap or return "invalid job type").

**Recipe:**

1. Run `livepeer/go-livepeer:v0.9.0` (or the merged `fixed`+`/sign-byoc-job` image) in **remote-signer mode** on a **local box or throwaway VM** — *not* on `signer-staging-1/2` and *not* on Railway.
2. Give it a **wallet with an existing funded reserve** — reuse the already-funded payer `0x6cae3c7a…` (deposit 0.109 ETH + reserve 0.290 ETH on Arbitrum One per the execution report) so no new irreversible spend is needed. (A fresh unfunded key would still *sign*, but the orch's `ProcessPayment` would reject on reserve — that proves signing only, not payment.)
3. Point a **test SDK config** (`SIGNER_URL` = the ephemeral signer; or a per-key validate that returns it) at it, with `LR_ORCH_DISCOVERY → :8936` and per-cap `LR_OFFERINGS_JSON` — the same wiring proven on the isolated instance in the execution report.
4. Drive one `flux-schnell` single-shot. Expected green chain: gateway derives `type=fixed` from `unit=fixed` → signer mints `numTickets ~1` → orch `reservePaidLiveRunnerSession` matches price + `PixelsPerUnit==1`, `ProcessPayment` OK, `AccountPayment(units:1)` → runner generates → asset returned + one per-cap debit.

**What it proves:** signing, the real on-chain `type=fixed` payment, and per-cap metering — the entire path that offchain cannot reach.
**What it can't:** if you deliberately use an unfunded key, only signing (not payment acceptance).

---

## Is "offchain only" the accurate summary?

**Partly.** Precise statement:

- For a **completely signer-free** test, **generation-only is the ceiling**, and there are three flavors of it: direct-to-runner (Option 1), direct-to-orch-402 (Option 2, walls at payment), and offchain-orch full-proxy generation (Option 3). Billing/metering **cannot** be tested with no signer at all.
- But **"offchain only" is NOT the only way to prove the fixed path works.** The paid `type=fixed` mint (the thing that is actually broken today on the deployed signers) can be proven with an **ephemeral / throwaway fixed-capable signer** (Option 4) that is explicitly **not** a prod deploy and leaves `signer.daydream.live`, the pymthouse DMZ signer, and `byoc-staging-1` untouched.

So the honest one-liner: **without a new prod signer, generation-only is the ceiling for a no-signer test — but the paid fixed mint is still testable pre-prod via an ephemeral signer.**

---

## Recommendation — fastest way to gain confidence

**Use the ephemeral v0.9.0 signer (Option 4), reusing the funded payer key, against the existing on-chain `:8936`.** Rationale:

- It exercises the **exact production code path** (`type=fixed` → `billableUnits=1` → orch accept + meter), which is precisely the step that is red today. Offchain (Option 3) can never turn that step green because it *removes* it.
- No prod-signer deploy, no `signer.daydream.live` change, no pymthouse-signer change, no `byoc-staging-1` touch — it satisfies the "no new prod signer" constraint while still proving billing.
- The SDK wiring is already proven (isolated-instance dispatch to `:8936` in the execution report); the only missing piece is a signer that implements `RemoteType_Fixed`, which the throwaway binary supplies.

**If the goal is only "does the orch dispatch + runner generate at all"** (not billing), then **Option 3 (offchain)** is the fastest zero-signer proof, and **Option 2** (the 402 probe) is the zero-touch confirmation that dispatch/discovery/pricing/challenge are already correct up to the payment wall.

---

## Evidence index (all read-only)

- **Offchain switch:** `cmd/livepeer/starter/starter.go:2045` (`Onchain: *cfg.Network != "offchain"`), `:209` (`defaultNetwork := "offchain"`); `ai/runner/live_runner.go:327` (`offchain: !config.Onchain`).
- **Payment-skip branch:** `server/ai_http.go:769` (`ProxyLiveRunnerSingleShot`, `priceInfo==nil → ReserveSession`), `:242` (`ReserveLiveRunnerSession`, same), `:263` (`reservePaidLiveRunnerSession` — 402 challenge + `fixedPayment` accept).
- **PaymentInfo / price rules:** `ai/runner/live_runner.go:1009` (`offchain → nil`), `:88` (`priceRat` — positive-only), `:100` (`normalizeLiveRunnerPriceInfo`), `:891` (`normalizeHeartbeat` offchain early-return), `:1718` (`discoveryRunner` drops price offchain).
- **Fixed signer branch:** `server/remote_signer.go:37` (`RemoteType_Fixed`), `GenerateLivePayment` (`billableUnits=1` for `fixed`; requires `Balances`+`Sender`; `numTickets>100` guard).
- **Gateway signer-gated payment:** `livepeer-python-gateway` `origin/ja/live-runner` `src/livepeer_gateway/live_runner.py` `call_runner` (`if signer_url:` gate; `type=fixed` from `unit=fixed`); `errors.py:70` (`SkipPaymentCycle` — gateway HTTP-482, not an orch bypass).
- **Prior probes:** `LR-V0.9.0-EXECUTION-REPORT.md` (402 challenge confirmed on `:8936`; funded payer `0x6cae3c7a…`; isolated-instance native dispatch), `LR-SDK-ONLY-DEPLOY-VERIFICATION.md` (deployed signers lack `RemoteType_Fixed`), `LR-AUTHOR-INPUTS-INVESTIGATION.md` (v0.9.0 fixed path is native, deploy-not-code).
