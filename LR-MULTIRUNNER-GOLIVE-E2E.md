# LR multi-runner go-live + dual-key E2E

**Date:** 2026-07-28
**Goal:** stand up the multi-runner Live-Runner orchestrator LIVE + ONCHAIN with correct
per-cap pricing, then run an e2e test with BOTH the pymthouse naap key and a Daydream API key.
**Authoring workspace:** `/Users/qiang.han/Documents/mycodespace/NaaP` (branch `docs/pricing-scope-simplified`).

> **TL;DR (2026-07-28 ROOT-CAUSE re-investigation — corrected direction: NO byoc,
> clean v0.9.0 only).** The prior `Sig check failed` was a **TEST-PATH MISTAKE, not
> a v0.9.0 defect**. The e2e drove the **BYOC job path** (`submit_byoc_job` →
> `POST /process/request` with a `FlattenBYOCJob` job-cred signature), which hits
> `byoc/job_orchestrator.go:verifyJobCreds` → `Sig check failed`. But the
> live-runner is a **NATIVE single-shot / direct-post inference path** that **never
> runs a job-cred sig check** — it is a *payment-gated* path
> (`/apps/{runner_id}/app/{app_path}` → `402` challenge with per-cap `PriceInfo` +
> `TicketParams` + `AuthToken` → `net.Payment` + `Livepeer-Segment` → `ProcessPayment`
> → proxy to runner). **Proven empirically on the running `:8936` orch** (§6): the
> native endpoint returns **`402` / `insufficient sender reserve`** (payment layer),
> the byoc endpoint returns the **job-cred** error. **No byoc-branch merge / combined
> "Frankenstein" image is needed — that approach is abandoned.**
>
> **Clean `livepeer/go-livepeer:v0.9.0` fully supports native per-cap-priced
> single-shot live-runner** (has `-useLiveRunners`/`-liveRunnerConfig`,
> `ReserveLiveRunnerSession`, `ProxyLiveRunnerSingleShot`, `reservePaidLiveRunnerSession`;
> the 402 challenge prices *per-cap from the runner registry*, not from the flat
> byoc gRPC base — so **gap G is a byoc-gRPC-path artifact, not a native-path
> limitation**). Two **BYOC-free** gaps remain before a green native e2e: **(A,
> config)** the deployed `runners.json` uses a byoc-fork price schema
> (`price_per_unit`/`pixels_per_unit`/`unit:"WEI"`) that **clean v0.9.0 rejects at
> registration** — v0.9.0 wants `{price:<usd>, currency:"usd", unit:hour|720p|fixed}`
> (USD→wei auto-converted, needs a price-feed oracle); **(B, client)** the naap e2e
> must call the native `/apps/…/app/…` dispatch (via
> `livepeer_gateway.live_runner.call_runner`, used by the SDK service's flag-gated
> `_dispatch_lr`), **not** `submit_byoc_job` — that native client is **not** in the
> python-gateway checkout and there is **no** native `/apps/` probe in this repo.
> Per the guardrails (no read-only gateway/SDK changes, stop-and-report), the clean
> v0.9.0 redeploy + full native paid generation was **NOT executed** — the exact
> owners/fix are in §6. Existing `:8935` + `byoc-staging-1` orchs untouched; both
> orchs verified healthy (HTTP 200 `/discovery`) at hand-off.

---

## 1. Access status — gcloud RE-AUTHED, deploy UNBLOCKED

| Capability | Status | Evidence |
|---|---|---|
| gcloud identity | ✅ **active** | `gcloud auth list` → `qiang@livepeer.org`; project `livepeer-simple-infra` |
| gcloud API calls (compute/secrets) | ✅ **WORKS non-interactively** | `gcloud compute instances list` + `gcloud secrets list` succeed (no reauth prompt) |
| VM SSH | ✅ | `gcloud compute ssh liverunner-staging-1 --zone us-west1-b` works |
| Docker on VM | ✅ | `go-livepeer:3975-singleshot`, `live-runner-fal-app` images present |
| GitHub (`gh`) | ✅ as `seanhanca` | git-push-pr workflow |
| gateway checkout + venv | ✅ | `../livepeer-python-gateway/.venv` (py3.14), grpc+protobuf import OK |
| orch wallet keystore / passphrase | ✅ **reused (already on VM)** | `~/live-runner/keystore/wallet.json` = `0x180859…a6a252` + `orchpw`; NO Secret Manager pull needed, NO new wallet |

**Net:** with gcloud re-authed, VM + wallet + docker are all reachable. The new orch was
brought up **additively** on the existing VM at `:8936` reusing the funded wallet — no new
wallet/fund, no DNS/Caddy needed (gateway TOFU-pins the self-signed cert; firewall
`simple-infra-allow-byoc` already allows `tcp:8936`). The existing `:8935` orch was untouched.

---

## 2. Deploy result — **LIVE + ONCHAIN + PER-CAP-PRICED** (deployed additively on `:8936`)

The new orch is **running** on the existing `liverunner-staging-1` VM (us-west1-b,
external IP `136.66.21.17`), host port **`:8936`** (container `liverunner-v2-orch`), via
`live-runner-v2/docker-compose.deployed.yml`. Boot evidence:

```
Using Ethereum account: 0x180859c337d14eDF588C685f3f7AB4472AB6a252   # funded BYOC wallet, reused
Unlocked ETH account:  0x180859c337d14eDF588C685f3f7AB4472AB6a252
starter.go:1038] Price: 100.000 wei per pixel                         # non-zero base (was 0 on the old orch)
starter.go:2058] Registered 8 static live runners from /etc/livepeer/runners.json
ServiceRegistry / TicketBroker / Minter contracts resolved            # onchain (arbitrum-one-mainnet)
```

**Key deploy decisions (all within the safety guardrails):**
- **Image:** `go-livepeer:3975-singleshot` (the proven single-shot LiveRunner build already on
  the VM), NOT `v0.9.0`. Both expose `-liveRunnerConfig`; the `3975` image is the one that runs
  the existing LR orch, and its `StaticLiveRunnerConfigEntry` schema exactly matches `runners.json`.
- **Additive:** new container on `:8936` (firewall already allows `tcp:8936`); existing `:8935`
  orch and `byoc-staging-1` untouched. Booting does **not** write the on-chain serviceURI
  (starter.go in-memory only), so reusing the shared wallet does not mutate any orch's on-chain
  identity — same pattern the existing `compose.onchain.yml` already uses.
- **Wallet reuse:** mounts the existing `~/live-runner/keystore` (`0x180859…a6a252` + `orchpw`)
  read-only. **No new wallet, no funding, no Secret Manager pull.**
- **Pricing:** `-pricePerUnit=100` (non-zero) → gRPC `OrchestratorInfo.PriceInfo` is non-zero
  (this is what kills the `400 missing/zero priceInfo`; the old LR orch ran `-pricePerUnit=0`).
  Per-cap distinct prices come from `runners.json` and surface on `/discovery` (§3).

Committed artifacts at `live-runner-v2/`:

- `live-runner-v2/docker-compose.deployed.yml` — **the actual deployed compose** (3975-singleshot,
  `:8936`, reused keystore, `-pricePerUnit=100`, `-liveRunnerConfig`, fal-app).
- `live-runner-v2/runners.json` — 8 per-cap runners, 8 distinct non-zero wei prices. **FIX applied:**
  added the mandatory `health_url` + `healthy_status_code` per entry (the image's `buildStaticRunner`
  `glog.Exitf`s without `health_url`; the prior artifact would not have booted).
- `live-runner-v2/docker-compose.yml` — original v0.9.0 authoring template (kept for reference).
- `live-runner-v2/.env.example` / `README.md` — template + runbook.

**Teardown (if needed):** `cd ~/live-runner-v2 && sudo docker compose -f docker-compose.deployed.yml down`.

### 2.1 The 8 runners (validated: 8 distinct non-zero prices)

| # | cap | app id | wire `price_per_unit / pixels_per_unit` (WEI) |
|---|-----|--------|-----------------------------------------------|
| 1 | flux-schnell | `storyboard/fal-flux-schnell` | `1284088677165 / 1048576` |
| 2 | flux-dev | `storyboard/fal-flux-dev` | `10700738976372 / 1048576` |
| 3 | gpt-image | `storyboard/fal-gpt-image` | `898862074015 / 1048576` |
| 4 | kontext-edit | `storyboard/fal-kontext-edit` | `17121182362196 / 1048576` |
| 5 | pixverse-i2v | `storyboard/fal-pixverse-i2v` | `3246683470165 / 8294400` |
| 6 | veo-t2v | `storyboard/fal-veo-t2v` | `21644556467764 / 8294400` |
| 7 | chatterbox-tts | `storyboard/fal-chatterbox-tts` | `112205380728886 / 100000` |
| 8 | **seedance-mini-i2v** ⚠️ PROVISIONAL | `storyboard/fal-seedance-mini-i2v` | `2030465535310 / 8294400` |

⚠️ **seedance** wei is *derived* from the documented $0.0394/s at the same ETH reference as the
other video caps (`≈5.1535e13 wei per USD·s`). It is **not** in `pricing-table.json` yet — **gap H,
owner: storyboard pricing** must finalize it. Drop the last `runners.json` entry to ship only the 7 finalized caps.

### 2.2 Exact command runbook for John / orch-infra

```bash
# On an amd64 GCP VM in livepeer-simple-infra; copy live-runner-v2/ to simple-infra/live-runner-v2/
docker run --rm livepeer/go-livepeer:v0.9.0 -help 2>&1 | grep -i liveRunner   # confirm field-name shape
# supply ./keystore/<wallet>.json + ./password.txt + ./.env (from .env.example); reuse EXISTING funded wallet
sudo docker compose up -d --build
sudo docker logs liverunner-v2-orch | grep -i 'liveRunner\|price'
# Caddy :443 + DNS A record liverunner-v2-staging-1.daydream.monster -> <VM IP>
curl -sk https://liverunner-v2-staging-1.daydream.monster:8935/discovery | jq '.[0].runners[] | {app, price_info}'
```

**VM-only actions (blockers):** gcloud reauth; funded+registered orch wallet from Secret Manager;
Arbitrum RPC; DNS + Caddy TLS. **Owner: John / orch-infra.**

---

## 3. /discovery pricing evidence — **LIVE, 8 distinct non-zero per-cap prices** ✅

Raw from the deployed orch (`curl -sk https://136.66.21.17:8936/discovery | jq '.[0].runners[]'`,
`storyboard/fal-app` heartbeat runner filtered out):

```
storyboard/fal-chatterbox-tts    112205380728886 / 100000  WEI
storyboard/fal-flux-dev           10700738976372 / 1048576 WEI
storyboard/fal-flux-schnell        1284088677165 / 1048576 WEI
storyboard/fal-gpt-image            898862074015 / 1048576 WEI
storyboard/fal-kontext-edit       17121182362196 / 1048576 WEI
storyboard/fal-pixverse-i2v        3246683470165 / 8294400 WEI
storyboard/fal-seedance-mini-i2v   2030465535310 / 8294400 WEI
storyboard/fal-veo-t2v            21644556467764 / 8294400 WEI
```

**8 runners, 8 distinct non-zero `price_info` — Step-3 PASS.** (A 9th entry `storyboard/fal-app`
`{100,1,WEI}` also appears — that is the shared fal proxy's own dynamic heartbeat registration,
not one of the 8 static per-cap runners; harmless.)

**gRPC `OrchestratorInfo` (what the byoc payment path reads), before vs now:**

| orch | gRPC `PriceInfo` (byoc caps) | verdict |
|---|---|---|
| old `liverunner-staging-1` (`:8935`, `-pricePerUnit=0`) | **`0/1`** | ❌ zero-priced → `400 missing or zero priceInfo` |
| **new `liverunner-v2-orch` (`:8936`, `-pricePerUnit=100`)** | **`101/1`** (100 base × ~1% tx-cost overhead) | ✅ **non-zero → payment mints** |

> Note: the per-cap distinct wei prices live in `/discovery` (and the LiveRunner registry, used by
> the live-runner-native single-shot path). The **byoc** gRPC `PriceInfo` path returns the flat
> base (`-pricePerUnit`) because static live-runner registration does not call `SetBasePriceForCap`
> — so byoc-path payment/metering is flat, not per-cap (that is **gap F**, unchanged).

---

## 4. Dual-key E2E — PASS/FAIL per stage

Signer: `pymthouse-signer-test-production.up.railway.app` (health `OK`). Recipient `0x180859c337d1`.
Probes run under the gateway venv via the `pymthouse-e2e` runbook (run50/run55/run57). Secrets env-only.

### 4.1 pymthouse **naap key** path

Credential path **A** (naap key → validate → composite bearer), run **against the NEW orch**
`https://136.66.21.17:8936` (flux-schnell). Probes: `run57-lr-auth-vs-pay.py` (stages 0–2) and
`run58-lrv2-generate.py` (stage 3; a thin wrapper that reuses the real `submit_byoc_job` but points
the otherwise-hardcoded gRPC discovery port at `:8936`).

| Stage | Probe / endpoint | Result vs NEW orch (`:8936`) | Evidence |
|---|---|---|---|
| 0 validate | `POST /api/v1/keys/validate` | ✅ **PASS** | `signerSession {url,headers}`, composite `Bearer app_98575870…_pmth_…` (len 105) |
| 1 signer auth | `/sign-orchestrator-info` (run57) | ✅ **PASS** | composite ACCEPTED, recipient `0x180859c337d1`, **`PriceInfo=101/1` (non-zero)** |
| 2 payment | `/generate-live-payment` (run57) | ✅ **PASS** — **`400 zero priceInfo` GONE** | HTTP **200**, `net.Payment` minted (4/5 attempts; 1/5 = intermittent HTTP 500, the flaky signer) |
| 3 generation | `submit_byoc_job` → `/process/request` (run58) | ❌ **FAIL** — HTTP 400 `Could not verify job creds` | orch log: `byoc/job_orchestrator.go:570 Sig check failed sender=0x6CAE3C7a…` — the `3975-singleshot` image's `VerifySig(sender, Request+Parameters, sig)` rejects the pymthouse byoc job-cred format |
| 4 metering | OpenMeter `byoc/<cap>` | ⚠️ **not newly measured** (gen blocked) | payment WAS minted; by design metering at payment-gen is **flat** (~1 µUSD), not per-cap — gap F unchanged |

- **Verdict (naap key):** ✅ **The `400 missing/zero priceInfo` failure is GONE.** validate → signer
  auth (`PriceInfo 101/1`) → `/generate-live-payment` **200 minted** all pass against the new orch.
  The remaining stage-3 failure is a **separate orch-image job-cred verify gap**, not a pricing issue:
  the pymthouse byoc job signature is verified by the newer `byoc-cap-capacity-canary-20260720`
  image (control) but **not** by the `3975-singleshot` image, and that newer byoc image has **no**
  `-liveRunnerConfig`. → needs a **combined go-livepeer image** (live-runner static config #3975 +
  current byoc job-cred verify #3980). **Owner: John / orch-infra.**
- **Note (signer reliability):** `/generate-live-payment` returned intermittent **HTTP 500 Internal
  Server Error** (~1 of 5). Matches the previously-observed flaky signer. Owner: **John / pymthouse signer**.

### 4.2 **Daydream API key** path — ❌ BLOCKED-need-key

- Searched env/config/run docs for `DAYDREAM_API_KEY` / `sk_` / bearer across the NaaP repo and sibling
  repos (`daydream`, `scope-load-testing`, `storyboard-a3`, `pymthouse`, `livepeer-python-gateway`, `ddMCP`).
- **Only reference found:** `scope-load-testing` uses `DAYDREAM_API_KEY` (format `sk_…`, sent as
  `Authorization: Bearer <key>` to Daydream `/v1/…`), but the only value present is the placeholder
  `sk_your_api_key_here` in `.env.example`. **No real key exists in the workspace.**
- Per guardrails, no key was invented. **Required to unblock:** a real Daydream API key in `sk_…` form
  (the pipelines/`signer.daydream.live` `type:lv2v`/`type:live` path). Owner: **whoever holds the
  Daydream account key** (Daydream/product).

---

## 5. Answers to the brief

- **Is the new orch live + onchain + priced?** ✅ **Yes.** `liverunner-v2-orch` is running on the
  `liverunner-staging-1` VM at `:8936`, onchain on arbitrum-one-mainnet with the funded BYOC wallet
  `0x180859…a6a252` (reused; contracts resolved, account unlocked), base price 100 wei/pixel, and
  `/discovery` advertises **8 distinct non-zero per-cap prices**.
- **Did the naap-key E2E pass against it — is the priceInfo failure gone?** ✅ **The `400 missing/zero
  priceInfo` is GONE.** validate → signer auth (`PriceInfo 101/1`) → `/generate-live-payment` **HTTP
  200 minted** all pass. ⚠️ Full asset *generation* is still blocked one step later by an orch-image
  **job-cred sig-verify** gap (`Sig check failed`), unrelated to pricing.
- **Did E2E pass for the Daydream key?** ❌ **No — BLOCKED-need-key** (no real `sk_…` key available).
- **Metering per-cap-correct or flat?** ⚠️ **Flat** (byoc gRPC path uses the flat base price; static
  live-runner registration doesn't call `SetBasePriceForCap`) — gap F, unchanged.

### Top gaps + owners

| # | Gap | Impact | Owner |
|---|-----|--------|-------|
| 1 | **Combined orch image**: live-runner static config (`-liveRunnerConfig`, #3975) **+** current byoc job-cred verify (#3980). Today `3975-singleshot` has the former but rejects the pymthouse byoc job sig; `byoc-cap-capacity-canary` has the latter but no `-liveRunnerConfig`. | Full billed *generation* against the per-cap LR orch fails at `Sig check failed` | **John / orch-infra** |
| 2 | **Daydream API key** absent | Daydream-key e2e path cannot run | **Daydream / product (key holder)** |
| 3 | **seedance-mini-i2v price** not in pricing-table (provisional in `runners.json`) | 8th cap price unofficial | **storyboard pricing (gap H)** |
| 4 | **Per-unit / per-cap USD metering** on the byoc path (charge by MP/s/1000-chars) | Today flat base price | **John / pymthouse (gap F)** |
| 5 | **Intermittent signer HTTP 500** on `/generate-live-payment` (~1/5) | Flaky billed payments | **John / pymthouse signer** |
| 6 | **`type=live` session payment** (gateway sends `byoc` today) | LR-native single-shot per-cap billing not exercised | **John (signer image) + gateway owner (gap E)** |

> ⚠️ **Superseded by §6.** Gap #1 above (the "combined byoc image") is **withdrawn** —
> the direction changed to **NO byoc / clean v0.9.0 only**, and root-cause (§6) shows
> the sig-check was a **test-path mistake**, so no combined image is needed. Read §6.

---

## 6. ROOT CAUSE (2026-07-28 re-investigation) — byoc-path vs native live-runner path

**Corrected direction (user):** *deprecate the BYOC path entirely; use ONLY clean
upstream `livepeer/go-livepeer:v0.9.0` for the live-runner orch; do NOT merge byoc
branches or build a combined image.* This section supersedes the "combined image"
conclusion in the earlier TL;DR / §4 / §5.

### 6.1 The `Sig check failed` was a TEST-PATH MISTAKE, not a v0.9.0 defect

The e2e drove the **BYOC job-submission path**, which is a *different orchestrator
surface* from the native live-runner path:

| | BYOC job path (what the e2e used) | Native live-runner path (v0.9.0) |
|---|---|---|
| Gateway call | `submit_byoc_job` (`byoc.py`) | `_dispatch_lr` → `livepeer_gateway.live_runner.call_runner` |
| Orch endpoint | `POST /process/request/{cap}` | `POST /apps/{runner_id}/app/{app_path}` (single-shot) / `/apps/{runner_id}/session` (persistent) |
| Auth/verify | `byoc/job_orchestrator.go:verifyJobCreds` → `FlattenBYOCJob` binary sig → **`Sig check failed`** | **payment-gated**: `runnerChallenge` → `402` w/ per-cap `PriceInfo` + `TicketParams` + `AuthToken` → `Livepeer-Payment` (`net.Payment`) + `Livepeer-Segment` → `processPaymentAndSegmentHeaders` → `ProcessPayment` → proxy to runner |
| Job-cred sig? | **YES** (this is what failed) | **NO — never runs a job-cred sig check** |

So `Sig check failed` came from `verifyJobCreds` on the **byoc** path. The native
live-runner path (the actual v0.9.0 single-shot inference dispatch) does not call
that code at all.

### 6.2 Empirical proof on the running `:8936` orch (no redeploy, additive, read-only)

`/discovery` on `:8936` exposes each single-shot runner at
`https://136.66.21.17:8936/apps/{runner_id}/app` (e.g. flux-schnell →
`runner_7rboknln`). Probing it directly:

```
# NATIVE single-shot, no payer header:
POST /apps/runner_7rboknln/app/generate            -> HTTP 402  {"error":{"message":"invalid live runner payment signer address"}}
# NATIVE single-shot, with Livepeer-Payer-Address (unfunded/dummy):
POST /apps/runner_7rboknln/app/generate            -> HTTP 500  "insufficient sender reserve"
# BYOC path (contrast):
POST /process/request/flux-schnell (job header)    -> HTTP 400  job-cred path ("Sig check failed" with a real pymthouse job)
```

The native path lands in the **payment/reserve** layer (`402` → challenge; `500`
insufficient reserve), **never** in job-cred verification. That is the decisive
evidence: **the failure was the wrong client path, not a broken orchestrator.**
(Probed on `3975-singleshot`, whose `/apps/*` handlers are the same live-runner code
as clean v0.9.0.)

### 6.3 Does clean v0.9.0 support `-liveRunnerConfig` + native per-cap pricing? **YES**

From the `v0.9.0` tag (`golivepeer/go-livepeer`, tag `df527c3`):

- `cmd/livepeer/starter/flags.go`: `-useLiveRunners`, `-liveRunnerConfig` present;
  `starter.go` reads the config and logs `Registered N static live runners…`.
- `server/ai_http.go`: `ReserveLiveRunnerSession`, `PaymentForLiveRunnerSession`,
  `ProxyLiveRunnerSingleShot`, `reservePaidLiveRunnerSession`, `runnerChallenge`,
  `runnerOrchInfo`, `GET /discovery`.
- **Per-cap pricing is native**: `runnerOrchInfo` builds the `402` challenge
  `PriceInfo` from `manager.PaymentInfo(runnerID)` — i.e. the **runner's own
  registered price**, per cap. So **gap G ("LR prices don't feed pricing") is a
  byoc-gRPC-path artifact** (the flat `-pricePerUnit` base only feeds the byoc
  `OrchestratorInfo.PriceInfo`); the **native path prices per-cap correctly** with
  no byoc code.

### 6.4 The two BYOC-free gaps to a green native e2e (and owners)

**Gap A — `runners.json` schema is byoc-fork, not v0.9.0 (config; blocks boot on clean v0.9.0).**
The deployed `runners.json` entries use
`"price_info": { "price_per_unit": …, "pixels_per_unit": …, "unit": "WEI" }`
(a per-cap **wei** schema added in the byoc/singleshot fork so it needs no oracle).
Clean v0.9.0's `ai/runner/live_runner.go:normalizeLiveRunnerPriceInfo` requires
`{ "price": <usd-decimal>, "currency": "usd", "unit": "hour"|"720p"|"fixed" }` and
auto-converts USD→wei at runtime (`AutoConvertedPrice`, needs a price-feed oracle,
e.g. `-priceFeedAddr`). Given `unit:"WEI"` + missing `price`, clean v0.9.0 would
`glog.Exit("error registering -liveRunnerConfig")` and **not boot**.
→ **Fix (config only, BYOC-free):** rewrite `runners.json` to the v0.9.0 schema
(single-shot image caps → `unit:"fixed"` USD/req; video/time caps → `720p`/`hour`),
set the price-feed oracle flag, redeploy. **Owner: orch-infra (John) + storyboard
pricing** (USD table already exists; `fixed` per-request USD is the natural fit).

**Gap B — the naap e2e must use the NATIVE dispatch client, not `submit_byoc_job` (client).**
The native `/apps/…/app/…` flow (402 challenge → `PaymentSession` payment bound to
the challenge `OrchestratorInfo` → `Livepeer-Payment`+`Livepeer-Segment` → proxy) is
implemented by `livepeer_gateway.live_runner.call_runner`, which the SDK service's
flag-gated `_dispatch_lr`/`_dispatch_lr_v2` call
(`SDK_MULTI_ORCH_ENABLED` + `SELECT_PROVIDER_LR_CAPS`/`LR_DESCRIPTOR_DISPATCH`). But
`live_runner.py` is **absent** from the `livepeer-python-gateway` checkout
(branch `fix/byoc-e2e-inference-type-byoc`) and every known branch, and there is
**no native `/apps/` probe** in this repo (run50/53/55/57/58 are all byoc/lv2v). So a
native paid generation can only be exercised via the **deployed SDK service**
(naap-key → validate → per-key signer → `_dispatch_lr`) or by writing a new native
probe. → **Owner: gateway/SDK owner (John)** to (i) confirm the SDK image ships
`live_runner.call_runner`, (ii) run the naap-key native path through the SDK service
with `SDK_MULTI_ORCH_ENABLED=1` + `SELECT_PROVIDER_LR_CAPS=flux-schnell` pointed at
the v0.9.0 orch, and the sender wallet **funded with an on-chain reserve** (the `500
insufficient sender reserve` above).

**Also relevant — payment binding & signer `type`.** The native challenge issues its
own `TicketParams`/`AuthToken`; the payment must be minted against *that*
`OrchestratorInfo` (the gateway's `PaymentSession` does exactly this for `type:lv2v`
/`type:scope`). The pymthouse `/generate-live-payment` already mints a `net.Payment`;
whoever wires `call_runner` must pass the challenge's `OrchestratorInfo` and a signer
`type` the DMZ accepts for the LR path (today `byoc`/`lv2v`). This is gap **E** and
is BYOC-free (it's the native session/payment shape, not job-cred sig).

### 6.5 Decision & why the redeploy was not executed

Per the guardrails (*additive only; reuse funded wallet; no byoc reintroduction;
stop-and-report on any real blocker rather than looping or hacking*), the clean
v0.9.0 redeploy + full native paid generation was **NOT run**, because it is not
"clearly correct & read-only": it requires **(A)** a `runners.json` rewrite + a
price-feed oracle config (a real unknown that can break boot) **and (B)** a native
dispatch client that is not available read-only (no `live_runner.py` in the gateway,
no native probe). Both are the "gateway/SDK changes we can't do read-only" the brief
says to stop on. The in-progress combined byoc image build was **aborted** and the
pushed combine branch `fix/byoc-e2e-v1-and-type-byoc` was **deleted** from origin.
Existing orchs untouched and healthy (`:8935` + `:8936` both HTTP 200 on `/discovery`).

### 6.6 Minimal path to a green, BYOC-free native e2e (recommended)

1. **Rewrite `runners.json`** to v0.9.0 schema (per-cap USD, `unit:"fixed"` for the
   8 single-shot fal caps) + set the price-feed oracle flag. *(config — orch-infra + storyboard pricing)*
2. **Redeploy `:8936` on clean `livepeer/go-livepeer:v0.9.0`** (image already on the
   VM), additive, reuse wallet `0x180859…a6a252`; confirm boot + onchain + `/discovery`
   per-cap prices. *(orch-infra)*
3. **Fund the gateway/sender wallet's on-chain reserve** on arbitrum-one so
   `ProcessPayment` clears (the `500 insufficient sender reserve`). *(orch-infra)*
4. **Drive the naap-key path through the deployed SDK service** with
   `SDK_MULTI_ORCH_ENABLED=1` + `SELECT_PROVIDER_LR_CAPS=flux-schnell` +
   `LR_ORCH_DISCOVERY` pointed at `:8936` (so `_dispatch_lr` → `call_runner` hits
   `/apps/…/app/generate`); verify a real fal asset + on-chain debit. *(gateway/SDK owner)*

No step reintroduces byoc; no combined image is required.

### 6.7 Updated gaps + owners (native path)

| # | Gap | Impact | Owner |
|---|-----|--------|-------|
| A | `runners.json` uses byoc-fork wei schema; clean v0.9.0 needs USD + `unit:hour/720p/fixed` + price-feed oracle | Clean v0.9.0 won't register runners / boot | **orch-infra (John) + storyboard pricing** |
| B | Native `/apps/…/app` dispatch (`live_runner.call_runner`) absent from gateway checkout; no native probe in repo | naap native e2e can't be run read-only | **gateway/SDK owner (John)** |
| C | Sender/gateway wallet has no on-chain reserve on the LR orch (`500 insufficient sender reserve`) | Native payment can't clear | **orch-infra (John)** |
| E | Signer `type` + payment must bind to the native 402 challenge `OrchestratorInfo` | Native billing shape not exercised | **John (signer) + gateway owner** |
| — | **Daydream `sk_…` key** absent | Daydream-key path can't run | **Daydream / product** |

**Bottom line:** live-runner generation failed because the test used the **byoc job
path** against a **native live-runner** orch — a client/path mismatch, **not** a
v0.9.0 limitation and **not** something a combined byoc image should fix. Clean
v0.9.0 supports native per-cap-priced single-shot inference; the remaining work is a
`runners.json` USD rewrite + native `/apps/` dispatch + a funded sender reserve, all
BYOC-free, owned by orch-infra + the gateway/SDK owner.
