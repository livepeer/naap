# LR multi-runner go-live + dual-key E2E

**Date:** 2026-07-28
**Goal:** stand up the multi-runner Live-Runner orchestrator LIVE + ONCHAIN with correct
per-cap pricing, then run an e2e test with BOTH the pymthouse naap key and a Daydream API key.
**Authoring workspace:** `/Users/qiang.han/Documents/mycodespace/NaaP` (branch `docs/pricing-scope-simplified`).

> **TL;DR (2026-07-28 re-run, gcloud re-authed)** — The new onchain multi-runner
> orch is now **LIVE + ONCHAIN + PER-CAP-PRICED**. It was deployed **additively**
> on the existing `liverunner-staging-1` VM at host **`:8936`** (reusing the funded
> BYOC wallet `0x180859…a6a252`, NO new wallet/fund, existing `:8935` orch
> untouched). `/discovery` shows **8 distinct non-zero per-cap prices** (§3). The
> **`400 missing/zero priceInfo` failure is GONE**: against the new orch the naap-key
> path now returns gRPC `PriceInfo=101/1` (non-zero) and `/generate-live-payment`
> mints a real `net.Payment` (HTTP 200). Remaining blockers: **(a)** full asset
> *generation* fails at the orch job-cred sig check (`Sig check failed`) — the
> `3975-singleshot` image's byoc job-cred verify predates the pymthouse signer
> format that the newer `byoc-cap-capacity-canary` image accepts, and that newer
> image lacks `-liveRunnerConfig`; needs a **combined image** (live-runner static
> config + current byoc job-cred verify) → **John / orch-infra**; **(b)** per-cap
> *metering* still flat (gap F); **(c)** intermittent signer **HTTP 500** on
> `/generate-live-payment` (~1/5); **(d)** Daydream `sk_…` key path still needs a key.

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
