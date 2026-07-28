# LR multi-runner go-live + dual-key E2E

**Date:** 2026-07-28
**Goal:** stand up the multi-runner Live-Runner orchestrator LIVE + ONCHAIN with correct
per-cap pricing, then run an e2e test with BOTH the pymthouse naap key and a Daydream API key.
**Authoring workspace:** `/Users/qiang.han/Documents/mycodespace/NaaP` (branch `docs/pricing-scope-simplified`).

> **TL;DR** — The new onchain multi-runner orch is **NOT live**: the go-live is
> **BLOCKED-pending-infra** (gcloud token needs interactive reauth → no VM /
> keystore / Secret Manager access; on-chain wallet + DNS are infra-only). The
> finalized deploy artifacts (compose + 8-runner `runners.json` + runbook) are
> committed under `live-runner-v2/`. The **naap-key E2E path is proven end-to-end**
> (validate → signer auth → payment → real fal.media image) on the priced control
> orch, and fails **only on price** against the zero-priced LR orch. The
> **Daydream-key path is BLOCKED-need-key** (no real `sk_…` key exists in the
> workspace; only an `.env.example` placeholder).

---

## 1. Access status (what I can / cannot do)

| Capability | Status | Evidence |
|---|---|---|
| gcloud identity | ⚠️ present but **token expired** | `gcloud auth list` → `qiang@livepeer.org` active; project `livepeer-simple-infra` |
| gcloud API calls (compute/secrets) | ❌ **BLOCKED** | `gcloud compute instances list` → `Reauthentication failed. cannot prompt during non-interactive execution` |
| Docker (local) | ✅ | server `28.2.2` |
| GitHub (`gh`) | ✅ as `seanhanca` | `gh auth status` |
| simple-infra repo | ✅ present | `~/mycodespace/simple-infra` (origin `livepeer/simple-infra`) |
| gateway checkout + venv | ✅ | `~/mycodespace/livepeer-python-gateway/.venv` (py3.14), deps import OK |
| orch wallet keystore / passphrase | ❌ **not available** | held in GCP Secret Manager (needs gcloud reauth) |
| amd64 GCP VM to run compose | ❌ **not available** | requires gcloud VM access |

**Net:** local build/probe/e2e work is fully doable; **on-chain deploy is not**, because it
needs GCP VM + Secret Manager (gcloud reauth) + the funded orch wallet + DNS — all infra-owned.
Per the safety guardrails, no fund-spending / wallet / on-chain registration was attempted.

---

## 2. Deploy result — **BLOCKED-pending-infra** (artifacts finalized + committed)

The new orch could not be brought up from this workspace (§1). Instead the deploy artifacts are
**finalized and committed** at `live-runner-v2/`:

- `live-runner-v2/docker-compose.yml` — v0.9.0, `-network=arbitrum-one-mainnet`, keystore mount,
  `-useLiveRunners`, `-pricePerUnit=100`, `-liveRunnerConfig=/etc/livepeer/runners.json`, shared `fal-app`.
- `live-runner-v2/runners.json` — **8 per-cap runners, 8 distinct non-zero wei prices** (validated).
- `live-runner-v2/.env.example` — infra-owned secret template.
- `live-runner-v2/README.md` — the exact VM runbook + blockers.

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

## 3. /discovery pricing evidence (current reality)

The **new orch is not deployed**, so no per-cap `/discovery` yet. Evidence from the existing orchs:

**Existing `liverunner-staging-1` `/discovery`** — only **4 runners, all sharing the flat
`{price_per_unit:100, pixels_per_unit:1, unit:WEI}`** (the "before" state; NOT per-cap):

```
storyboard/ffmpeg-app       price_info {100, 1, WEI}
storyboard/hyperframes-app  price_info {100, 1, WEI}
storyboard/fal-app          price_info {100, 1, WEI}
storyboard/blender-app      price_info {100, 1, WEI}
```

**gRPC `OrchestratorInfo` (what the gateway/payment path actually reads):**

| orch | per-cap `PriceInfo` | `capabilities_prices` | verdict |
|---|---|---|---|
| `liverunner-staging-1` (LR) | **`0/1` for every cap** | **0** | ❌ zero-priced (payment blocker) |
| `byoc-staging-1` (control) | non-zero per cap (e.g. flux-schnell `1060500/1`, flux-dev `8837500/1`, gpt-image `742350/1`, kontext-edit `14140000/1`) | **137** | ✅ fully priced |

→ **Step-3 PASS criterion (8 distinct non-zero per-cap prices) is met by the finalized
`runners.json` (validated), but cannot be observed on a live `/discovery` until the orch is deployed.**

---

## 4. Dual-key E2E — PASS/FAIL per stage

Signer: `pymthouse-signer-test-production.up.railway.app` (health `OK`). Recipient `0x180859c337d1`.
Probes run under the gateway venv via the `pymthouse-e2e` runbook (run50/run55/run57). Secrets env-only.

### 4.1 pymthouse **naap key** path

Credential path **A** (naap key → validate → composite bearer). Because the new orch is blocked, the LR
scenario runs against the existing `liverunner-staging-1`; the priced `byoc-staging-1` is the control.

| Stage | Probe / endpoint | LR orch (`liverunner-staging-1`) | Control (`byoc-staging-1`) |
|---|---|---|---|
| 0 validate | `POST /api/v1/keys/validate` | ✅ **PASS** — `signerSession {url,headers}`, composite `Bearer app_98575870…_pmth_…` (len 105) | (same) ✅ PASS |
| 1 signer auth | `/sign-orchestrator-info` (run57) | ✅ **PASS** — composite ACCEPTED, recipient `0x180859c337d1` | ✅ PASS |
| 2 payment | `/generate-live-payment` (run57 / run50) | ❌ **FAIL** — HTTP 400 `missing or zero priceInfo` (LR `PriceInfo 0/1`) | ✅ **PASS** — `net.Payment` minted, balance `799998939500` |
| 3 generation | `submit_byoc_job` (run50) | ❌ FAIL (downstream of §2) | ✅ **PASS** — HTTP 200, real image `https://v3b.fal.media/files/b/0aa41b77/-17xE7uezUiyoM1ef__wH.jpg` |
| 4 metering | OpenMeter `byoc/<cap>` | ✅ $0 (no payment minted → no delta) | ⚠️ **flat floor** — ~1 µUSD/req at payment-gen, **NOT per-cap/per-unit** (gap F) |

- **Verdict (naap key):** ✅ **the path itself PASSES end-to-end** on a priced orch (validate → auth →
  payment → real fal.media image). Against the LR orch it fails **only on price** (`missing or zero
  priceInfo`), which is exactly what the new `runners.json` fixes.
- **Note (signer reliability):** control payment-gen returned intermittent **HTTP 500 Internal Server
  Error** (failed ~2 of 3 attempts, then PASSED). Signer `/healthz` is OK. Worth a look — flaky
  `/generate-live-payment` on the test-production signer. Owner: **John / pymthouse signer**.

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

- **Is the new orch live + onchain + priced?** ❌ **No — BLOCKED-pending-infra.** Artifacts are
  finalized/committed (`live-runner-v2/`, 8 distinct non-zero prices validated) and ready; go-live
  needs infra-only VM + wallet + DNS (gcloud reauth). It is **not** yet on-chain or serving `/discovery`.
- **Did E2E pass for the naap key?** ✅ **Yes, end-to-end on a priced orch** (validate→auth→payment→image).
  Against the (blocked-substitute) LR orch it fails **only on zero pricing** — the exact gap the new
  `runners.json` closes.
- **Did E2E pass for the Daydream key?** ❌ **No — BLOCKED-need-key** (no real `sk_…` key available).
- **Metering per-cap-correct or flat?** ⚠️ **Flat floor** (~1 µUSD/req at payment-gen), not per-cap /
  per-unit — gap F (owner John / pymthouse metering).

### Top gaps + owners

| # | Gap | Impact | Owner |
|---|-----|--------|-------|
| 1 | **Deploy the new orch** (VM + funded wallet + DNS + gcloud reauth) | No live per-cap-priced onchain LR orch | **John / orch-infra** |
| 2 | **Daydream API key** absent | Daydream-key e2e path cannot run | **Daydream / product (key holder)** |
| 3 | **seedance-mini-i2v price** not in pricing-table (provisional in `runners.json`) | 8th cap price unofficial | **storyboard pricing (gap H)** |
| 4 | **Per-unit USD metering** (charge by MP/s/1000-chars) | Today flat ~1 µUSD floor | **John / pymthouse (gap F)** |
| 5 | **Intermittent signer HTTP 500** on `/generate-live-payment` | Flaky billed payments | **John / pymthouse signer** |
| 6 | **`type=live` session payment** (gateway sends `lv2v`/`byoc` today) | LR-native session billing not exercised | **John (signer image) + gateway owner (gap E)** |
