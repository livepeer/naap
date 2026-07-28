# liverunner-staging-1 — onchain/offchain re-verification + go-livepeer v0.9.0 assessment

> Date: 2026-07-28 · Author: seanhanca (agent, read-only for code)
> Scope: (1) DEFINITIVELY re-verify whether `liverunner-staging-1` is onchain or offchain right now;
> (2) assess whether deploying `livepeer/go-livepeer:v0.9.0` gets the Live-Runner (LR) orch to
> byoc-parity (onchain + priced + working e2e), and enumerate the concrete gaps.
> Method: all deploy configs in `simple-infra` + `simple-infra-yolo-fix`, the v0.9.0 git tag
> (`df527c3`) code, and a **live read-only `/discovery` probe** of the running orch.

---

## 0. TL;DR (read this first)

1. **`liverunner-staging-1` is ONCHAIN right now.** Empirical proof: its live `/discovery` advertises a
   **non-nil `price_info` (100 wei)** for every runner. The LR code path emits `price_info` in
   `/discovery` **only when the orch is not offchain** (`live_runner.go` `discoveryRunner()`:
   `if !runner.offchain && priceInfo != (LiveRunnerPriceInfo{})`). Price present ⇒ not offchain ⇒ onchain.

2. **The prior "offchain" claim was STALE / config-only, and is now corrected.** It was inferred from
   the committed `simple-infra/live-runner/docker-compose.yml:29` (`-network=offchain`) **without VM
   access and without ever actually probing `/discovery`** (the E2E doc only *predicted* price would be
   "absent while offchain" — it never ran the curl). The committed compose does **not** reflect the
   running VM. The onchain deployment pattern (arbitrum + keystore + `-pricePerUnit=100` +
   `-useLiveRunners`) is what is actually live, matching the user's recollection.

3. **Deploying `livepeer/go-livepeer:v0.9.0` does NOT, by itself, give LR "fully working e2e like byoc"**
   on the path NaaP tested. v0.9.0 **does** contain the LR pricing stack (new price schema,
   `runnerOrchInfo` bridge, signer `type=live`, USD→wei converter) — this **corrects** the E2E doc's
   claim that these live only in a draft. **But** v0.9.0's `GetCapabilitiesPrices` **still does not read
   the LR registry** (the **G1 gap persists in v0.9.0**), so the gRPC `OrchestratorInfo.capabilities_prices[]`
   that the byoc-style signer path reads stays **empty for LR caps**. v0.9.0 enables the **LR-native**
   session-payment path (time-metered seconds / 720p-pixel-seconds), which is a **different billing
   basis than byoc's per-cap discrete USD** — not per-cap parity.

---

## Job 1 — Onchain vs offchain: DEFINITIVE VERDICT = **ONCHAIN**

### 1.1 Live empirical evidence (the decisive proof)

Read-only probe (now):

```
$ curl -sk https://liverunner-staging-1.daydream.monster:8935/discovery
[{"address":"https://liverunner-staging-1.daydream.monster:8935","runners":[
  {"app":"storyboard/hyperframes-app","mode":"persistent","capacity":2,...,
   "price_info":{"price_per_unit":100,"pixels_per_unit":1,"unit":"WEI"}},
  {"app":"storyboard/fal-app","mode":"single-shot","capacity":4,...,
   "price_info":{"price_per_unit":100,"pixels_per_unit":1,"unit":"WEI"}},
  {"app":"storyboard/blender-app",...,"price_info":{"price_per_unit":100,"pixels_per_unit":1,"unit":"WEI"}},
  {"app":"storyboard/ffmpeg-app",...,"price_info":{"price_per_unit":100,"pixels_per_unit":1,"unit":"WEI"}}
]}]
```

Every runner shows a **non-nil `price_info` = 100 wei**.

### 1.2 Why price-present ⇒ onchain (code-grounded)

The LR discovery serializer drops price for offchain orchs. From `ai/runner/live_runner.go`
(verified in both v0.9.0 `df527c3` and the current `glp-combine` checkout — same logic, different line #s):

```go
func (runner *liveRunner) discoveryRunner() LiveRunnerDiscoveryRunner {
    ...
    var discoveryPriceInfo *LiveRunnerPriceInfo
    if !runner.offchain && priceInfo != (LiveRunnerPriceInfo{}) {   // price ONLY when NOT offchain
        discoveryPriceInfo = &priceInfo
    }
    return LiveRunnerDiscoveryRunner{ ..., PriceInfo: discoveryPriceInfo }
}
```

Supporting gates (all point the same way):
- `normalizeHeartbeat()` returns early **without requiring price** when `r.offchain`, and **requires a
  positive `price_info`** when `!r.offchain`. The runners are posting a positive price and it survives
  to `/discovery` — both only possible when onchain.
- `PaymentInfo()` returns `nil` when `runner.offchain`.
- `r.offchain = !config.Onchain`, and `Onchain = (*cfg.Network != "offchain")` (starter). So
  `offchain` tracks the orch's `-network` flag directly.

Notably, **the prior E2E author read this same gate** (cited it as `live_runner.go:1590`,
"discoveryRunner drops PriceInfo while offchain") and **predicted `/discovery` would show price
absent while offchain**. The probe shows price **present** — so by the E2E author's own logic, the
orch is onchain.

### 1.3 Config reconciliation (why the prior "offchain" read was wrong for *now*)

| Source | Says | Reflects the running VM? |
|---|---|---|
| `simple-infra/live-runner/docker-compose.yml:29` | `-network=offchain`, image `@sha256:3b3b8e55…` | ❌ **STALE** — the PR-1 offchain bring-up artifact. Header even says "Offchain now; on-chain lands in a later PR." |
| `simple-infra-yolo-fix/live-runner/docker-compose.yml:29` | `-network=offchain` | ❌ same stale standalone artifact |
| `simple-infra/pulumi/__main__.py:173,180` + `Pulumi.staging.yaml:15-16` | `-network=arbitrum-one-mainnet`, `-pricePerUnit=100`, `-useLiveRunners`, `orchImage: livepeer/go-livepeer:ja-live-runner`, keystore mount `/root/.lpData/arbitrum-one-mainnet/keystore` | ✅ the **onchain** pattern; matches the observed 100-wei price and onchain `/discovery` |
| `simple-infra-yolo-fix/pulumi/__main__.py:173,180,357` + `Pulumi.staging.yaml:15-16` | identical onchain orch template with `-useLiveRunners` appended | ✅ same |

- The onchain orch template uses the **same wallet mechanism as byoc** (`-ethOrchAddr=${ETH_ORCH_ADDR}`,
  `-ethUrl`, `-ethPassword`, keystore mounted at the arbitrum keystore path) and the **same
  `-pricePerUnit=100`** — consistent with the user's "same wallet config as byoc." (The literal wallet
  *address* is a Pulumi secret `ETH_ORCH_ADDR`; the *mechanism/pattern* is confirmed identical. The
  shared recipient `0x180859c337d1…` seen in the E2E is the **NaaP signer** recipient, not proof of the
  orch's own on-chain address.)
- `liverunner-staging-1` is **not** in the pulumi `fleet.yaml` orchestrator list (only
  `orch-staging-1/2/3`); it is a **standalone VM**. So its running config was set on the box
  (out-of-band relative to the committed standalone compose) to the onchain pattern above. That
  out-of-band change is exactly why a config-only read of the committed compose was misleading.

### 1.4 Reconciling the E2E's "PriceInfo 0/1, capsPrices=0"

Two independent reasons this is **not** in conflict with "onchain now":
1. **Timing.** The E2E run (Jul 28 ~11:13) observed offchain-consistent base `PriceInfo 0/1`. The
   onchain bring-up most plausibly happened **after** that run and **before** this probe. The E2E's
   conclusion was defensible *at its timestamp*; it is now superseded.
2. **The capsPrices=0 finding is TRUE even when onchain** — it is the **G1 gap**, independent of
   network. `GetCapabilitiesPrices` never reads the LR registry (see §2.3), so LR fal caps
   (flux-schnell, flux-dev, …) are absent from `capabilities_prices[]` regardless of onchain/offchain.
   The E2E drove LR through the **byoc gRPC path**, which reads exactly that empty list → HTTP 400
   "missing or zero priceInfo." That is a **wrong-path / G1** failure, not proof of offchain.

### 1.5 100%-certainty confirmation (VM command — optional)

VM SSH was **not** available to this agent (`gcloud` reauth required, non-interactive). The
code-grounded `/discovery` verdict stands on its own, but to make it byte-certain, run:

```bash
gcloud compute ssh liverunner-staging-1 --zone us-west1-b \
  --command "sudo docker inspect liverunner-orch --format '{{.Args}}'"
# Expect: -network=arbitrum-one-mainnet (NOT -network=offchain)
```

**Verdict: `liverunner-staging-1` is ONCHAIN.** The earlier "offchain" statement was a stale,
config-file-only inference (no VM, no live probe) and is corrected here with a live empirical probe
+ the code gate that ties price-in-`/discovery` to onchain.

---

## Job 2 — Does deploying `livepeer/go-livepeer:v0.9.0` get LR to byoc-parity?

### 2.1 The deployed image is NOT v0.9.0

| | Deployed (now) | v0.9.0 |
|---|---|---|
| Image digest | `sha256:3b3b8e55…` (compose) / tag `ja-live-runner` (pulumi) | `sha256:27464aa2…` |
| `/discovery` price schema | **old** `{price_per_unit,pixels_per_unit,unit:"WEI"}` (observed) | **new** `{price,currency,unit}` |
| Git era | pre-v0.9.0 (old `LiveRunnerPriceInfo` int64 schema) | tag `df527c3`, VERSION `0.9.0` |

The observed old-schema `/discovery` payload proves the running image predates v0.9.0's price-schema
change. So "rebuild" here = **deploy the already-published `livepeer/go-livepeer:v0.9.0`** (no source
build needed); confirmed the image + digest exist.

### 2.2 What v0.9.0 CONTAINS for LR pricing (corrects the E2E doc)

Verified directly against tag `df527c3`:

| Feature | In v0.9.0? | Evidence |
|---|---|---|
| #3938 "Live Runner" foundation | ✅ | release changelog (`v0.8.11...v0.9.0`), by j0sh |
| New runner price schema `Price json.Number` / `currency` / `unit` | ✅ | `ai/runner/live_runner.go:82` |
| `runnerOrchInfo()` bridge (runner price → `OrchestratorInfo{PriceInfo,TicketParams,Address}`) | ✅ | `server/ai_http.go:490` (called at :400) |
| `normalizeLiveRunnerPriceInfo`, `newConverterForRunner`, `720p-pixel-seconds` | ✅ | grep of `live_runner.go`, `ai_http.go`, `remote_discovery.go` |
| Signer `type=live` (elapsed-seconds metering, 10s min) | ✅ | `server/remote_signer.go:35` `RemoteType_Live="live"`, billing branch :486-490 |
| `SessionPriceInfo` + `"fixed"` unit for single-shot | ✅ | `server/ai_http.go` `PaymentForLiveRunnerSession` |
| **`GetCapabilitiesPrices` reads the LR registry (G1 fix)** | ❌ **NO** | `core/orchestrator.go:266` (see §2.3) |
| #3993 overhead (adv×1.01) in server pricing | ❌ not evident in v0.9.0 server code | grep found only unrelated "overhead" comments |

> **Correction to `E2E-RUN-JUL28.html §6`:** it states the `runnerOrchInfo` bridge / `type=live` are
> "not on any fetched branch and not on the deployed image (draft `ja/live-pricing`)." That is
> **incorrect for v0.9.0** — the merged `#3938` (and the folded-in `#3992` content) puts all of that
> **in the v0.9.0 tag**. What remains truly absent in v0.9.0 is only the **G1** LR→`capabilities_prices`
> aggregation.

### 2.3 The G1 gap is REAL and PRESENT in v0.9.0

`core/orchestrator.go:266 GetCapabilitiesPrices()` builds `capabilities_prices[]` from **exactly two
sources**:
1. `orch.node.GetCapsPrices("default"|gateway)` → built-in AI **`modelPrices`** (configured caps).
2. BYOC `orch.node.ExternalCapabilities` → `Capability_BYOC` per-name prices.

It contains **no reference to the LiveRunner registry**. Therefore the gRPC `OrchestratorInfo.
capabilities_prices[]` is empty for LR-served caps **even on v0.9.0, even onchain**. Any client that
drives LR through the **byoc-style gRPC path** (as the E2E did: `submit_byoc_job` +
`/generate-live-payment` reading `capabilities_prices`) will keep seeing zero for LR caps.

### 2.4 So: does deploying v0.9.0 give "fully working e2e like byoc"?

**No — not as byoc-parity, and not on the path the E2E used.** Nuance:

- **LR-native path (correct path):** deploy v0.9.0 + keep onchain + have runners post decimal-USD
  prices → the orch will advertise non-zero price via `/discovery`, build a priced `OrchestratorInfo`
  via `runnerOrchInfo`, and settle via `PaymentForLiveRunnerSession` with signer `type=live`. This is a
  **working, non-zero-priced LR path** — but it is **time-metered (seconds / 720p-pixel-seconds)**, the
  right shape for live/streaming, **not** byoc's discrete per-cap/per-image USD.
- **byoc-style path (what NaaP tested):** v0.9.0 does **not** populate LR into `capabilities_prices`
  (G1), so this path stays broken for LR. NaaP's LR integration is already moving to the native path
  (`simple-infra-yolo-fix/sdk-service-build/app.py` uses `LR_ORCH_DISCOVERY`; gateway pinned to
  `jm/live-runner-session-payments`), which is the correct direction.

**Bottom line:** v0.9.0 **closes the "LR advertises a non-zero price" gap on the LR-native path**, but
it does **not** deliver byoc-style per-cap USD pricing for LR (G1 unfixed) and does not by itself make
the byoc gRPC path work for LR.

### 2.5 Concrete gap list (to reach "fully working e2e like byoc")

| # | Gap | Config or code? | In v0.9.0? | Owner | Step |
|---|---|---|---|---|---|
| A | Running image is old `ja-live-runner`, not v0.9.0 | **Config** (swap tag/digest) | code present in v0.9.0 | infra (John) | Re-pin `orchImage`/compose to `livepeer/go-livepeer:v0.9.0` (`sha256:27464aa2…`), redeploy |
| B | Onchain network/wallet/reserve | **Config — already DONE** | n/a | infra (John) | Already onchain (arbitrum + keystore + `-pricePerUnit`). Update the committed standalone compose so it stops saying `-network=offchain` (docs drift only) |
| C | Per-cap price granularity | **Code/design** | ❌ (runner posts ONE price per runner/app; `fal-app` serves 8 caps by `model_id` → cannot differentiate per cap) | go-livepeer (rickstaa/j0sh) + storyboard descriptor | Per-cap runner pricing (descriptor-declared price per offering), or one runner per cap |
| D | G1 — LR prices absent from `capabilities_prices[]` | **Code (not in v0.9.0)** | ❌ | go-livepeer (rickstaa/j0sh) | Only needed if byoc gRPC-path parity is required; otherwise use LR-native path and this is N/A |
| E | Signer `type=live` on the **billed** signer | **Code + deploy** | code in v0.9.0, but the pymthouse **DMZ** signer must run it and the gateway must send `type=live` | John (pymthouse signer) + gateway | Re-image billed signer to v0.9.0-class; gateway sends `type=live` (native session payments) not `type=byoc/lv2v` |
| F | Per-unit USD metering (OpenMeter) | **Code (separate downstream)** | independent of v0.9.0 | John / pymthouse metering | Carry `unit_kind`/quantity onto the USD seam; today flat ~1 µUSD floor for every cap |
| G | `live_payment_processor` accounting (historic #3992 review flag: derives amount from pixels regardless of unit) | **Code — verify in v0.9.0** | unverified (function present; not audited line-by-line here) | go-livepeer (j0sh) | Confirm elapsed-seconds path is wired end-to-end for `type=live` |

**Net:** the *only* thing v0.9.0 flips from "no" to "yes" for free is a **non-zero, priced LR-native
payment path**. Everything that makes it "like byoc" (per-cap discrete USD, capabilities_prices for LR,
per-unit metering) is **not** delivered by v0.9.0 alone and stays owned by go-livepeer (C/D/G) and
pymthouse/John (E/F).

---

## Appendix — evidence index

- Live probe: `curl -sk https://liverunner-staging-1.daydream.monster:8935/discovery` → 4 runners, each
  `price_info:{price_per_unit:100,pixels_per_unit:1,unit:"WEI"}`.
- Code gate: `ai/runner/live_runner.go` `discoveryRunner()` `if !runner.offchain && priceInfo != …`;
  `normalizeHeartbeat()` (offchain skips price req; onchain requires positive price); `PaymentInfo()`
  nil when offchain.
- Onchain deploy: `simple-infra{,-yolo-fix}/pulumi/__main__.py:173` (`-network=arbitrum-one-mainnet`),
  `:180` (`-pricePerUnit=100`), `:357` (`-useLiveRunners`), keystore mount `:187`;
  `Pulumi.staging.yaml:15-16` (`orchImage: ja-live-runner`, `orchUseLiveRunners: "true"`).
- Stale offchain artifact: `simple-infra{,-yolo-fix}/live-runner/docker-compose.yml:29` `-network=offchain`.
- v0.9.0 tag `df527c3` (VERSION 0.9.0): `ai/runner/live_runner.go:82` (new schema),
  `server/ai_http.go:490` (`runnerOrchInfo`), `server/remote_signer.go:35` (`RemoteType_Live`),
  `core/orchestrator.go:266` (`GetCapabilitiesPrices` — no LR registry → **G1 persists**).
- v0.9.0 changelog: `v0.8.11...v0.9.0`, includes `#3938` Live Runner (j0sh).
- Image identity: deployed `sha256:3b3b8e55…` ≠ v0.9.0 `sha256:27464aa2…`.
