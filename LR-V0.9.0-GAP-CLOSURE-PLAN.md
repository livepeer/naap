# LR v0.9.0 Gap-Closure Plan — clean, BYOC-free, one-orch-many-runners

**Status:** ✅ EXECUTED 2026-07-28 — see [`LR-V0.9.0-EXECUTION-REPORT.md`](./LR-V0.9.0-EXECUTION-REPORT.md).
Orch live on `:8936` (v0.9.0, 8 per-cap runners, on-chain active). pymthouse e2e green through the
native 402 challenge; generation blocked on a 1-line signer `manifestId` bug (Gap #1). SDK native
dispatch blocked on Gap B (`call_runner` absent in deployed image). daydream gen PASS on the daydream
plane. Reserve already funded — no spend. v1 `:8935` removal GATED (carries distinct tool caps).
**Date:** 2026-07-28 · **Branch:** `docs/pricing-scope-simplified` · **Author:** seanhanca
**Read-only sources:** `LR-MULTIRUNNER-GOLIVE-E2E.md` §6 (root cause), `live-runner-v2/`,
go-livepeer `v0.9.0` tag (`ai/runner/live_runner.go` — verified this pass:
`StaticLiveRunnerConfigEntry`, `LiveRunnerPriceInfo`, `normalizeLiveRunnerPriceInfo`,
`buildStaticRunner`, `LiveRunnerDiscoveryRunner`, `newConverterForRunner`;
`cmd/livepeer/starter/flags.go`, `starter.go`, `core/autoconvertedprice.go`), the Storyboard
capability model (`storyboard/lib/capabilities/descriptor.ts` `PriceSchema`/`CapabilitySchema`,
`discovery-sync.ts`, `generate-registry.ts`, `registry.json`), and the onboarding guide
`EMRAN-VLM-CAP-ONBOARDING-GUIDE.html`.

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
| **A** | `runners.json` uses byoc-fork **wei** `price_info` (`price_per_unit`/`pixels_per_unit`/`unit:"WEI"`); clean v0.9.0 **rejects it at boot** (`price_info.price is required` + `unit must be hour, 720p, or fixed`) **and** it carries **no capability descriptor**, so the Storyboard agent/registry can't see the caps | Rewrite each entry to the **standard capability schema**: embed a `capability` descriptor block (single source of truth) + emit the native `price_info:{price:"<usd>",currency:"usd",unit:"fixed"\|"720p"}` **derived from it** (keep `label,app,runner_url,health_url,healthy_status_code,mode,capacity`). See Step (i) for the field-by-field mapping. | `live-runner-v2/runners.json` | me (draft) + **storyboard-pricing** (confirm USD) | **CFG** |
| **B** | USD→wei needs a price-feed oracle | Use v0.9.0 default `-priceFeedAddr` (Arbitrum ETH/USD `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612`, auto-set on `arbitrum-one-mainnet`) — verify it initializes | compose command / `-priceFeedAddr` | **orch-infra (John)** | **CFG** |
| **C** | Redeploy on **clean `livepeer/go-livepeer:v0.9.0`** (currently `3975-singleshot`, byoc-derived) | Swap image; keep `-useLiveRunners -liveRunnerConfig`; reuse wallet | `live-runner-v2/docker-compose.yml` on VM | **orch-infra (John)** | **CFG** (additive) |
| **D** | Remove `liverunner-v1-orch` (`:8935`) | Stop/down the v1 container **after** v0.9.0 is verified | VM: `docker compose … down` for v1 | **orch-infra (John)** | **CFG** (reversible: restart) |
| **E** | **Sender on-chain reserve** empty (`500 insufficient sender reserve`) | Fund deposit+reserve for the **gateway/sender payment wallet** (the `payment.sender`, NOT the orch wallet) in the Arbitrum One TicketBroker | `FundDepositAndReserve(deposit,reserve)` (e.g. `livepeer -deposit … -reserve …` or contract tx) | **John / pymthouse signer (holds sender key)** | **FUND / irreversible-ish** |
| **F** | Native dispatch client missing | Drive naap-key native `/apps/…` via the **deployed SDK service** (`_dispatch_lr` → `live_runner.call_runner`) with `SDK_MULTI_ORCH_ENABLED=1` + `SELECT_PROVIDER_LR_CAPS=flux-schnell` + `LR_ORCH_DISCOVERY`→v0.9.0 orch; **or** write a native `/apps/` probe | SDK service env / new probe | **gateway/SDK owner (John)** | **RO once funded** |
| **G** | Payment must bind to the **native 402 challenge** `OrchestratorInfo` + accepted signer `type` | `call_runner` must mint `net.Payment` against the challenge's `OrchestratorInfo`/`TicketParams`; confirm DMZ accepts the LR signer `type`. (v0.9.0 also supports native `-remoteSigner`/`-remoteSignerUrl`/`-remoteSignerWebhookUrl` — pymthouse can be the remote signer.) | gateway `call_runner` / signer | **John (signer) + gateway owner** | **RO** |
| **H** | `seedance-mini-i2v` price is PROVISIONAL (registry row has **no `display_price_usd`/`unit_kind`**) | Finalize USD + `unit_kind`/`quantity_source` so its descriptor is schema-complete, or drop the 8th entry to ship 7 caps | `runners.json` + `registry.json` | **storyboard-pricing** | **CFG** |
| **I** | Clean v0.9.0 **does not echo the `capability` block on `/discovery`** — `LiveRunnerDiscoveryRunner` is a fixed struct (url/app/mode/capacity/price_info only), so the automatic discovery-sync cron ingests **nothing** from this orch | Register the caps via the **descriptor path fed from the local source of truth** (`applyDiscoverySync(descriptors)` / operator config), **not** by fetching this orch's `/discovery`. Optional later: a `/discovery`-augmenting sidecar, or upstream passthrough. See Registration §. | Storyboard sync route / operator env | **agent/registry owner + gateway (John)** | **CFG** |
| **J** | The 8 fal caps **already exist** in `registry.json` (all `kind:ai`); a descriptor with `kind:"live-runner"` would mint **duplicate synonym** identities | Each descriptor pins `kind:"ai"` + the **exact existing `name`** so discovery-sync dedups to **ADD-CAPACITY** (offering only, no registry write), not a new/synonym cap | `live-runner-v2/runners.json` (capability block) | me (draft) | **CFG** |

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

### Step (i) — Rewrite `runners.json` → **standard capability schema** (one source of truth)  *(CFG · me + storyboard-pricing)*

**Two schemas, one authored source.** There are two *separate* schemas and the orch reconciles
them at boot only if we author one and derive the other:

1. **Native v0.9.0 runner config** — what the orch binary parses at boot
   (`StaticLiveRunnerConfigEntry`): `label, routing, runner_url, health_url, healthy_status_code,
   mode, app, capacity, price_info{price, currency, unit}`. `price` is a **required positive
   decimal**, `currency` must be `"usd"` (default), `unit ∈ {hour,720p,fixed}` (default `hour`).
   **Go `json.Unmarshal` ignores unknown fields**, so extra keys are safe at boot but are **not**
   re-emitted on `/discovery` (see gap I).
2. **Storyboard capability descriptor** — the current agent/MCP/registry contract
   (`descriptor.ts` `CapabilitySchema`): `{capability:{kind,name,family,modality,variant,
   output_kind,semantic_key,aliases,good_for,io{endpoint,inputs,output}, offering{app,mode,
   capacity,price}}}`. Its `offering.price` is the **on-chain WEI/USD** `PriceSchema`
   (`price_per_unit` int WEI, `pixels_per_unit`, `unit:"WEI"|"USD"`, `display_usd`, `display_unit`,
   `unit_kind` ∈ {megapixel,image,second,characters,call,tokens}, `quantity_source` ∈
   {megapixels_wh_n,num_images,duration_seconds,text_length,token_count,const_1}).

- **Single source of truth = the embedded `capability` descriptor.** Each `runners.json` entry
  carries a `capability` block (authored, schema-valid) **plus** the native `price_info`, where the
  native `price_info` is **generated/validated from `capability.offering.price`**. A small generator
  (`scripts/lr-gen-runners.mjs`, importing `validateDescriptor` from
  `storyboard/lib/capabilities/descriptor.ts`) runs in CI: it (a) `validateDescriptor`s every block —
  *"validates locally ≡ discovery-sync will ingest it"* — and (b) asserts the native
  `price_info`/`app`/`mode`/`capacity` are derived-consistent. This keeps ONE authored figure and
  eliminates drift between the orch's native pricing and the agent's registry.

- **Field-by-field mapping** (`capability.offering` → native runner fields):

| capability descriptor | native runner field | rule |
|---|---|---|
| `offering.price.display_usd` | `price_info.price` | per-request USD (see unit rule) |
| — (constant) | `price_info.currency` | always `"usd"` |
| `offering.price.unit_kind` | `price_info.unit` | `megapixel\|image\|call\|characters\|tokens` → **`"fixed"`** (per single-shot request); `second` → **`"fixed"`** (per-clip) or **`"720p"`** (per-pixel-second, scales w/ resolution×duration) |
| `offering.price.{price_per_unit,pixels_per_unit,unit:"WEI"}` | *(not copied)* | stays in the descriptor as the on-chain WEI reference; the orch **recomputes wei from USD** via `newConverterForRunner`+price feed (gap B) |
| `offering.app` | `app` | must be identical |
| `offering.mode` | `mode` | `single-shot` |
| `offering.capacity` | `capacity` | e.g. `4` |
| `io.endpoint` | *(dispatch app_path)* | e.g. `/generate` — used on the native `/apps/{runner_id}/app{endpoint}` call, not in `price_info` |
| `unit_kind` / `quantity_source` / `display_usd` / `display_unit` | *(registry, via discovery-sync)* | `descriptorToEntry` → `RegistryEntry.{unit_kind,quantity_source,display_price_usd,display_unit}` — the agent/signer/meter layer, **not** the orch |

- **Identity (from `registry.json`, must match to dedup as ADD-CAPACITY — gap J):**

| cap | `app` | kind:modality:family:variant | `unit_kind` | `quantity_source` | native `unit` | `price` (USD) |
|---|---|---|---|---|---|---|
| flux-schnell | `storyboard/fal-flux-schnell` | ai:t2i:flux:schnell | megapixel | megapixels_wh_n | fixed | 0.00315 |
| flux-dev | `storyboard/fal-flux-dev` | ai:t2i:flux:dev | megapixel | megapixels_wh_n | fixed | 0.02625 |
| gpt-image | `storyboard/fal-gpt-image` | ai:t2i:gpt:image | image | num_images | fixed | 0.0022 |
| kontext-edit | `storyboard/fal-kontext-edit` | ai:edit:kontext:- | image | num_images | fixed | 0.042 |
| pixverse-i2v | `storyboard/fal-pixverse-i2v` | ai:i2v:pixverse:- | second | duration_seconds | fixed¹ (or 720p) | 0.063/s |
| veo-t2v | `storyboard/fal-veo-t2v` | ai:t2v:veo:- | second | duration_seconds | fixed¹ (or 720p) | 0.42/s |
| chatterbox-tts | `storyboard/fal-chatterbox-tts` | ai:tts:chatterbox:- | characters | text_length | fixed¹ | 0.02625 /1k chars |
| seedance-mini-i2v ⚠️ | `storyboard/fal-seedance-mini-i2v` | ai:i2v:seedance:mini | **(gap H)** | duration_seconds | fixed¹ | **PROVISIONAL (gap H)** |

  ¹ `fixed` needs a **per-request** USD = per-unit USD × assumed quantity (clip seconds / chars÷1000);
  recommend `fixed` per single-shot request as the shippable default (each call = one request, one
  charge), with `720p` as the option if per-pixel-second on-chain scaling is wanted for video
  (native converts `720p` price ÷(3600·1280·720·30)). Precise per-unit metering is carried by the
  descriptor's `unit_kind`+`quantity_source` for the Storyboard meter, independent of the orch's
  native flat charge. (Resolves open Q3.)

- **Example entry** (source of truth + derived native fields, `flux-schnell`):

```json
{
  "label": "fal-flux-schnell",
  "app": "storyboard/fal-flux-schnell",
  "runner_url": "http://fal-app:8990",
  "health_url": "http://fal-app:8990/health",
  "healthy_status_code": 200,
  "mode": "single-shot",
  "capacity": 4,
  "price_info": { "price": "0.00315", "currency": "usd", "unit": "fixed" },
  "capability": {
    "kind": "ai", "name": "flux-schnell",
    "family": "flux", "modality": "t2i", "variant": "schnell",
    "semantic_key": "ai:t2i:flux:schnell",
    "io": {
      "endpoint": "/generate",
      "inputs": { "prompt": { "wire": "prompt", "from": "prompt", "required": true, "type": "string" } },
      "output": { "kind": "image", "fields": ["image_url"], "primary": "image_url" }
    },
    "offering": {
      "app": "storyboard/fal-flux-schnell", "mode": "single-shot", "capacity": 4,
      "price": {
        "price_per_unit": 1284088677165, "pixels_per_unit": 1048576, "unit": "WEI",
        "display_usd": 0.00315, "display_unit": "megapixel",
        "unit_kind": "megapixel", "quantity_source": "megapixels_wh_n"
      }
    }
  }
}
```

  Note the WEI figures reuse the **current** `runners.json` values (they were correct per-unit wei,
  just in the wrong place — top-level `price_info` instead of the descriptor); the native
  `price_info` is now the USD form the orch requires.

- **File:** `live-runner-v2/runners.json` (keep `health_url`, `healthy_status_code`,
  `mode:"single-shot"`, `capacity`; `routing` defaults to `runner_id`).
- **Expected:** `validateDescriptor` passes for all 8 `capability` blocks; native `price_info`
  validates against v0.9.0 (positive decimal `price`, `currency:"usd"`, `unit ∈ {fixed,720p}`).
- **Rollback:** `git checkout live-runner-v2/runners.json`.
- **✅ CHECKPOINT i:** each entry is (a) descriptor-valid (cap-check parity) and (b) native-boot-valid;
  pricing owner signed off (or 8th entry dropped for gap H).

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

## 4A. Full registration (orch + capabilities)

Registration has **two independent planes** and both must be green for the agent/MCP to route to
the new orch. Nothing here touches `byoc-staging-1`.

### R1 — On-chain orchestrator registration  *(reuse · no new fund)*
- **What v0.9.0 does at boot:** with the funded wallet `0x180859…a6a252` it resolves
  `ServiceRegistry`/`TicketBroker`/`Minter` on arbitrum-one-mainnet and comes up as an active
  orchestrator. The wallet is **already registered** (§2), so this is a **reuse**, not a new
  registration or re-fund.
- **serviceURI (confirmed):** boot calls `SetServiceURI` **in memory only** (`starter.go`); it does
  **not** rewrite the on-chain `serviceURI`. So reusing the wallet across the image swap and removing
  v1 (Step iii) does **not** mutate on-chain identity. If any on-chain/gRPC discovery consumer relied
  on the wallet's `serviceURI` pointing at v1, repoint it once to the v0.9.0 endpoint (open Q2 port).
- **Verify (RO):**
  - `livepeer_cli` → “Get orchestrator info”, **or** query `ServiceRegistry.getServiceURI(0x180859…)`
    on an Arbitrum One RPC → returns the orch's public URI, status active.
  - Orch boot log shows `ServiceRegistry/TicketBroker/Minter … resolved` and no registration error.

### R2 — Capability discovery + registry sync  *(CFG · agent/registry + gateway John)*
- **Orch side (native `/discovery`):** each static runner publishes its `app` + converted per-cap
  wei `price_info` on `GET https://<orch>:8936/discovery`. This is what proves the orch *prices* each
  cap; it does **not** carry the `capability` descriptor (gap I — `LiveRunnerDiscoveryRunner` is a
  fixed struct).
- **Registry side (agent can *see* the caps):** because clean v0.9.0 strips the descriptor from
  `/discovery`, run the Storyboard discovery-sync from the **local source of truth** rather than by
  fetching this orch's `/discovery`:
  - Extract the 8 `capability` blocks from `live-runner-v2/runners.json` → `descriptors[]`.
  - `applyDiscoverySync(descriptors)` (or the operator's cap-sync entrypoint). Per the pure planner:
    all 8 identities **already exist** in `registry.json` → verdict **ADD-CAPACITY** (offering only,
    **no registry write**); a genuinely new cap would be **REGISTER**; a name mismatch would be
    **SYNONYM-SKIP** (gap J — that's why each descriptor pins `kind:"ai"` + exact `name`).
- **Routing side (agent actually dispatches to this orch):** discovery-based selection
  (`SELECT_PROVIDER_USE_DISCOVERY`) is **off**, so pin the route in operator env — the **native-LR**
  plane the 8 fal caps already use:
  - `LR_ORCH_DISCOVERY` → the v0.9.0 orch `/discovery`; `SELECT_PROVIDER_LR_CAPS += <the 8 caps>`;
    `LR_DESCRIPTOR_DISPATCH=1` with `LR_OFFERINGS_JSON` (app + endpoint + input_map) per cap.
  - (BYOC `CAPABILITY_ORCH_MAP` is the *other* plane and is **not** used here — these caps route
    native-LR single-shot.)
- **Verify full registration (all three green):**
  1. **On-chain:** `getServiceURI(0x180859…)` resolves + orch active (R1).
  2. **Priced + discoverable (8/8):**
     `curl -sk https://136.66.21.17:8936/discovery | jq '[.[]?.runners[]? // .runners[] | {app, price_info}]'`
     → 8 entries, distinct **non-zero** per-cap prices.
  3. **Agent sees them:** Storyboard MCP `list_capabilities` shows all 8 (as active caps); the
     discovery-sync report lists 8× ADD-CAPACITY (0 REGISTER, 0 SYNONYM-SKIP, 0 invalid).
  4. **Routable:** one `run_capability`/`create_media` per cap dispatches to the v0.9.0 orch and
     returns a real asset (this is Step v end-to-end, once R1+funding are done).
- **✅ CHECKPOINT R:** orch visible on-chain + all 8 caps discoverable & priced + all 8
  ADD-CAPACITY in the sync + at least one routed generation.

### Gaps where a runner would NOT auto-comply / auto-register (owners)
- **Descriptor not on `/discovery` (gap I):** clean v0.9.0 won't surface the `capability` block, so the
  **automatic** discovery-sync cron can't ingest it. Mitigation: local-descriptor sync (above).
  Fully-automatic onboarding needs a `/discovery`-augmenting sidecar or upstream passthrough. →
  **agent/registry owner + gateway (John).**
- **seedance-mini-i2v (gap H):** registry row has no `display_price_usd`/`unit_kind`, so its
  descriptor can't be schema-complete/priced. → **storyboard-pricing.**
- **Routing still manual (SELECT_PROVIDER_USE_DISCOVERY off):** existing caps register as
  ADD-CAPACITY but the agent won't route to the new orch until the native-LR env is set. →
  **gateway/SDK (John).**

### Schema conformance note — guide vs. current code
- **Guide is mostly correct but slightly stale on two points:**
  1. **`price` shape:** the guide's descriptor `offering.price` = `{price_per_unit, pixels_per_unit,
     unit:"WEI", display_usd, display_unit}` — it **predates** the additive `unit_kind` (closed enum:
     megapixel/image/second/characters/call/tokens) and `quantity_source` (closed enum) added to
     `PriceSchema`. Our descriptors **must include `unit_kind` + `quantity_source`** so the caps meter
     correctly (they're optional in the schema but required for correct billing; `descriptorToEntry`
     reads them into `RegistryEntry.{unit_kind,quantity_source}`). *(Note: the task brief's shorthand
     "descriptor.price = {price,currency,unit_kind,quantity_source}" is not the real schema — the
     descriptor price is the WEI/USD shape above, explicitly “not {price,currency}”; {price,currency}
     is only the **native** `price_info`.)*
  2. **“runners.json passes custom fields through to `/discovery`”** (guide step 2) — **not true for
     clean upstream v0.9.0** (gap I). It holds only with a sidecar/passthrough. The rest of the guide
     (single-shot mode, `/apps/{runner_id}` path, descriptor identity, dedup verdicts) matches the
     current code.
- **How each runner is guaranteed schema-compliant + registerable:** the source-of-truth `capability`
  block is run through `validateDescriptor` in CI (Step i) — the exact validator discovery-sync uses —
  so “cap-check passes locally ≡ the sync ingests it.” The native `price_info` is generated from the
  same block and re-validated against the v0.9.0 parser, so a runner cannot boot-price and
  agent-register out of sync.

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
3. **Video/TTS unit mapping (recommendation given, confirm):** Step (i) recommends `unit:"fixed"`
   per single-shot request for all caps (each call = one charge), with `unit:"720p"` offered as the
   option for per-pixel-second on-chain scaling on video. Confirm `fixed` (and the assumed
   clip-seconds / chars used to turn per-unit USD into per-request USD), or elect `720p` for video.
4. **seedance-mini-i2v (gap H):** finalize its USD price in the pricing table, or drop the 8th
   runner and ship 7 caps?
5. **Native dispatch route (Step v):** drive via the deployed SDK service (needs John to confirm the
   image ships `live_runner.call_runner`), or approve writing a new standalone native `/apps/` probe?
