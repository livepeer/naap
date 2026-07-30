# LR Gateway Rebuild — Owner Handoff Runbook

**Status:** the pymthouse composite → native Live-Runner (LR) path is **one gateway rebuild away** from a full green end-to-end. Everything on the SDK routing/classification side is shipped, live, and verified. The remaining work is **not** an SDK code change — it is a **gateway re-vendor + full base-image rebuild** (Owner 1), then a **signer session-payment verification** (Owner 2).

**Do not re-investigate.** This doc contains the exact refs, tags, commands, evidence, and verification steps. No secrets are included.

- **Environment:** `sdk-staging-1` (GCP `livepeer-simple-infra`, zone `us-west1-b`). Front door: `https://sdk.daydream.monster/inference`.
- **Do NOT touch** `byoc-staging-1` or run `deploy-byoc.sh`.
- **Related history:** `LR-V0.9.0-EXECUTION-REPORT.md` Runs 70 (composite-default), 70b (discovery repoint), 71 (per-model app-name), 72 (this blocker).

---

## 1. CURRENT GREEN STATE — already shipped/live, do NOT redo

| # | Change | Where | Proves |
|---|--------|-------|--------|
| a | **Composite-default cutover** — the composite key `app_*_pmth_*` is the default pymthouse driver, forwarded **DIRECT to the signer** with `/keys/validate` **SKIPPED**; `naap_` front-door + validate RESOLVE path retired. | simple-infra **[#118](https://github.com/livepeer/simple-infra/pull/118)** (merged) | Front-door log: `signer: pymthouse composite DIRECT-to-signer — validate SKIPPED, signer_host=pymthouse-production.up.railway.app`. No `keys/validate` call. |
| b | **LR discovery repoint** — `LR_ORCH_DISCOVERY=https://liverunner-staging-1.daydream.monster:8936/discovery` (retired `:8935` + dead tailnet name). | `sdk-staging-1` `/opt/sdk/.env` | SDK log at boot: `LR offering-driven dispatch ACTIVE: 9 offerings [...]`. Discovery reaches the live v0.9.0 orch (9 offerings, not 0). |
| c | **Per-model app-name mapping** — each fal cap resolves to its per-model app `storyboard/fal-<cap>` (the name the `:8936` orch advertises) instead of the shared `storyboard/fal-app`. Data-driven: `lr_offerings.py` `fal_app_for(cap)`; overridable via `LR_OFFERINGS_JSON`. | simple-infra **[#119](https://github.com/livepeer/simple-infra/pull/119)** (merged) | In-container replay of `_dispatch_lr_v2`'s discovery-match against live `:8936` resolves e.g. `flux-schnell → https://136.66.21.17:8936/apps/runner_riljdzgh/app/generate` (no BYOC fallback at the selection layer). 58 unit tests green. |

**Deployed image on `sdk-staging-1` (currently live / known-good):**

```
SDK_IMAGE=us-docker.pkg.dev/livepeer-simple-infra/simple-infra/sdk-service:optA-lr-multi-dualkey-compositedefault-permodelapp-2026-07-30
# digest sha256:e9ad1652883682895be18a8e02300a2f3d4165127ff468774547269a6c6a2a58
```

Image tag lineage (oldest → newest): `…composite-2026-07-30` → `…compositedefault-2026-07-30` (#118) → **`…compositedefault-permodelapp-2026-07-30` (#119, LIVE)**.

**Relevant live `.env` (already set — do not change for this work):**

```
LR_ORCH_DISCOVERY=https://liverunner-staging-1.daydream.monster:8936/discovery
LR_DESCRIPTOR_DISPATCH=1
SDK_MULTI_ORCH_ENABLED=1
SELECT_PROVIDER_LR_CAPS=flux-dev,flux-schnell,gpt-image,kontext-edit,chatterbox-tts,veo-t2v,pixverse-i2v,seedance-mini-i2v,screen-agent-video-understanding
SELECT_PROVIDER_LR_PCT=100
KEY_PATTERN_PYMTHOUSE=app_*_pmth_*
PYMTHOUSE_SIGNER_URL=https://pymthouse-production.up.railway.app
```

---

## 2. THE BLOCKER — precisely

Native LR dispatch (`_dispatch_lr` and `_dispatch_lr_v2` in `sdk-service-build/app.py`) does:

```python
from livepeer_gateway.live_runner import call_runner
```

…but the **gateway vendored into the deployed image has no `live_runner` module**. So the import raises `ModuleNotFoundError`, the request falls back to BYOC, and BYOC is a **dead end for the pymthouse plane** (the pymthouse signer exposes no BYOC sign endpoint) → **HTTP 502, no asset, no metering**.

**SDK code is correct; the gateway build is stale.**

### Exact failing log chain (`sdk-staging-1`, flux-schnell, funded composite bearer)

```
signer: pymthouse composite DIRECT-to-signer — validate SKIPPED, signer_host=pymthouse-production.up.railway.app
LR dispatch failed for flux-schnell (No module named 'livepeer_gateway.live_runner'); falling back to BYOC
BYOC job 4f8a97e5-…: signing failed: sign-byoc-job failed: HTTP 404: 404 page not found
BYOC job 4f8a97e5-…: payment creation failed …: BYOC payment generation failed: HTTP 400: {"error":{"message":"invalid job type"}}
NoOrchestratorAvailableError: No orchestrator available for capability 'flux-schnell'
```

Client response body (HTTP 502):

```json
{"detail":{"error":"BYOC job rejected by orchestrator https://byoc-staging-1.daydream.monster:8935: No orchestrator available for capability 'flux-schnell': payment failed: BYOC payment generation failed: HTTP 400: {\"error\":{\"message\":\"invalid job type\"}}\n","rejections":[{"url":"https://byoc-staging-1.daydream.monster:8935","reason":"payment failed: BYOC payment generation failed: HTTP 400: {\"error\":{\"message\":\"invalid job type\"}}\n"}]}}
```

The **same** `No module named 'livepeer_gateway.live_runner'` recurs for every paid fal cap (e.g. `chatterbox-tts` repeats it in the same log window) — so this is **not** flux-schnell-specific and **not** the app-name mapping.

### In-container evidence (deployed image)

```
# package dir: /usr/local/lib/python3.12/site-packages/livepeer_gateway
ships: __init__.py, byoc.py, capabilities.py, channel_reader.py, channel_writer.py,
       codegen.py, control.py, errors.py, events.py, lp_rpc_pb2.py, lp_rpc_pb2_grpc.py,
       lv2v.py, media_decode.py, media_output.py, media_publish.py, orch_info.py,
       orchestrator.py, remote_signer.py, scope.py, segment_reader.py, selection.py,
       token.py, trickle_publisher.py, trickle_subscriber.py
       ── NO live_runner.py ──
importlib.util.find_spec("livepeer_gateway.live_runner")  → None
grep -rl call_runner .../livepeer_gateway/                 → NONE
dist: livepeer-gateway 0.1.0
```

### Why the module is missing

The deployed image was built with the vendored gateway checkout on branch **`feat/land-lr-native-dispatch-converge` @ `dad5455`**, which **does not contain** `src/livepeer_gateway/live_runner.py`. The `call_runner` client the SDK imports lives on a **different** gateway branch (see Owner 1).

---

## 3. OWNER 1 — simple-infra build: gateway re-vendor + FULL base rebuild

### The correct gateway ref

`call_runner` (exact symbol the SDK imports) is defined on gateway branch:

```
livepeer/livepeer-python-gateway @ jm/live-runner-session-payments  (bd8e7807b4bf808d0b4b81d6df37636c848f1f04)
  src/livepeer_gateway/live_runner.py  line 624
  async def call_runner(runner_url="", *, runner=None, payload=None, method="POST",
                        signer_url=None, signer_headers=None, timeout=5.0,
                        max_payment_challenge_retries=3) -> LiveRunnerCallResult
```

This matches `app.py`'s call exactly: `call_runner(runner_url=base + "/generate", payload=lr_payload, signer_url=signer_url, signer_headers=signer_headers, timeout=600)` and `return result.data`. The branch also carries the session-payment client (`LiveRunnerSession`, `LivePaymentSession`, `run_session_payments`, `get_signer_info`, payment-challenge retries).

> **OPEN QUESTION — build owner must decide (do NOT assume):** vendor `jm/live-runner-session-payments` **as-is**, OR **merge** it with `feat/land-lr-native-dispatch-converge` (`dad5455`) so the native-dispatch "converge" changes that produced the current byte-converged image are preserved alongside `live_runner.py`. Whether `dad5455`'s converge changes are already in / compatible with `jm/live-runner-session-payments`, or must be merged in, needs the gateway/build owner's confirmation. Pick the ref that has **both** `live_runner.py` **and** the intended converge behavior.

### Why a FULL base-image rebuild is required (not a thin overlay)

The gateway is **baked** into the image via the Dockerfile:

```dockerfile
COPY livepeer-gateway/ /sdk/
RUN pip install --no-cache-dir /sdk/
```

A thin overlay (like #119, which only `COPY`s `app.py`/`lr_offerings.py` onto an existing base) will **NOT** pick up the new gateway module — `pip install /sdk/` must re-run. So this is a from-scratch `docker build` of `sdk-service-build/` (base `python:3.12-slim`; note the gateway session-payments ref requires **Python ≥ 3.12**, which the base already is).

### Exact commands

```bash
# --- in the simple-infra repo root ---

# 1) Re-vendor the gateway to the ref that has live_runner.py (see OPEN QUESTION above).
#    Helper clones (git-ignored) into sdk-service-build/livepeer-gateway and records .gateway-ref.
GATEWAY_REPO=https://github.com/livepeer/livepeer-python-gateway \
  ./scripts/pin-sdk-gateway.sh jm/live-runner-session-payments
#   (or: ./scripts/pin-sdk-gateway.sh <merged-ref-sha>  if the build owner merges with dad5455)

# 2) VERIFY the module is now present in the vendored checkout BEFORE building.
cat sdk-service-build/.gateway-ref
ls  sdk-service-build/livepeer-gateway/src/livepeer_gateway/live_runner.py   # must exist
grep -n "def call_runner" sdk-service-build/livepeer-gateway/src/livepeer_gateway/live_runner.py

# 3) FULL base-image rebuild (Cloud Build; re-runs COPY + pip install /sdk/).
#    Tag encodes the gateway ref for provenance.
gcloud builds submit --project livepeer-simple-infra \
  --tag us-docker.pkg.dev/livepeer-simple-infra/simple-infra/sdk-service:optA-lr-liverunner-sessionpay-bd8e7807-2026-07-30 \
  sdk-service-build/

# 4) Deploy to sdk-staging-1 — recreate sdk-service ONLY, with a timestamped backup.
NEW=us-docker.pkg.dev/livepeer-simple-infra/simple-infra/sdk-service:optA-lr-liverunner-sessionpay-bd8e7807-2026-07-30
gcloud compute ssh sdk-staging-1 --zone us-west1-b --project livepeer-simple-infra --tunnel-through-iap --command "
  set -e
  TS=\$(date +%Y%m%d-%H%M%S)
  sudo cp -a /opt/sdk/.env               /opt/sdk/.env.bak-\$TS
  sudo cp -a /opt/sdk/docker-compose.yaml /opt/sdk/docker-compose.yaml.bak-\$TS
  sudo sed -i \"s#^SDK_IMAGE=.*#SDK_IMAGE=$NEW#\" /opt/sdk/.env
  cd /opt/sdk && sudo docker compose up -d --force-recreate --no-deps sdk-service"

# 4a) If `docker compose up` cannot pull (docker-credential-gcloud snap helper is flaky on this VM),
#     pre-pull with a metadata-server token, then re-run step 4's compose command:
gcloud compute ssh sdk-staging-1 --zone us-west1-b --project livepeer-simple-infra --tunnel-through-iap --command "
  TOKEN=\$(curl -s -H 'Metadata-Flavor: Google' 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' | python3 -c 'import sys,json;print(json.load(sys.stdin)[\"access_token\"])')
  AUTH=\$(printf 'oauth2accesstoken:%s' \"\$TOKEN\" | base64 -w0)
  sudo mkdir -p /tmp/dkr
  printf '{\"auths\":{\"us-docker.pkg.dev\":{\"auth\":\"%s\"}}}' \"\$AUTH\" | sudo tee /tmp/dkr/config.json >/dev/null
  sudo docker --config /tmp/dkr pull $NEW
  sudo rm -rf /tmp/dkr"
```

### Confirm the module shipped (post-deploy, before the e2e)

```bash
gcloud compute ssh sdk-staging-1 --zone us-west1-b --project livepeer-simple-infra --tunnel-through-iap --command '
  CID=$(sudo docker compose -f /opt/sdk/docker-compose.yaml ps -q sdk-service)
  sudo docker inspect --format "{{.Config.Image}}" $CID
  sudo docker exec $CID python3 -c "import importlib.util as u; print(\"live_runner spec:\", u.find_spec(\"livepeer_gateway.live_runner\"))"
  sudo docker exec $CID python3 -c "from livepeer_gateway.live_runner import call_runner; print(\"call_runner OK:\", call_runner)"'
# PASS = spec is not None AND `call_runner OK: <function ...>` (no ImportError).
```

### REGRESSION CHECKLIST (the whole SDK swaps — verify each)

- **Health / discovery:** `GET /healthz`-equivalent 200; `/capabilities` count sane (was **172**); boot log shows `LR offering-driven dispatch ACTIVE: 9 offerings`.
- **Daydream `sk_` / lv2v path:** an `sk_` bearer still routes to the STATIC signer (NOT composite DIRECT); live-video / lv2v start works (gateway `lv2v.py` unchanged in behavior).
- **BYOC caps on `byoc-staging-1`:** a normal BYOC cap still submits + pays (gateway `byoc.py`); do NOT redeploy byoc — just confirm the SDK still drives it.
- **Composite-default DIRECT (#118):** composite bearer still logs `DIRECT-to-signer — validate SKIPPED`, no `/keys/validate`.
- **Per-model app-name (#119):** `_dispatch_lr_v2` still selects `storyboard/fal-<cap>` runners on `:8936`.
- **Merit / offerings / native-dispatch defaults:** unchanged flags (`LR_DESCRIPTOR_DISPATCH=1`, `SELECT_PROVIDER_LR_*`).

### Rollback (revert to the current known-good image)

```bash
GOOD=us-docker.pkg.dev/livepeer-simple-infra/simple-infra/sdk-service:optA-lr-multi-dualkey-compositedefault-permodelapp-2026-07-30
gcloud compute ssh sdk-staging-1 --zone us-west1-b --project livepeer-simple-infra --tunnel-through-iap --command "
  sudo sed -i \"s#^SDK_IMAGE=.*#SDK_IMAGE=$GOOD#\" /opt/sdk/.env
  cd /opt/sdk && sudo docker compose up -d --force-recreate --no-deps sdk-service"
```

Existing timestamped backups on the VM (from the #119 deploy):

```
/opt/sdk/.env.bak-20260730-023907
/opt/sdk/docker-compose.yaml.bak-20260730-023907
```

(Plus whatever `.env.bak-<TS>` / `docker-compose.yaml.bak-<TS>` Owner 1's own deploy in step 4 creates — prefer restoring that if rolling back your own change.)

---

## 4. OWNER 2 — pymthouse signer: verify session-payment mint (AFTER Owner 1)

Once the gateway ships `call_runner`, the paid single-shot LR call performs a **session-payment handshake against `PYMTHOUSE_SIGNER_URL` = `https://pymthouse-production.up.railway.app`**. From `live_runner.py`:

1. `get_signer_info(signer_url, headers)` — reads signer identity/address.
2. POST the payload to the runner (`…/app/generate`). If the runner returns a **payment challenge** (402-style), `call_runner` parses it (`_parse_runner_payment_challenge`, keyed by `manifest_id`), **builds a payment via the signer**, and retries (up to `max_payment_challenge_retries=3`; `run_session_payments` keeps a held session funded).

**The deployed pymthouse signer must support this challenge/mint protocol for a paid LR call.** This is the same class of gap as the earlier "signer lacks merged fixed+byoc support." **It may still block even after the gateway rebuild** — if so, that is a signer-side deliverable; do **not** patch it from the SDK/gateway side.

### Verification step (run after Owner 1's e2e in §5)

Inspect `sdk-staging-1` SDK logs for the flux-schnell request and look for the LR (not BYOC) path completing a signed payment:

```bash
gcloud compute ssh sdk-staging-1 --zone us-west1-b --project livepeer-simple-infra --tunnel-through-iap --command '
  CID=$(sudo docker compose -f /opt/sdk/docker-compose.yaml ps -q sdk-service)
  sudo docker logs --tail 200 $CID 2>&1 | grep -iE "DIRECT|call_runner|payment|challenge|ticket|runner_|storyboard/fal|LR dispatch|byoc|manifest"'
```

**PASS looks like:** DIRECT fires → LR path selects the `storyboard/fal-flux-schnell` runner on `:8936` → payment challenge satisfied against the signer (**signer HTTP 200, a signed ticket minted / `numTickets` ≥ 1 in the expected range**) → runner returns an asset. **No** `No module named …`, **no** BYOC fallback, **no** `sign-byoc-job 404`, **no** `invalid job type`.

**FAIL (signer-side) looks like:** the challenge/mint call to `pymthouse-production` returns non-200 (e.g. 404 on the payment endpoint, 400 `invalid manifest`, or exhausts `payment challenge retries`). That is Owner 2's fix (add session-payment mint support to the deployed signer).

---

## 5. FINAL VERIFY — once BOTH owners are done

**One-line front-door e2e** (handle the funded composite bearer **in-memory only** — never write it to a file, commit, log, doc, or the VM):

```bash
# COMPOSITE_BEARER is a FUNDED composite app key of the form: Bearer app_<appId>_pmth_<secret>
curl -sk https://sdk.daydream.monster/inference \
  -H "Authorization: $COMPOSITE_BEARER" -H 'Content-Type: application/json' \
  -d '{"capability":"flux-schnell","prompt":"a red bicycle on a white background"}'
```

**Expected chain (FULL PASS):**
1. **DIRECT** — `signer: pymthouse composite DIRECT-to-signer — validate SKIPPED, signer_host=pymthouse-production.up.railway.app`.
2. **Per-model LR runner on `:8936`** — dispatch hits `https://136.66.21.17:8936/apps/runner_riljdzgh/app/generate` (`storyboard/fal-flux-schnell`); **no BYOC fallback**.
3. **Real asset** — HTTP 200 with an asset URL in the response (`image_url`).
4. **Pymthouse debit** — a signed payment/ticket minted for the composite app (see below).

Then try a **second cap** to confirm the mapping generalizes, e.g. `veo-t2v` (`storyboard/fal-veo-t2v` → `…/runner_mv3woqug/app/generate`) or `chatterbox-tts` (`storyboard/fal-chatterbox-tts` → `…/runner_pzw25w7w/app/generate`).

### Reading the usage debit

The **composite app key cannot read usage.** Confirm the debit in two tiers:

- **Signed-payment tier (from SDK logs, always available):** `call_runner` completed + the signer returned a signed ticket / `numTickets` ≥ 1 (§4 verification). This confirms "asset + signed payment."
- **Usage-API tier (authoritative debit read):** requires the pymthouse **`pmth_cs_…` OIDC/M2M secret** (client-secret credential), NOT the composite app key. Query the pymthouse usage/billing API with `pmth_cs_…` and confirm a debit entry for the app/`appId` matching the mint (amount / `numTickets`).

**Do NOT block FULL PASS on the usage-API read** if the signed-ticket/payment leg is confirmed — clearly distinguish **"asset + signed payment confirmed"** from **"usage-API debit read confirmed."**

---

## Quick reference

| Item | Value |
|------|-------|
| Front door | `https://sdk.daydream.monster/inference` |
| VM | `sdk-staging-1` (`livepeer-simple-infra`, `us-west1-b`) |
| Live/known-good image | `sdk-service:optA-lr-multi-dualkey-compositedefault-permodelapp-2026-07-30` (`sha256:e9ad165…`) |
| Gateway repo | `github.com/livepeer/livepeer-python-gateway` |
| Vendored ref in live image (STALE — no live_runner) | `feat/land-lr-native-dispatch-converge` @ `dad5455` |
| Ref with `call_runner` | `jm/live-runner-session-payments` @ `bd8e7807` (`src/livepeer_gateway/live_runner.py:624`) |
| Signer | `PYMTHOUSE_SIGNER_URL=https://pymthouse-production.up.railway.app` |
| LR discovery | `https://liverunner-staging-1.daydream.monster:8936/discovery` |
| Pin helper | `simple-infra/scripts/pin-sdk-gateway.sh <ref>` |
| Dockerfile | `simple-infra/sdk-service-build/Dockerfile` (`COPY livepeer-gateway/ /sdk/` → `pip install /sdk/`) |
| PRs shipped | simple-infra #118 (composite-default), #119 (per-model app-name) |
| Do NOT touch | `byoc-staging-1`, `deploy-byoc.sh` |

_No secrets in this document. Bearer used during Run 72 was held in-memory only and never persisted._
