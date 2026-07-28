# LR one-orch → many-runner setup (one runner per fal capability, each with its own descriptor price)

> Date: 2026-07-28 · Author: seanhanca (agent) · **Read-only for product code** — this doc authors
> config only; no infra deploys were run.
> Goal: concrete setup to stand up a **NEW** Live-Runner (LR) orchestrator that adopts the
> **one-orchestrator → many-runners** architecture — **one runner per fal capability**, each runner
> advertising **its own per-cap price** from the capability descriptor — wired to the **CURRENT
> existing fal capabilities**.
> Builds on the verified ground truth in `LR-V0.9.0-ONCHAIN-ASSESSMENT.md` (do not re-derive):
> LR is **onchain** today (100-wei `price_info` on all 4 runners); **v0.9.0** contains the LR pricing
> stack (`{price,currency,unit}` schema, `runnerOrchInfo` bridge, signer `type=live`, USD→wei,
> `SessionPriceInfo`+`"fixed"` for single-shot) **but NOT the G1 fix** (`GetCapabilitiesPrices` still
> ignores the LR registry → byoc gRPC `capabilities_prices[]` stays empty for LR caps).

---

## 0. TL;DR — topology + what's deployable now

**Today (one runner, many caps):** a single `storyboard/fal-app` runner serves all 8 fal caps by
per-call `model_id` at **one flat runner price** (live: `{price_per_unit:100, pixels_per_unit:1,
unit:WEI}`). Caps cannot be priced differently — the runner advertises one `price_info`.

**Target (one orch → many runners, one runner per cap):** the NEW orch registers **8 runners**, one
per fal cap. Each runner is bound to a single fal `model_id` and advertises **its own** `price_info`
(the cap's descriptor price). `/discovery` then shows a distinct non-zero price per cap.

```
                         NEW LR orchestrator  (livepeer/go-livepeer:v0.9.0, arbitrum-one-mainnet, onchain)
                         -useLiveRunners  -pricePerUnit=100  keystore wallet  serviceAddr:8935
                         GET /discovery  →  [ 8 runners, each with its OWN price_info ]
   ┌──────────────────────────────────────────────────────────────────────────────────────────┐
   │  runner: storyboard/fal-flux-schnell   model_id fal-ai/flux/schnell     price = flux-schnell price   │
   │  runner: storyboard/fal-flux-dev       model_id fal-ai/flux/dev         price = flux-dev price        │
   │  runner: storyboard/fal-gpt-image      model_id fal-ai/gpt-image-1/…    price = gpt-image price        │
   │  runner: storyboard/fal-kontext-edit   model_id fal-ai/flux-pro/kontext price = kontext-edit price     │
   │  runner: storyboard/fal-pixverse-i2v   model_id fal-ai/pixverse/v4/…    price = pixverse-i2v price     │
   │  runner: storyboard/fal-seedance-mini  model_id bytedance/seedance-2.0/…price = seedance price (GAP)   │
   │  runner: storyboard/fal-veo-t2v        model_id fal-ai/veo3.1/fast      price = veo-t2v price          │
   │  runner: storyboard/fal-chatterbox-tts model_id fal-ai/chatterbox/…     price = chatterbox price       │
   └──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Deployable NOW (zero product-code change):** stand up the new orch on the **v0.9.0** image, onchain
(arbitrum + keystore + `-pricePerUnit=100`), with **`-liveRunnerConfig runners.json`** declaring the 8
runners each with its own `price_info` (per-cap wei). This makes `/discovery` advertise **per-cap
non-zero prices** and lets the **LR-native session-payment path** bill (single-shot `"fixed"` per-call).
It does **not** reach byoc per-cap-USD parity and does **not** meter per output unit — see §4.

**Residual gaps (need code / infra — not solved by this topology alone):** G1 (LR→`capabilities_prices`
so the byoc gRPC path sees LR prices), signer `type=live` on the **billed pymthouse DMZ signer** +
gateway sending `type=live`, and per-unit USD metering (charge by megapixels / seconds / chars, not a
flat per-call floor). Owners in §4.

---

## 1. Fal capability inventory (the caps to onboard)

The 8 caps the `storyboard/fal-app` runner serves today (authoritative list:
`simple-infra/sdk-service-build/app.py:131-141` `LR_MODEL_IDS`; validated in
`simple-infra/live-runner/fal-app/README.md:10-21`; dual-homed in
`NaaP/apps/web-next/src/lib/orchestrator-leaderboard/storyboard-default-plan.ts:104-118`).

There are **no standalone CapabilityDescriptor JSON files** with `offering.price` for these caps. The
per-cap price lives in the pricing table (`storyboard-a3/docs/pricing-v1/pricing-table.json`,
`display_price_usd` + `unit_kind`) and its on-chain wire form
(`storyboard-a3/docs/pricing-v1/CAPABILITIES_JSON.byoc.json`, `price_per_unit`/`pixels_per_unit` in wei).
The descriptor `PriceSchema` shape they must be expressed in is
`storyboard-a3/lib/capabilities/descriptor.ts:105-113` (`{price_per_unit, pixels_per_unit, unit, display_usd, display_unit}`).

| # | cap id | fal `model_id` (LR) | modality | `unit_kind` | descriptor price (`display_price_usd`) | on-chain wire `price_per_unit` / `pixels_per_unit` (wei) |
|---|--------|---------------------|----------|-------------|----------------------------------------|-----------------------------------------------------------|
| 1 | `flux-schnell` | `fal-ai/flux/schnell` | image (t2i) | **megapixel** | $0.00315 / MP | `1284088677165 / 1048576` |
| 2 | `flux-dev` | `fal-ai/flux/dev` | image (t2i) | **megapixel** | $0.02625 / MP | `10700738976372 / 1048576` |
| 3 | `gpt-image` | `fal-ai/gpt-image-1/text-to-image` | image (t2i) | **image** | $0.0022 / image | `898862074015 / 1048576`¹ |
| 4 | `kontext-edit` | `fal-ai/flux-pro/kontext` | image (edit) | **image** | $0.042 / image | `17121182362196 / 1048576`¹ |
| 5 | `pixverse-i2v` | `fal-ai/pixverse/v4/image-to-video` | video (i2v) | **second** | $0.063 / s | `3246683470165 / 8294400`² |
| 6 | `seedance-mini-i2v` | `bytedance/seedance-2.0/mini/image-to-video` | video (i2v) | **second** | **$0.0394 / s (docs-only; GAP)**³ | **absent from pricing-table / byoc wire (GAP)** |
| 7 | `veo-t2v` | `fal-ai/veo3.1/fast` | video (t2v) | **second** | $0.42 / s | `21644556467764 / 8294400`² |
| 8 | `chatterbox-tts` | `fal-ai/chatterbox/text-to-speech` | audio (tts) | **characters** | $0.02625 / 1000 chars | `112205380728886 / 100000` |

¹ `gpt-image`/`kontext-edit` are priced **per image** but the byoc wire encodes them with
`pixels_per_unit=1048576` (per-MP basis) too — the byoc adapter treats one call as one unit. `model_id`
drift exists: pricing-table has `openai/gpt-image`; the LR runner uses fal's `fal-ai/gpt-image-1/text-to-image`.
² Video wire uses `pixels_per_unit=8294400` as the per-second basis.
³ `seedance-mini-i2v` is in the registry with **null** display price and documented at $0.0394/s in
`storyboard-a3/LIVE-RUNNER-ORCH-IMPL-PLAN.html:367`, but is **missing** from `pricing-table.json`,
`static-pricing.json`, and `CAPABILITIES_JSON.byoc.json`. Its price must be finalized before onboarding
(owner: storyboard descriptor / pricing — see §4 gap H).

> **Wire caveat:** the exact wei values are `display_price_usd` converted at a fixed reference ETH price
> at table-generation time. On the new onchain orch you should either (a) reuse these wei literals as
> the runner `price_info` (fast, static), or (b) register the runner in **USD** (`unit:"USD"`) and let
> the orch's Chainlink converter compute wei live (preferred, tracks ETH). See §2.3.

---

## 2. Topology design — one orch → many runners

### 2.1 Mapping: cap → runner → advertised price

Each fal cap becomes its **own runner registration** on the single new orch. The runner is bound to one
`model_id` and carries the cap's descriptor `price_info`. Recommended runner `app` id = `storyboard/fal-<cap>`
(distinct per cap so `/discovery` and the SDK offering filter can target it).

| cap | runner `app` id | bound `model_id` | advertised `price_info` (recommended: USD unit) | wei fallback (static) |
|-----|-----------------|------------------|-------------------------------------------------|-----------------------|
| flux-schnell | `storyboard/fal-flux-schnell` | `fal-ai/flux/schnell` | `{price:0.00315, currency:USD, unit:megapixel}` | `{price_per_unit:1284088677165, pixels_per_unit:1048576, unit:WEI}` |
| flux-dev | `storyboard/fal-flux-dev` | `fal-ai/flux/dev` | `{price:0.02625, currency:USD, unit:megapixel}` | `{10700738976372, 1048576, WEI}` |
| gpt-image | `storyboard/fal-gpt-image` | `fal-ai/gpt-image-1/text-to-image` | `{price:0.0022, currency:USD, unit:image}` | `{898862074015, 1048576, WEI}` |
| kontext-edit | `storyboard/fal-kontext-edit` | `fal-ai/flux-pro/kontext` | `{price:0.042, currency:USD, unit:image}` | `{17121182362196, 1048576, WEI}` |
| pixverse-i2v | `storyboard/fal-pixverse-i2v` | `fal-ai/pixverse/v4/image-to-video` | `{price:0.063, currency:USD, unit:second}` | `{3246683470165, 8294400, WEI}` |
| seedance-mini-i2v | `storyboard/fal-seedance-mini-i2v` | `bytedance/seedance-2.0/mini/image-to-video` | `{price:0.0394, currency:USD, unit:second}` **(pending)** | **TBD (gap H)** |
| veo-t2v | `storyboard/fal-veo-t2v` | `fal-ai/veo3.1/fast` | `{price:0.42, currency:USD, unit:second}` | `{21644556467764, 8294400, WEI}` |
| chatterbox-tts | `storyboard/fal-chatterbox-tts` | `fal-ai/chatterbox/text-to-speech` | `{price:0.02625, currency:USD, unit:1000-chars}` | `{112205380728886, 100000, WEI}` |

### 2.2 How v0.9.0's LR runner advertises price today vs the descriptor per-unit price

- **Runner-level, not cap-level.** The LR runner posts ONE `price_info` per **runner registration**
  (`ai/runner/live_runner.go` `LiveRunnerPriceInfo`; discovery serializer `discoveryRunner()`; heartbeat
  requires a positive price when onchain). Because today's `fal-app` registers **once** for all 8 caps,
  all 8 share one price. **The fix is structural: register once per cap** (this topology) so "runner-level
  price" == "cap-level price."
- **Unit basis.** LR's native billing is **time-metered at 720p@30fps** — a runner's USD price is
  interpreted as **USD/hour**, converted to **wei per 720p-pixel-second**
  (`usdPerPixelFromUSDPerHour`: `pixelsPerHour = 1280·720·30·3600`; `newConverterForRunner`). For
  **single-shot** apps (all 8 fal caps register `mode:"single-shot"`), v0.9.0 adds `SessionPriceInfo`
  + a **`"fixed"`** unit → a **fixed price per call/session** rather than elapsed-seconds
  (`server/ai_http.go` `PaymentForLiveRunnerSession`, per `LR-V0.9.0-ONCHAIN-ASSESSMENT.md:160`).

### 2.3 The unit mismatch and how to bridge it

The descriptor unit is **per megapixel / per image / per second / per 1000 chars**; LR's native unit is
**720p-pixel-second (time)** or, for single-shot, **fixed-per-call**. Bridge, per modality:

| descriptor unit | LR single-shot bridge | Parity? |
|-----------------|-----------------------|---------|
| **per image** (`gpt-image`, `kontext-edit`) | fixed price per call == per image | ✅ **Exact** — 1 call = 1 image |
| **per megapixel** (`flux-schnell`, `flux-dev`) | fixed price per call, set at a **reference resolution** (e.g. 1 MP) | ⚠️ **Approx** — exact only at the reference MP; larger/smaller outputs over/under-charge until per-unit metering (gap F) |
| **per second** (`pixverse-i2v`, `veo-t2v`, `seedance-mini-i2v`) | fixed price per call, set at a **reference duration** (e.g. 5 s) | ⚠️ **Approx** — flat per clip; duration not metered (gap F) |
| **per 1000 chars** (`chatterbox-tts`) | fixed price per call, set at a **reference length** | ⚠️ **Approx** — length not metered (gap F) |

**Bottom line:** advertising a per-cap **non-zero** price via `/discovery` (which unblocks the
"missing or zero priceInfo" failure) works **now** for all 8 caps. **Billed-amount correctness** is
exact only for the per-image caps; per-MP/second/char caps bill a fixed reference amount until the
per-unit USD metering seam is added (gap F, owner John/pymthouse). This is a **quantity-metering** gap,
not a topology gap.

### 2.4 Recommended registration mechanism

Two ways to register 8 per-cap runners. Recommendation: **Path A (static `-liveRunnerConfig`)** — zero
product-code change, fully declarative, one price per runner.

- **Path A — static registry JSON (deployable now, no code change).** The orch loads
  `-liveRunnerConfig runners.json` at startup (`cmd/livepeer/starter/starter.go:2016-2037`;
  runner-config schema `ai/runner/live_runner.go:99-115`). Declare 8 runners, each with a distinct `app`,
  `mode:"single-shot"`, its own `price_info`, and a `runner_url` that serves `/generate`. The
  `runner_url` can point at **one shared `fal-app` container** (all 8 runners proxy the same fal service;
  the bound `model_id` is injected by the SDK offering per cap) or at **per-cap containers**. Static
  registration needs **no** `--price`/`--app` code change to `fal-app`.
- **Path B — dynamic per-cap containers (needs a small `fal-app` change).** Run 8 `fal-app` services,
  each invoked with `--app storyboard/fal-<cap>`, `--model-id <fal model>`, `--price <usd> --currency USD
  --unit <unit>`. Today `fal-app/app.py:31` hardcodes `APP_ID` and `_parse_args` only accepts `--price`
  (a bare float, no currency/unit) — so Path B requires a **product-code change** (§4 gap C-code). Not
  deployable without that change.

---

## 3. Concrete config artifacts

> These are **authoring templates**. Values marked `⟨…⟩` / `${…}` are infra secrets or VM-local values
> that **infra/John must supply** (wallet keystore, arbitrum RPC URL, passphrase, DNS). Do **not**
> invent them. Where an image tag/digest is needed, use `livepeer/go-livepeer:v0.9.0`
> (`sha256:27464aa2…` per the assessment) — infra should re-confirm the digest at deploy.

### 3.1 New onchain LR orchestrator — `simple-infra/live-runner-v2/docker-compose.yml`

Onchain LR orch (merges the LR flags from `live-runner/docker-compose.yml:13-42` with the onchain
wallet/pricing flags from `docker-compose/byoc-stack.yaml:1-27` and `pulumi/__main__.py:169-189`).
Key deltas vs the current stale offchain compose: **v0.9.0 image**, `-network=arbitrum-one-mainnet`,
keystore mount + `-ethUrl`/`-ethPassword`/`-ethOrchAddr`, `-pricePerUnit=100`, `-ticketEV`, and
`-liveRunnerConfig` for the 8 static per-cap runners.

```yaml
# simple-infra/live-runner-v2/docker-compose.yml
# NEW onchain Live-Runner orchestrator — one-orch → many-runner (one runner per fal cap).
# amd64-only image; VM MUST be amd64. Front :443 with the standalone Caddy container (see 3.4).
services:
  orchestrator:
    image: livepeer/go-livepeer:v0.9.0        # re-confirm digest sha256:27464aa2… at deploy
    container_name: liverunner-v2-orch
    command:
      - -orchestrator
      - -useLiveRunners
      - -liveRunnerConfig=/etc/livepeer/runners.json   # the 8 per-cap runners (3.3)
      # onchain identity (same wallet mechanism as byoc)
      - -network=arbitrum-one-mainnet
      - -ethUrl=${ARB_RPC_URL}                 # infra secret
      - -ethPassword=/pw.txt                   # mounted below
      - -ethOrchAddr=${ETH_ORCH_ADDR}          # infra secret (orch on-chain address)
      - -pricePerUnit=100                      # orch base price (wei); per-cap prices come from runners.json
      - -ticketEV=800000000000
      # discovery / addressing (serviceAddr is self-probed at boot — use the orch's own public :8935)
      - -serviceAddr=${LR_HOSTNAME:-liverunner-v2-staging-1.daydream.monster}:8935
      - -httpAddr=0.0.0.0:8935
      - -liveRunnerAddr=https://orchestrator:8935
      - -orchSecret=${LR_ORCH_SECRET}
      - -monitor=true
      - -v=6
    ports:
      - "8935:8935"
    restart: always
    volumes:
      - ./keystore:/root/.lpData/arbitrum-one-mainnet/keystore:ro   # wallet JSON (infra-supplied)
      - ./password.txt:/pw.txt:ro                                   # passphrase (infra-supplied)
      - ./runners.json:/etc/livepeer/runners.json:ro
    healthcheck:
      test: printf 'GET /healthz HTTP/1.0\r\n\r\n' | openssl s_client -connect 127.0.0.1:8935 -quiet 2>/dev/null | grep -q '200 OK'
      interval: 3s
      timeout: 3s
      retries: 40
      start_period: 5s

  # ONE shared fal proxy; the 8 runners in runners.json all point their runner_url here.
  # (Per-cap containers are optional — see Path B; not required for static registration.)
  fal-app:
    build: ../live-runner/fal-app
    container_name: liverunner-v2-fal-app
    depends_on:
      orchestrator:
        condition: service_healthy
    environment:
      - FAL_KEY=${FAL_KEY:?set FAL_KEY in live-runner-v2/.env (same value as BYOC FAL_API_KEY)}
      - ORCH_SECRET=${LR_ORCH_SECRET}
    command:
      - --orchestrator=https://orchestrator:8935
      - --orchSecret=${LR_ORCH_SECRET}
      - --runner-url=http://fal-app:8990
    restart: always
```

> **Note on `-liveRunnerConfig` field names:** the static-registry schema above is taken from the
> `glp-combine` branch (`ai/runner/live_runner.go:99-115`). Field names (`price_info` vs
> `{price,currency,unit}`) may differ slightly on the exact **v0.9.0** tag. Infra should confirm against
> the v0.9.0 image (`docker run --rm livepeer/go-livepeer:v0.9.0 -help 2>&1 | grep -i liveRunner`) and
> adjust `runners.json` accordingly. If v0.9.0 static config is USD-native, prefer the `{price,currency,unit}`
> form; otherwise use the wei `price_info` form.

### 3.2 Alternative: Pulumi entry (if managing via IaC instead of manual VM)

The Pulumi orch template (`pulumi/__main__.py:169-189`) already emits an onchain arbitrum orch with
keystore + `-pricePerUnit=100`, and appends `-useLiveRunners` when `orchUseLiveRunners: "true"`
(`__main__.py:354-359`, `Pulumi.staging.yaml:15-16`). To use it for this topology, infra would:
add a `-liveRunnerConfig` line to the `extra_flag_lines` block and ship `runners.json` alongside
`aiModels.json` (both mounted read-only). This is a **small infra-owned template edit**, not product code.

### 3.3 The 8 per-cap runners — `simple-infra/live-runner-v2/runners.json`

Static registry consumed by `-liveRunnerConfig`. Each entry = one runner = one cap = one price.
`app` uses the `<pipeline>/<model_id>` convention parsed by `capabilityModelFromApp`
(`remote_discovery.go:348-357`). Wei `price_info` values are the byoc-wire references from §1.

```json
{
  "runners": [
    { "label": "fal-flux-schnell", "app": "storyboard/fal-flux-schnell",
      "runner_url": "http://fal-app:8990", "mode": "single-shot", "capacity": 4,
      "price_info": { "price_per_unit": 1284088677165, "pixels_per_unit": 1048576, "unit": "WEI" } },
    { "label": "fal-flux-dev", "app": "storyboard/fal-flux-dev",
      "runner_url": "http://fal-app:8990", "mode": "single-shot", "capacity": 4,
      "price_info": { "price_per_unit": 10700738976372, "pixels_per_unit": 1048576, "unit": "WEI" } },
    { "label": "fal-gpt-image", "app": "storyboard/fal-gpt-image",
      "runner_url": "http://fal-app:8990", "mode": "single-shot", "capacity": 4,
      "price_info": { "price_per_unit": 898862074015, "pixels_per_unit": 1048576, "unit": "WEI" } },
    { "label": "fal-kontext-edit", "app": "storyboard/fal-kontext-edit",
      "runner_url": "http://fal-app:8990", "mode": "single-shot", "capacity": 4,
      "price_info": { "price_per_unit": 17121182362196, "pixels_per_unit": 1048576, "unit": "WEI" } },
    { "label": "fal-pixverse-i2v", "app": "storyboard/fal-pixverse-i2v",
      "runner_url": "http://fal-app:8990", "mode": "single-shot", "capacity": 4,
      "price_info": { "price_per_unit": 3246683470165, "pixels_per_unit": 8294400, "unit": "WEI" } },
    { "label": "fal-veo-t2v", "app": "storyboard/fal-veo-t2v",
      "runner_url": "http://fal-app:8990", "mode": "single-shot", "capacity": 4,
      "price_info": { "price_per_unit": 21644556467764, "pixels_per_unit": 8294400, "unit": "WEI" } },
    { "label": "fal-chatterbox-tts", "app": "storyboard/fal-chatterbox-tts",
      "runner_url": "http://fal-app:8990", "mode": "single-shot", "capacity": 4,
      "price_info": { "price_per_unit": 112205380728886, "pixels_per_unit": 100000, "unit": "WEI" } }
  ]
}
```

> `seedance-mini-i2v` is intentionally **omitted** until its price is finalized (gap H). Add once
> `pricing-table.json` carries it, e.g.
> `{"label":"fal-seedance-mini-i2v","app":"storyboard/fal-seedance-mini-i2v","runner_url":"http://fal-app:8990","mode":"single-shot","capacity":4,"price_info":{ …TBD… }}`.

**SDK routing:** point the SDK's offering filter at the per-cap `app` ids. Today
`sdk-service-build/lr_offerings.py` builds offerings with a single `FAL_APP="storyboard/fal-app"`; for
per-cap runners set each offering's `app` to `storyboard/fal-<cap>` (via `LR_OFFERINGS_JSON` override,
which `load_offerings()` already supports — `lr_offerings.py:47-76`). No SDK code change required if the
override JSON is supplied.

### 3.4 TLS / DNS — steps for infra/John (no values invented)

Same two-layer pattern as the current LR VM (`live-runner/Caddyfile:11-17`, `live-runner/README.md`):

1. **DNS A record** — create `liverunner-v2-staging-1.daydream.monster → ⟨VM static IP⟩` (Cloudflare
   zone `daydream.monster`, or Pulumi auto-creates it via `__main__.py:478-487` if IaC-managed).
2. **Orch self-signed HTTPS on :8935** — already served by the container; `-serviceAddr` must be
   reachable by the orch itself at boot (GCP hairpin OK).
3. **Caddy Let's Encrypt on :443** (public cert):
   ```
   liverunner-v2-staging-1.daydream.monster {
       reverse_proxy https://localhost:8935 { transport http { tls_insecure_skip_verify } }
   }
   ```
   `sudo docker run -d --name liverunner-v2-caddy --network host --restart always -v ~/Caddyfile:/etc/caddy/Caddyfile:ro -v caddy_data:/data caddy:2`

### 3.5 Deploy steps — for infra/John (do NOT run from here)

```bash
# On an amd64 GCP VM in livepeer-simple-infra, from simple-infra/live-runner-v2/
# 1. Supply secrets (infra-owned, NOT in repo):
#    - ./keystore/<wallet>.json       (orch on-chain wallet; from GCP Secret Manager)
#    - ./password.txt                 (keystore passphrase)
#    - ./.env  with: FAL_KEY=<same as BYOC FAL_API_KEY>, ARB_RPC_URL=<arbitrum RPC>,
#                    ETH_ORCH_ADDR=<orch address>, LR_ORCH_SECRET=<secret>, LR_HOSTNAME=<dns>
#    - ./runners.json                 (3.3)
# 2. Fund/verify the orch wallet is registered on Arbitrum One (same as byoc onboarding).
# 3. Bring up:
sudo docker compose up -d --build
sudo docker logs liverunner-v2-orch | grep -i 'liveRunner\|price'
# 4. Front :443 with Caddy (3.4).
# 5. Verify per-cap prices:
curl -sk https://liverunner-v2-staging-1.daydream.monster:8935/discovery | jq '.[0].runners[] | {app, price_info}'
#    Expect 7 (or 8) runners, each with a DISTINCT non-zero price_info.
```

VM-required actions (infra/John): wallet funding + on-chain registration, `pulumi up` (if IaC path),
DNS record creation, GCP Secret Manager wallet fetch. **Not runnable from this workspace.**

---

## 4. Works-now vs gated matrix (with owners)

| # | Item | Deployable now (this topology + v0.9.0)? | What it delivers / blocks | Owner |
|---|------|------------------------------------------|---------------------------|-------|
| **A** | New onchain LR orch on v0.9.0 (arbitrum, keystore, `-useLiveRunners`, `-pricePerUnit=100`) | ✅ **Yes** — config only (§3.1) | Onchain orch, priced base | infra / **John** |
| **B** | One runner per fal cap via `-liveRunnerConfig runners.json` | ✅ **Yes** — config only (§3.3) | 8 distinct runners, one price each | infra / **John** |
| **C-cfg** | Per-cap **non-zero** price advertised in `/discovery` | ✅ **Yes** | Unblocks "missing or zero priceInfo" for LR | infra / **John** |
| **C-code** | Dynamic per-cap `fal-app` (`--app`/`--model-id`/`--currency`) | ❌ needs small code change | Only if you prefer dynamic over static registry (Path B) | go-livepeer app / storyboard runner |
| **D (bill: per-image caps)** | Exact billed amount for `gpt-image`, `kontext-edit` | ✅ **Yes** (fixed-per-call == per-image) | Correct billing for 2 caps | infra / **John** |
| **E** | LR-native session payment settles (signer `type=live`, `SessionPriceInfo`/`"fixed"`) | ⚠️ **Partial** — code is in v0.9.0, but the **billed pymthouse DMZ signer** must run a v0.9.0-class image **and the gateway must send `type=live`** (today it sends `lv2v`/`byoc`) | **John** (pymthouse signer image) + **gateway** owner |
| **F** | Per-unit USD metering (charge by MP / second / 1000-chars, not flat per-call) | ❌ **Gated (code)** — independent of v0.9.0 | Exact billing for per-MP/second/char caps (6 of 8); today a flat ~1 µUSD floor | **John / pymthouse** metering (OpenMeter seam) |
| **G1** | LR prices in gRPC `capabilities_prices[]` (`GetCapabilitiesPrices` reads LR registry) | ❌ **Gated (code, NOT in v0.9.0)** | Only needed if byoc **gRPC-path** parity is required; the LR-native path (E) does not need it | **go-livepeer** (rickstaa / j0sh) |
| **H** | Finalize `seedance-mini-i2v` price + add to pricing-table/wire | ❌ **Gated (data)** | Onboard the 8th cap | **storyboard** descriptor / pricing owner |

**Net:** items **A, B, C-cfg, D** are **deployable now with config only** — stand up the new orch and get
per-cap non-zero prices on `/discovery` plus correct billing for the two per-image caps via the LR-native
single-shot `"fixed"` path. **E** needs the billed pymthouse signer + gateway to move to `type=live`.
**F** (per-unit metering) and **G1** (byoc gRPC parity) remain code gaps with the owners above; **H** is a
pricing-data gap for one cap.

---

## 5. Validation plan (e2e) — reuse the pymthouse-e2e runbook

Reuses `NaaP/pymthouse-e2e.md` "Scenario: Test against LR-orch" (Run 55/57), repointed at the NEW orch.
Set `LR_ORCH`/`BYOC_ORCH_URL` to the new host.

```bash
export NEW_LR="https://liverunner-v2-staging-1.daydream.monster:8935"
export LR_ORCH="$NEW_LR" BYOC_ORCH_URL="$NEW_LR"
# already set per pymthouse-e2e.md: BYOC_SIGNER_URL, COMPOSITE_BEARER, NAAP_KEY, NAAP_VALIDATE_URL, GATEWAY_SRC
```

**Step 1 — per-runner price present (the topology proof).** This is the direct win vs the old flat orch:
```bash
curl -sk "$NEW_LR/discovery" | jq '.[0].runners[] | {app, price_info}'
# PASS = one runner per cap, each price_info DISTINCT and non-zero (not the old shared {100,1,WEI}).
```

**Step 2 — signer accepts composite bearer, orch info priced (unbilled).** Reuse run55 diags:
```bash
LR_ORCH="$NEW_LR" GATEWAY_SRC="$GATEWAY_SRC" "$GWPY" scripts/run55-lr-orchinfo-diag.py
LR_ORCH="$NEW_LR" GATEWAY_SRC="$GATEWAY_SRC" "$GWPY" scripts/run57-lr-auth-vs-pay.py
# PASS = /sign-orchestrator-info signs 200, TicketParams present, PriceInfo now NON-ZERO for the cap
#        (contrast with the old Run 57 where PriceInfo was 0/1).
```

**Step 3 — naap-key billed generation through one fal cap.** Front door → composite → billed:
```bash
curl -sS -X POST "$NAAP_VALIDATE_URL" -H "Authorization: Bearer $NAAP_KEY" \
  | jq '.data.signerSession | keys'   # expect ["headers","url"]
# per-image cap first (exact-parity path):
BYOC_CAPABILITY=gpt-image BYOC_ORCH_URL="$NEW_LR" GATEWAY_SRC="$GATEWAY_SRC" \
  "$GWPY" scripts/run50-direct-signer-probe.py
```
**Expected on the NEW orch (vs old Run 57):**

| Stage | OLD orch (flat 0-price) | NEW orch (per-cap priced) — expected |
|-------|-------------------------|--------------------------------------|
| validate → composite bearer | ✅ PASS | ✅ PASS (unchanged; PR #430) |
| `/sign-orchestrator-info` | ✅ PASS | ✅ PASS |
| `/generate-live-payment` | ❌ 400 `missing or zero priceInfo` | ✅ **PASS if** gateway/signer on `type=live` (item E); else still 400 until E lands |
| generation | ❌ 400 `Could not verify job creds` | ✅ real `fal.media` asset once payment mints |
| metering | $0 (no payment) | +1 req, +µUSD floor (per-unit exact only after gap F) |

**Step 4 — control contrast.** Run the same bearer against `byoc-staging-1` (priced control) to prove
the stack is intact and isolate any failure to LR config:
```bash
BYOC_CAPABILITY=gpt-image BYOC_ORCH_URL="https://byoc-staging-1.daydream.monster:8935" \
  GATEWAY_SRC="$GATEWAY_SRC" "$GWPY" scripts/run50-direct-signer-probe.py   # expect ✅ paid + image
```

**Interpretation:**
- **Step 1 + 2 passing = the one-orch→many-runner topology is proven** (per-cap non-zero prices
  advertised and signed) — this is achievable **now** with config only.
- **Step 3 `/generate-live-payment` passing requires item E** (billed signer + gateway on `type=live`).
  If E hasn't landed, Step 3 stays at the same 400 as old Run 57 — that is a **known signer/gateway gap**,
  not a topology failure. Per-unit billed-amount accuracy for per-MP/second/char caps needs gap F.

---

## Appendix — citation index

- **Ground truth:** `LR-V0.9.0-ONCHAIN-ASSESSMENT.md` (onchain proof :14-55; v0.9.0 contents :149-168;
  G1 gap :170-181; gap table :200-215).
- **Fal cap list / model_ids:** `simple-infra/sdk-service-build/app.py:131-141`;
  `simple-infra/live-runner/fal-app/README.md:10-21`;
  `NaaP/apps/web-next/src/lib/orchestrator-leaderboard/storyboard-default-plan.ts:104-118`.
- **Per-cap prices:** `storyboard-a3/docs/pricing-v1/pricing-table.json` (`display_price_usd`/`unit_kind`);
  wei wire `storyboard-a3/docs/pricing-v1/CAPABILITIES_JSON.byoc.json`;
  descriptor `PriceSchema`/`OfferingSchema` `storyboard-a3/lib/capabilities/descriptor.ts:105-133`.
- **fal-app runner:** `simple-infra/live-runner/fal-app/app.py:31,84-110` (hardcoded `APP_ID`,
  `--price` only); offering data model `simple-infra/sdk-service-build/lr_offerings.py:27-76`.
- **LR code mechanics (glp-combine `fix/byoc-e2e-v1-and-type-byoc`):** `LiveRunnerPriceInfo`
  `ai/runner/live_runner.go:79-83`; static-config schema `:99-115`; `discoveryRunner()` `:1301-1326`;
  USD→wei `:1357-1384`; `-useLiveRunners`/`-liveRunnerConfig` `cmd/livepeer/starter/flags.go:60-61`,
  `starter.go:2016-2037`; `runnerOrchInfo` `server/ai_http.go:403-425`; `GetCapabilitiesPrices` (no LR
  registry) `core/orchestrator.go:266-343`; signer types `lv2v`/`byoc` (no `live` on this branch)
  `server/remote_signer.go:36-37`; 720p pixel-second metering `server/live_payment_processor.go:12-16`.
- **Deploy configs:** current offchain LR compose `simple-infra/live-runner/docker-compose.yml:13-61`;
  onchain byoc reference `simple-infra/docker-compose/byoc-stack.yaml:1-27`; Pulumi orch template
  `simple-infra/pulumi/__main__.py:169-189,354-359`; stack config `Pulumi.staging.yaml:15-16`;
  TLS/Caddy `simple-infra/live-runner/Caddyfile:11-17`.
- **Validation runbook:** `NaaP/pymthouse-e2e.md:397-475` (LR-orch scenario, Run 55/57).

### Open items to confirm with infra/VM (not resolvable read-only here)

1. **v0.9.0 static-config field names** — confirm `-liveRunnerConfig` accepts the `runners[].price_info`
   shape (or `{price,currency,unit}`) on the exact v0.9.0 tag:
   `docker run --rm livepeer/go-livepeer:v0.9.0 -help 2>&1 | grep -i liveRunner`.
2. **v0.9.0 image digest** — re-confirm `sha256:27464aa2…` before pinning.
3. **Whether the billed pymthouse DMZ signer + gateway are on `type=live`** (item E) — gates Step 3.
