# LR v0.9.0 Gap-Closure Plan — clean, BYOC-free, one-orch-many-runners

**Status:** PLAN ONLY — approve-then-execute. **Nothing in this doc has been executed.**
**Date:** 2026-07-28 · **Branch:** `docs/pricing-scope-simplified` · **Author:** seanhanca
**Read-only sources:** `LR-MULTIRUNNER-GOLIVE-E2E.md` §6 (root cause), `live-runner-v2/`,
go-livepeer `v0.9.0` tag (`ai/runner/live_runner.go`, `cmd/livepeer/starter/flags.go`,
`cmd/livepeer/starter/starter.go`, `core/autoconvertedprice.go`).

> **SAFETY RAIL #0 — `byoc-staging-1` is OUT OF SCOPE.** It is a **separate orchestrator on a
> separate deployment** and MUST remain completely untouched and working. **No step in this
> plan touches, reads from, redeploys, refunds, or reconfigures `byoc-staging-1` in any way.**

---

## 1. Objective + end-state topology

**Goal:** a single, clean, BYOC-free live-runner orchestrator running the **real upstream
`livepeer/go-livepeer:v0.9.0`** image, using the **one-orch → many-runners** architecture
(one runner per capability, each with its own per-cap price), on the **native v0.9.0
live-runner path** (`/apps/{runner_id}/app/...` payment-gated single-shot), **not** the BYOC
job path.

**End-state topology (target):**

| Component | State after this plan |
|---|---|
| `liverunner-orch` (v0.9.0) | **ONE** orch, image `livepeer/go-livepeer:v0.9.0` (digest `sha256:27464aa2…`), on `liverunner-staging-1` VM, arbitrum-one-mainnet, funded wallet `0x180859…a6a252` (reused), `-useLiveRunners -liveRunnerConfig=runners.json`, per-cap USD prices. |
| Per-cap runners | 7–8 static single-shot runners (one per fal cap), each with its own `price_info`, surfaced on `/discovery`. |
| `liverunner-v1-orch` (`:8935`, current) | **REMOVED** (container stopped/down on the VM). |
| Dispatch path | **Native** `/apps/{runner_id}/app/{app_path}` → 402 challenge → `net.Payment` → proxy. **No BYOC job path.** |
| `byoc-staging-1` | **UNTOUCHED** (out of scope; never referenced). |

**Port note (open question, §6):** the v0.9.0 orch may keep `:8936` or move to a canonical
`:8935` **after** v1 is removed. This plan defaults to *bring up v0.9.0 additively first,
verify, then remove v1* (never a gap in coverage).

---

## 2. Already done — REUSE, do NOT redo

These are proven/committed. Do not rebuild them.

- **VM + access:** `liverunner-staging-1` (project `livepeer-simple-infra`, us-west1-b,
  `136.66.21.17`), gcloud authed as `qiang@livepeer.org`; SSH + Docker working. *(reuse)*
- **Funded wallet:** `0x180859c337d14eDF588C685f3f7AB4472AB6a252` + `orchpw` already on the VM
  at `~/live-runner/keystore` (registered on Arbitrum One). **No new wallet, no re-fund.** *(reuse)*
- **Config skeleton:** `live-runner-v2/` has committed `docker-compose.yml` (v0.9.0 template),
  `docker-compose.deployed.yml`, `runners.json`, `README.md`, `.env.example`. *(reuse/edit)*
- **Per-cap discovery concept proven:** the current `:8936` orch already advertises **8 distinct
  non-zero per-cap prices** on `/discovery` — the "one runner per cap, per-cap price" model works. *(reuse concept)*
- **naap-key payment path proven:** validate → signer auth (`PriceInfo` non-zero) →
  `/generate-live-payment` **200, real `net.Payment` minted**. The `400 zero priceInfo` is
  **already fixed** by per-cap runners. *(reuse)*
- **Root cause established (`…E2E.md` §6):** the earlier "generation fail / Sig check failed" was
  a **test-path mistake** (drove the BYOC job path), **not** a v0.9.0 defect. The native path
  returns `402`→`insufficient sender reserve` (payment layer), never a job-cred sig. **No combined
  "Frankenstein" byoc image is needed** — that approach is abandoned. *(reuse conclusion)*
- **v0.9.0 native support confirmed (this investigation):** `-useLiveRunners`,
  `-liveRunnerConfig`, `-liveRunnerAddr`, `-liveRunnerProxyUrl`, `ReserveLiveRunnerSession`,
  `ProxyLiveRunnerSingleShot`, `runnerChallenge`, `/discovery` all present in the `v0.9.0` tag;
  the 402 challenge prices **per-cap from the runner registry**. *(reuse finding)*

---

## 3. Remaining gaps to close

Legend: **RO** = read-only-safe · **FUND** = spends funds / on-chain / needs explicit approval ·
**CFG** = config change, reversible.

| # | Gap | Exact change | File / flag / command | Owner | Risk |
|---|-----|--------------|-----------------------|-------|------|
| **A** | `runners.json` uses byoc-fork **wei** schema; clean v0.9.0 **rejects it at boot** | Rewrite each entry to v0.9.0 schema `price_info:{price:"<usd>",currency:"usd",unit:"hour"\|"720p"\|"fixed"}` (+ keep `label,app,runner_url,health_url,healthy_status_code,mode,capacity`) | `live-runner-v2/runners.json` | me (draft) + **storyboard-pricing** (confirm USD) | **CFG** |
| **B** | USD→wei needs a price-feed oracle | Use v0.9.0 default `-priceFeedAddr` (Arbitrum ETH/USD `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612`, auto-set on `arbitrum-one-mainnet`) — verify it initializes | compose command / `-priceFeedAddr` | **orch-infra (John)** | **CFG** |
| **C** | Redeploy on **clean `livepeer/go-livepeer:v0.9.0`** (currently `3975-singleshot`, byoc-derived) | Swap image; keep `-useLiveRunners -liveRunnerConfig`; reuse wallet | `live-runner-v2/docker-compose.yml` on VM | **orch-infra (John)** | **CFG** (additive) |
| **D** | Remove `liverunner-v1-orch` (`:8935`) | Stop/down the v1 container **after** v0.9.0 is verified | VM: `docker compose … down` for v1 | **orch-infra (John)** | **CFG** (reversible: restart) |
| **E** | **Sender on-chain reserve** empty (`500 insufficient sender reserve`) | Fund deposit+reserve for the **gateway/sender payment wallet** (the `payment.sender`, NOT the orch wallet) in the Arbitrum One TicketBroker | `FundDepositAndReserve(deposit,reserve)` (e.g. `livepeer -deposit … -reserve …` or contract tx) | **John / pymthouse signer (holds sender key)** | **FUND / irreversible-ish** |
| **F** | Native dispatch client missing | Drive naap-key native `/apps/…` via the **deployed SDK service** (`_dispatch_lr` → `live_runner.call_runner`) with `SDK_MULTI_ORCH_ENABLED=1` + `SELECT_PROVIDER_LR_CAPS=flux-schnell` + `LR_ORCH_DISCOVERY`→v0.9.0 orch; **or** write a native `/apps/` probe | SDK service env / new probe | **gateway/SDK owner (John)** | **RO once funded** |
| **G** | Payment must bind to the **native 402 challenge** `OrchestratorInfo` + accepted signer `type` | `call_runner` must mint `net.Payment` against the challenge's `OrchestratorInfo`/`TicketParams`; confirm DMZ accepts the LR signer `type`. (v0.9.0 also supports native `-remoteSigner`/`-remoteSignerUrl`/`-remoteSignerWebhookUrl` — pymthouse can be the remote signer.) | gateway `call_runner` / signer | **John (signer) + gateway owner** | **RO** |
| **H** | `seedance-mini-i2v` price is PROVISIONAL (not in pricing table) | Finalize USD or drop the 8th entry to ship 7 caps | `runners.json` + pricing table | **storyboard-pricing** | **CFG** |

**Confirmed v0.9.0 schema (from `ai/runner/live_runner.go`, `normalizeLiveRunnerPriceInfo`):**
`price` = required positive decimal; `currency` must be `"usd"` (default if empty); `unit` ∈
`{hour, 720p, fixed}` (default `hour`). `health_url` is **required** (`buildStaticRunner` errors
without it); `healthy_status_code` must be a valid HTTP code. USD→wei conversion:
`fixed` = per request as-is; `hour` = ÷3600; `720p` = ÷(3600·1280·720·30) per pixel-second — via
`core.AutoConvertedPrice` which **requires `core.PriceFeedWatcher` initialized** (auto on
arbitrum-one-mainnet through the default `-priceFeedAddr`).

---

## 4. Step-by-step execution plan (in order)

> Each step lists: change · command/file · expected result · rollback · **✅ checkpoint**.
> **Do not proceed past a checkpoint without the stated expected result.**

### Step (i) — Rewrite `runners.json` → v0.9.0 USD schema  *(CFG · me + storyboard-pricing)*
- **Change:** convert all entries from `{price_per_unit,pixels_per_unit,unit:"WEI"}` to
  `{"price":"<usd>","currency":"usd","unit":"fixed"}` for single-shot image caps; for time-based
  video caps use `"720p"` or a per-request `"fixed"` (decision → §6).
- **Recommended mapping (pending pricing sign-off):**

| cap | app | proposed `unit` | proposed `price` (USD) |
|---|---|---|---|
| flux-schnell | `storyboard/fal-flux-schnell` | fixed | 0.00315 |
| flux-dev | `storyboard/fal-flux-dev` | fixed | 0.02625 |
| gpt-image | `storyboard/fal-gpt-image` | fixed | 0.0022 |
| kontext-edit | `storyboard/fal-kontext-edit` | fixed | 0.042 |
| pixverse-i2v | `storyboard/fal-pixverse-i2v` | fixed (or 720p) | 0.063/s → per-req TBD |
| veo-t2v | `storyboard/fal-veo-t2v` | fixed (or 720p) | 0.42/s → per-req TBD |
| chatterbox-tts | `storyboard/fal-chatterbox-tts` | fixed | 0.02625 /1k chars → per-req TBD |
| seedance-mini-i2v ⚠️ | `storyboard/fal-seedance-mini-i2v` | fixed | 0.0394/s **PROVISIONAL (gap H)** |

- **File:** `live-runner-v2/runners.json` (keep `health_url`, `healthy_status_code`, `mode:"single-shot"`, `capacity`).
- **Expected:** file validates against the v0.9.0 schema (positive decimal price, `currency:"usd"`, allowed `unit`).
- **Rollback:** `git checkout live-runner-v2/runners.json`.
- **✅ CHECKPOINT i:** USD `runners.json` committed; pricing owner has signed off (or 8th entry dropped).

### Step (ii) — Redeploy orch on clean `livepeer/go-livepeer:v0.9.0`  *(CFG/additive · John)*
- **Change:** on the VM, use `live-runner-v2/docker-compose.yml` (v0.9.0 template) with the **real**
  image; **additive** on `:8936` (do NOT stop v1 yet); reuse wallet keystore read-only.
- **Pre-check (RO):** `docker run --rm livepeer/go-livepeer:v0.9.0 -help 2>&1 | grep -i liveRunner`
  → confirms `-useLiveRunners -liveRunnerConfig -liveRunnerAddr -liveRunnerProxyUrl`.
- **Flags to include:** `-orchestrator -useLiveRunners -liveRunnerConfig=/etc/livepeer/runners.json
  -network=arbitrum-one-mainnet -ethUrl=<arb rpc> -ethKeystorePath=/keystore
  -ethAcctAddr=0x180859… -ethOrchAddr=0x180859… -ethPassword=/keystore/orchpw
  -pricePerUnit=100 -ticketEV=… -liveRunnerAddr=https://orchestrator:8935` (default `-priceFeedAddr`).
  Consider `-liveRunnerProxyUrl` if public single-shot proxy URLs are required.
- **Command (John, on VM):** `sudo docker compose -f docker-compose.yml up -d`
- **Expected boot log:** `Registered N static live runners from /etc/livepeer/runners.json`,
  `ServiceRegistry/TicketBroker/Minter … resolved`, **no** `error registering -liveRunnerConfig`.
- **Verify (RO):** `curl -sk https://136.66.21.17:8936/discovery | jq '.[0].runners[]|{app,price_info}'`
  → 7–8 distinct non-zero per-cap prices.
- **Rollback:** `docker compose -f docker-compose.yml down` (v1 still up → zero downtime).
- **✅ CHECKPOINT ii:** clean v0.9.0 orch booted, onchain, `/discovery` shows per-cap prices.

### Step (iii) — Remove `liverunner-v1-orch` (`:8935`)  *(CFG/reversible · John)*
- **Change:** stop/down ONLY the v1 container on `liverunner-staging-1`. **Do NOT** touch the
  wallet, keystore, or `byoc-staging-1`.
- **Command (John, on VM):** `docker stop liverunner-v1-orch` (or its compose `… down`).
- **On-chain note:** v1 and v0.9.0 share wallet `0x180859…`, which has **one** on-chain
  `serviceURI`. Boot does **NOT** rewrite it (`starter.go` `SetServiceURI` is in-memory only), so
  removing v1 doesn't mutate on-chain identity. The **native** LR path uses `/discovery` +
  `LR_ORCH_DISCOVERY` (direct addressing), so it is unaffected. If any **gRPC on-chain discovery**
  consumer relied on the wallet's serviceURI pointing at v1's endpoint, repoint it to the v0.9.0
  endpoint (see §6 open question on canonical port/URL).
- **Expected:** only the v0.9.0 orch remains; `/discovery` on it still healthy.
- **Rollback:** `docker start liverunner-v1-orch`.
- **✅ CHECKPOINT iii:** exactly one live-runner orch (v0.9.0) on the VM; byoc-staging-1 untouched.

### Step (iv) — Fund sender on-chain reserve  *(FUND · needs EXPLICIT approval · John/pymthouse)*
> ⚠️ **STOP — human approval required. Spends real funds on Arbitrum One and is not trivially
> reversible (funds locked, withdrawable only after the unlock period).**
- **Change:** fund **deposit + reserve** for the **gateway/sender payment wallet** — the wallet
  whose address appears as `payment.sender` (the one pymthouse signs for), **NOT** the orch wallet
  `0x180859…`. This clears the `500 insufficient sender reserve` seen on the native `/apps/…` probe.
- **Mechanism:** `TicketBroker.FundDepositAndReserve(depositAmount, reserveAmount)` on Arbitrum One
  (e.g. via a gateway node `-deposit <wei> -reserve <wei>`, or a direct contract tx from the sender key).
- **To confirm before executing (OPEN, §6):** (a) exact sender wallet address; (b) deposit amount
  (≥ ticket faceValue × depositMultiplier headroom); (c) reserve amount (covers `ticketEV`).
- **Expected:** native `/apps/{runner}/app/generate` with the funded payer no longer returns
  `500 insufficient sender reserve` (advances to proxy/generation).
- **Rollback:** none clean — funds are committed on-chain (unlock/withdraw later). **This is the
  one irreversible step; do not run without sign-off on wallet + amounts.**
- **✅ CHECKPOINT iv:** sender reserve funded; on-chain deposit+reserve confirmed for the sender wallet.

### Step (v) — Run naap-key NATIVE `/apps/…` e2e  *(RO once funded · gateway/SDK owner John)*
- **Change:** drive the naap-key path through the **deployed SDK service** so `_dispatch_lr` →
  `live_runner.call_runner` hits `POST /apps/{runner_id}/app/generate`:
  `SDK_MULTI_ORCH_ENABLED=1`, `SELECT_PROVIDER_LR_CAPS=flux-schnell` (or `LR_DESCRIPTOR_DISPATCH`),
  `LR_ORCH_DISCOVERY` → v0.9.0 orch. **Or** write a native `/apps/` probe (402 → mint payment bound
  to the challenge `OrchestratorInfo` → `Livepeer-Payment` + `Livepeer-Segment` → proxy).
- **Pre-req:** John confirms the deployed SDK image actually ships `live_runner.call_runner`
  (absent from the `livepeer-python-gateway` checkout / branch `fix/byoc-e2e-inference-type-byoc`).
- **Expected:** flux-schnell request → `402` challenge → payment accepted → proxied to fal → **real
  fal asset returned**; on-chain debit against the funded sender reserve.
- **Rollback:** n/a (read-only test; no infra mutation).
- **✅ CHECKPOINT v:** one real native generation completes end-to-end with a returned asset.

### Step (vi) — Verify per-cap pricing + generation + metering  *(RO · me/John)*
- **Verify:** (a) `/discovery` = distinct non-zero per-cap prices; (b) native generation succeeds
  for ≥2 caps (e.g. flux-schnell + one more); (c) metering records the per-cap charge (OpenMeter /
  ProcessPayment debit) — confirm it is **per-cap** on the native path (byoc gRPC flat-base is not used).
- **Expected:** per-cap prices correct, real assets, metered debit.
- **✅ CHECKPOINT vi:** DONE — clean v0.9.0 one-orch-many-runners native path is green.

---

## 5. Risks + explicit safety rails

- **`byoc-staging-1` UNTOUCHED** — never referenced, read, redeployed, or refunded by any step. ✅
- **Additive-first / reversible where possible:** v0.9.0 is brought up **before** v1 is removed
  (Steps ii→iii), so there is never a coverage gap; v1 removal is reversible (`docker start`).
- **Config-only changes are reversible:** `runners.json` (git), compose image swap (redeploy),
  v1 stop (restart).
- **The ONE irreversible / fund-spending step is Step (iv)** — funding the sender reserve on
  Arbitrum One. It is explicitly flagged and gated on human approval of wallet + amounts.
- **Wallet reuse is safe:** boot does not write the on-chain serviceURI; reusing `0x180859…`
  across a swap does not mutate on-chain identity.
- **Secrets:** keystore/passphrase/RPC/FAL_KEY stay env-only / VM-only / redacted; none in the repo.
- **Boot-break risk (mitigated):** wrong `runners.json` schema → `glog.Exit` at boot; mitigated by
  Step (i) schema + Step (ii) additive verify before removing v1.

---

## 6. Open questions for the user to decide

1. **Sender reserve amount + wallet (Step iv):** confirm the exact sender/payer wallet address and
   the deposit + reserve amounts to fund on Arbitrum One. *(blocks the only irreversible step)*
2. **Canonical port:** keep the v0.9.0 orch on `:8936`, or move it to `:8935` after v1 is removed
   (and update any on-chain/gRPC serviceURI consumers accordingly)?
3. **Video/TTS unit mapping:** for per-second video caps (pixverse, veo, seedance) and per-1k-char
   TTS (chatterbox), use `unit:"fixed"` per single-shot request (assume a standard clip/length) or
   `unit:"720p"`? This changes the USD figures in Step (i).
4. **seedance-mini-i2v (gap H):** finalize its USD price in the pricing table, or drop the 8th
   runner and ship 7 caps?
5. **Native dispatch route (Step v):** drive via the deployed SDK service (needs John to confirm the
   image ships `live_runner.call_runner`), or approve writing a new standalone native `/apps/` probe?
