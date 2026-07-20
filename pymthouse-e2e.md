---
name: pymthouse-e2e
description: >-
  Set up and run the pymthouse BILLED end-to-end test path (naap_ key → NaaP
  validate (M2M) → pymthouse signer session / composite bearer → get_orch_info →
  /generate-live-payment → orchestrator generation → pymthouse/OpenMeter
  metering). Use this when you need to run, reproduce, or verify the billed BYOC
  signer path against a real staging orchestrator, confirm the composite-bearer
  auth fix, check per-cap pricing, or diagnose a stage failure. Works from Claude
  Code or Cursor. Secrets are supplied via environment variables only.
---

# pymthouse billed E2E

## For the AI agent — runbook (read this first)

You have been handed this file and asked something like **"run an e2e test for
me."** Do **not** dump the whole doc back at the user. Instead follow this loop:

1. **Step 0 — collect inputs from the user** (secrets never live in git; you
   prompt for them at runtime and `export` them into the shell you run probes
   in). See the [required-inputs checklist](#step-0--required-inputs-checklist).
2. **Steps 1–N — do everything else autonomously**: environment setup, resolve
   the signer credentials, pick the default orch, run the right probe scripts,
   and read their stdout.
3. **Final step — emit the [report](#report-template)** with a per-stage
   PASS/FAIL verdict, the endpoints used, the fee observed, and any blocker +
   owner. That report is your deliverable.

### Step 0 — required-inputs checklist

Ask the user for the items below **before running anything**. Tell them these are
read from environment variables only and must never be committed. If the user
says something vague like *"just run it"*, collect the **mandatory** items, take
the **defaults** for everything optional, and proceed with the
[default happy path](#step-3--default-happy-path-just-run-it).

**Mandatory — signer credentials (get them ONE of two ways):**

- **Path A (preferred, most autonomous)** — ask for:
  - `NAAP_KEY` — the `naap_…` front-door key.
  - Prompt: *"Paste your `naap_…` key. I'll call NaaP validate to derive the
    signer URL and composite bearer for you."*
  - The agent then derives `BYOC_SIGNER_URL` + `COMPOSITE_BEARER` from the
    validate response (see [Step 2](#step-2--resolve-signer-credentials)).
    `NAAP_VALIDATE_URL` defaults to
    `https://operator.livepeer.org/api/v1/keys/validate`.
- **Path B (direct)** — if the user already has them, ask for:
  - `BYOC_SIGNER_URL` — prompt: *"Signer base URL (the `*.up.railway.app`
    host)."*
  - `COMPOSITE_BEARER` — prompt: *"Composite bearer, shape
    `Bearer app_<24hex>_pmth_<secret>` (NOT the opaque `pmth_` session)."*

**Mandatory — environment:**

- `GATEWAY_SRC` — path to the sibling `livepeer-python-gateway/src`. Required;
  `run57-lr-auth-vs-pay.py` has **no default** and hard-crashes if it is unset.
  You set this during [Step 1 setup](#step-1--environment-setup-deterministic).

**Optional (proceed with the default if the user does not specify):**

| Input | Env var | Default / when needed |
|---|---|---|
| Target orch | `BYOC_ORCH_URL` | Default `https://byoc-staging-1.daydream.monster:8935` (fully-priced control → expected full PASS). Only switch to the LR host if the user explicitly wants the LR scenario. |
| Single capability | `BYOC_CAPABILITY` | Default `flux-schnell`. |
| Multi-cap list | `CAP_LIST` | Only for the multi-cap probe (Step 4). |
| M2M client id / secret | `PMTH_M2M_ID` / `PMTH_M2M_SECRET` | **Not read by any probe script.** Only needed for a manual OpenMeter metering read. Skip unless the user wants metering verified. |
| pymthouse app id | `PMTH_APP` | Same — manual OpenMeter usage lookups only. |
| LV2V model / discovery | `LV2V_MODEL` / `DISCOVERY_URL` | Only for the optional native-LV2V probe (Step 5). |

> **Note:** `NAAP_KEY` + `NAAP_VALIDATE_URL` are themselves *optional* for the
> billed probe scripts (none of `run50/run53/run55*/run57` read them) — they are
> only used to (a) auto-derive the signer credentials in Path A and (b) run the
> optional validate front-door proof. If the user goes with Path B, you can skip
> the naap key entirely.

### Step 1 — environment setup (deterministic)

Run these once. `naap` (this repo) and `livepeer-python-gateway` must be
**siblings**.

```bash
# from the parent dir that holds both repos (skip clones if already present):
#   git clone <naap> && git clone <livepeer-python-gateway>
cd livepeer-python-gateway
uv sync --extra examples          # installs grpcio / protobuf / aiohttp / av
GWPY="$PWD/.venv/bin/python"      # gateway interpreter the probes must run under
cd -                              # back to the naap repo root
export GATEWAY_SRC="../livepeer-python-gateway/src"   # sibling src (from naap root)
```

All probe commands below run **from the naap repo root** and use `"$GWPY"`.

### Step 2 — resolve signer credentials

- **Path A (from `NAAP_KEY`):** call validate and extract the endpoint-form
  `signerSession` into the two env vars every script reads:

```bash
export NAAP_VALIDATE_URL="${NAAP_VALIDATE_URL:-https://operator.livepeer.org/api/v1/keys/validate}"
_resp="$(curl -sS -X POST "$NAAP_VALIDATE_URL" -H "Authorization: Bearer $NAAP_KEY")"
export BYOC_SIGNER_URL="$(printf '%s' "$_resp" | jq -r '.data.signerSession.url')"
export COMPOSITE_BEARER="$(printf '%s' "$_resp" | jq -r '.data.signerSession.headers.Authorization')"
# sanity: COMPOSITE_BEARER must look like "Bearer app_<24hex>_pmth_…" (keep the "Bearer " prefix)
printf 'signer=%s bearer=%.40s…\n' "$BYOC_SIGNER_URL" "$COMPOSITE_BEARER"
```

  If `.data.signerSession` is null or you get a `503 Billing provider
  unavailable`, that is the validate blocker (see troubleshooting) — record it as
  a Stage-0 FAIL and ask the user for Path B credentials instead.

- **Path B (direct):** the user already exported `BYOC_SIGNER_URL` +
  `COMPOSITE_BEARER`; nothing to derive.

### Step 3 — default happy path ("just run it")

Point at the **fully-priced control** orch and run the single-cap billed probe.
This exercises signer auth → payment → generation → image in one shot and is the
canonical PASS.

```bash
export BYOC_ORCH_URL="${BYOC_ORCH_URL:-https://byoc-staging-1.daydream.monster:8935}"
BYOC_CAPABILITY="${BYOC_CAPABILITY:-flux-schnell}" GATEWAY_SRC="$GATEWAY_SRC" \
  "$GWPY" scripts/run50-direct-signer-probe.py
```

Expected PASS: `submit_byoc_job: PASS (…s) HTTP 200` plus a real `image_url`
(fal.media JPEG). If the user asked for the LR orch instead, jump to the
[LR-orch scenario](#scenario-test-against-liverunner-staging-1-lr-orch) — its
FAIL-on-price outcome is expected and NOT a bug.

### Step 4 — broaden coverage (optional, if the user wants more than one cap)

Run the multi-cap price/payment probe and/or the LR-vs-control pricing diagnosis
(see [Step-by-step](#step-by-step-run-instructions) Steps 2–4 for exact args).

### Step 5 — emit the report

Fill in the [report template](#report-template) from the probe stdout and hand it
to the user. Map each probe line to a stage using
[Reading PASS/FAIL per stage](#reading-passfail-per-stage).

### Report template

Fill this in and return it as the deliverable (one table row per stage):

```markdown
## pymthouse billed E2E — report

- **Date:** <YYYY-MM-DD>
- **Orch:** <byoc-staging-1 (control) | liverunner-staging-1 (LR)>
- **Signer:** <signer host>
- **Capability(ies):** <flux-schnell | …>
- **Credential path:** <A: naap_ key → validate | B: direct composite bearer>

| Stage | Endpoint / probe | Result | Evidence | Blocker → owner |
|---|---|---|---|---|
| 0 validate (front door) | `POST /api/v1/keys/validate` | PASS / FAIL / SKIP | `signerSession {url,headers}`, composite bearer | <e.g. 503 → NaaP M2M secret> |
| 1 signer auth | `/sign-orchestrator-info` | PASS / FAIL | composite ACCEPTED, recipient `0x…` | <401 not a JWT → wrong bearer> |
| 2 payment | `/generate-live-payment` | PASS / FAIL | `ExpectedPrice=…`, ~281 B `net.Payment` | <400 zero priceInfo → John/orch-infra> |
| 3 generation | `submit_byoc_job` | PASS / FAIL | `image_url=…` (fal.media) | <400 verify creds → unpriced orch> |
| 4 metering | OpenMeter `byoc/<cap>` | PASS / SKIP | `+1 req, +µUSD` | <SKIP if M2M creds not provided> |

- **Verdict:** ✅ PASS / ❌ FAIL — <one-line summary>
- **Fee observed:** <~µUSD on the byoc path | $0 (no payment minted)>
- **Top blocker + owner:** <none | LR zero-pricing → John / orch-infra | …>
```

## Overview / when to use

Use this skill to drive and verify the **billed** Livepeer inference path that
NaaP + pymthouse expose today, end to end, with real payment generation and real
orchestrator generation:

```
naap_ key
  → NaaP /api/v1/keys/validate (M2M)          # returns signerSession {url, headers}
    → pymthouse signer session / composite bearer (app_<24hex>_pmth_<secret>)
      → get_orch_info()  →  real OrchestratorInfo (price + ticket params)
        → POST /generate-live-payment (BILLED) → net.Payment (~281 B)
          → submit_byoc_job → orchestrator verifies payment + generates
            → pymthouse / OpenMeter metering record
```

Reach for it when you need to:

- Run the billed BYOC path for one or many capabilities (single-cap, multi-cap).
- Verify PR #430 (forward the **composite** `app_…_pmth_…` bearer, not the opaque
  `pmth_` session) still holds.
- Compare the fully-priced control orch (`byoc-staging-1`) against the LR orch
  (`liverunner-staging-1`, known zero-pricing blocker).
- Diagnose which stage failed (validate / signer auth / payment / generation /
  metering) from a known-error table.

### Why we drive the signer directly (methodology)

In **production** the two env gates that route a request onto the pymthouse
per-key path are **OFF**:

- `SIGNER_FROM_VALIDATE` (unset) and `AUTH_VALIDATE_URL` (unset) in the SDK
  service (`app.py :: _effective_signer`).

With those OFF, every prod request falls back to the static Daydream signer
(`signer.daydream.live`, `type:lv2v`) and never touches NaaP validate. So we do
**not** exercise this path through prod Storyboard/MCP. Instead a probe script
replicates the SDK service's `_effective_signer` behavior and feeds the decoded
signer session (`signer_url` + composite `Authorization`) straight into the
gateway `get_orch_info` / `submit_byoc_job` chain.

**Everything else is real and live:**

| Component | Real? | Note |
|---|---|---|
| pymthouse test-production signer | ✅ live | `/sign-orchestrator-info`, `/generate-live-payment` |
| NaaP validate (M2M) | ✅ live | `/api/v1/keys/validate` returns endpoint-form `signerSession` |
| Orchestrator (payment verify + generation) | ✅ live | **STAGING** orch, not prod (`byoc-staging-1` / `liverunner-staging-1`) |
| pymthouse / OpenMeter metering | ✅ live | usage record per payment-gen |
| Client routing (MCP → SDK service) | ⛔ replaced | the probe script substitutes only this hop |

The gateway itself decides payment shape purely from the signer hostname
(`byoc.py :: _payment_type_for_signer`): `signer.daydream.live → lv2v`,
everything else → `byoc`. Because our signer is the pymthouse DMZ host, the path
is `type:byoc`.

## Prerequisites

- **Python ≥ 3.10** and a virtualenv tool (`uv` recommended, `pip` works).
- **This repo** (`naap`) checked out; the probe scripts live in `scripts/`.
- **The gateway checkout** `livepeer-python-gateway` as a **sibling** of this
  repo (default: `../livepeer-python-gateway`). The scripts add its `src/` to
  `sys.path`; nothing is pip-installed from it.
- Gateway package `livepeer-gateway` (local, `pyproject.toml` version `0.1.0`)
  and its runtime deps: `grpcio>=1.65.0`, `protobuf>=4.25.0`, `aiohttp>=3.9.0`,
  `av>=11.0.0`. Install with `uv sync` inside the gateway checkout.
- The composite bearer shape (`app_<24hex>_pmth_<secret>`) comes from the
  builder-sdk 0.6.0 style key; you supply it via env (see below).
- **Network access** to the pymthouse signer (`*.up.railway.app`) and the
  orchestrator gRPC host (`*.daydream.monster:8935`). The orch uses a
  self-signed cert; the gateway TOFU-pins it automatically.

Protobuf/SDK types the scripts rely on (imported from the gateway `src/`):
`livepeer_gateway.byoc.ByocJobRequest`, `submit_byoc_job`,
`livepeer_gateway.orch_info.get_orch_info` (returns `OrchestratorInfo`),
`livepeer_gateway.capabilities.byoc_capabilities_from_app` /
`build_capabilities` / `CapabilityId`, and `livepeer_gateway.lp_rpc_pb2.Payment`
(the `net.Payment` message).

### One-time setup

```bash
# from the parent dir that holds both repos:
git clone <naap>                     # this repo
git clone <livepeer-python-gateway>  # sibling checkout

cd livepeer-python-gateway
uv sync --extra examples             # installs grpcio / protobuf / aiohttp / av
# gateway python interpreter used by the probes:
GWPY="$PWD/.venv/bin/python"
```

## Configuration — environment variables only

> ⚠️ **Never commit real values.** No signer URL secret, composite bearer, M2M
> secret, or naap_ key belongs in this file, in a script, or in git. Export them
> in your shell, or put them in a **gitignored** `.env` you `source`. The scripts
> read secrets from env only and never echo them in full (the bearer is masked).

The probe scripts read the **script env-var names** in the right column. The left
column is the canonical placeholder name for documentation; set whichever your
workflow prefers, but the scripts consume the right-column names.

> **Every probe reads `BYOC_SIGNER_URL` + `COMPOSITE_BEARER`** — they are the
> mandatory signer credentials. Most scripts default `GATEWAY_SRC`, but
> `run57-lr-auth-vs-pay.py` reads `GATEWAY_SRC`, `BYOC_SIGNER_URL`, and
> `COMPOSITE_BEARER` with **no default** and will hard-crash (`KeyError`) if any
> is unset, so always `export GATEWAY_SRC` before running probes. None of the six
> scripts read `NAAP_KEY`, `NAAP_VALIDATE_URL`, `PMTH_M2M_*`, or `PMTH_APP`.

| Canonical placeholder | Script env var (what the code reads) | Purpose / example |
|---|---|---|
| `PYMTHOUSE_SIGNER_URL` | `BYOC_SIGNER_URL` | Signer base URL, e.g. `https://pymthouse-signer-test-production.up.railway.app` |
| `PYMTHOUSE_COMPOSITE_BEARER` | `COMPOSITE_BEARER` | `Bearer app_<24hex>_pmth_<secret>` (composite; **not** the opaque `pmth_` session) |
| `ORCH_URL` | `BYOC_ORCH_URL` | Target orch for the billed path. Fully-priced control default `https://byoc-staging-1.daydream.monster:8935`; set to the LR host to test LR (see LR scenario) |
| `ORCH_URL` (LR) | `LR_ORCH` | LR orch (zero-priced, DNS `136.66.21.17`). Default `https://liverunner-staging-1.daydream.monster:8935`. Read by `run55-lr-*` / `run57` |
| — | `BYOC_CAPABILITY` | Single cap for the submit probe, e.g. `flux-schnell` |
| — | `CAP_LIST` | Comma list for multi-cap, e.g. `flux-schnell,flux-dev,nano-banana` |
| — | `GATEWAY_SRC` | Path to gateway `src`, default `../../livepeer-python-gateway/src` (relative to `scripts/`) |
| — | `CAPS_JSON` | Optional `/capabilities` dump for advertised-price cross-check |
| — | `DISCOVERY_URL` | Optional discovery raw endpoint (public LV2V orch list) |
| — | `LV2V_MODEL` | LV2V model id, default `streamdiffusion` |
| `NAAP_KEY` | `NAAP_KEY` | `naap_…` front-door key (validate stage / full path) |
| `NAAP_VALIDATE_URL` | `NAAP_VALIDATE_URL` | `https://operator.livepeer.org/api/v1/keys/validate` |
| `PYMTHOUSE_M2M_CLIENT` | `PMTH_M2M_ID` | pymthouse M2M client id (metering read / validate) |
| `PYMTHOUSE_M2M_SECRET` | `PMTH_M2M_SECRET` | pymthouse M2M client secret |
| `PYMTHOUSE_APP_ID` | `PMTH_APP` | pymthouse app id `app_98575870…` (OpenMeter usage lookups) |

Example export block (fill in your own secrets — do not commit):

```bash
export BYOC_SIGNER_URL="https://pymthouse-signer-test-production.up.railway.app"
export COMPOSITE_BEARER="Bearer app_<24hex>_pmth_<secret>"
export BYOC_ORCH_URL="https://byoc-staging-1.daydream.monster:8935"
export LR_ORCH="https://liverunner-staging-1.daydream.monster:8935"
export GATEWAY_SRC="../livepeer-python-gateway/src"   # if running from repo root
export NAAP_KEY="naap_…"
export NAAP_VALIDATE_URL="https://operator.livepeer.org/api/v1/keys/validate"
export PMTH_M2M_ID="m2m_…"; export PMTH_M2M_SECRET="…"; export PMTH_APP="app_98575870…"
```

## Step-by-step run instructions

Run everything with the **gateway** interpreter (`$GWPY`) so the gateway deps are
importable. All commands below assume you run from this repo's root.

### 0. Validate front door (optional, proves the composite bearer origin)

```bash
curl -sS -X POST "$NAAP_VALIDATE_URL" -H "Authorization: Bearer $NAAP_KEY" \
  | jq '.data.signerSession | keys'      # expect ["headers","url"]
```

PASS = HTTP 200, `valid:true`, `providerSlug:pymthouse`, and `signerSession` in
**endpoint form** `{url, headers}` whose `headers.Authorization` is the composite
`app_…_pmth_…` bearer (this is exactly what you put in `COMPOSITE_BEARER`).

### 1. Single-capability billed generation (control: byoc-staging-1)

```bash
BYOC_CAPABILITY=flux-schnell GATEWAY_SRC="$GATEWAY_SRC" \
  "$GWPY" scripts/run50-direct-signer-probe.py
```

Expected PASS output: `submit_byoc_job: PASS (…s) HTTP 200` plus a real
`image_url` (fal.media JPEG). This exercises signer auth → payment → generation
in one shot.

### 2. Multi-capability price / unit / label + payment decode

```bash
curl -sS https://sdk.daydream.monster/capabilities -o /tmp/caps.json
CAP_LIST='flux-schnell,flux-dev,nano-banana,recraft-v4,ltx-t2v' \
  GATEWAY_SRC="$GATEWAY_SRC" CAPS_JSON=/tmp/caps.json \
  "$GWPY" scripts/run53-multicap-probe.py
```

For each cap this prints a JSON row + a summary table: orch `PriceInfo`, payment
`ExpectedPrice`, `price_match_orch`, advertised×1.01 check, and `paygen` HTTP.
Expected: `paygen 200`, `ExpectedPrice == orch PriceInfo`, `match=True`.

### 3. LR-orch vs byoc-staging-1 (pricing diagnosis)

```bash
LR_ORCH="$LR_ORCH" GATEWAY_SRC="$GATEWAY_SRC" \
  "$GWPY" scripts/run55-lr-orchinfo-diag.py     # per-cap PriceInfo side by side
LR_ORCH="$LR_ORCH" GATEWAY_SRC="$GATEWAY_SRC" \
  "$GWPY" scripts/run55-lr-generic-diag.py      # generic + native LV2V pricing
```

Expected: `byoc-staging-1` shows non-zero per-cap `PriceInfo` and 136
`capabilities_prices`; `liverunner-staging-1` shows `0/1` and `0` (the known LR
blocker). For the full LR walkthrough see
[Scenario: Test against `liverunner-staging-1`](#scenario-test-against-liverunner-staging-1-lr-orch).

### 4. Explicit auth-vs-payment stage split (LR path, PR #430)

```bash
LR_ORCH="$LR_ORCH" GATEWAY_SRC="$GATEWAY_SRC" \
  "$GWPY" scripts/run57-lr-auth-vs-pay.py
```

Expected: `[STAGE signer-auth] … PASS 200 (composite ACCEPTED)` then
`[STAGE payment] … HTTP 400 … missing or zero priceInfo -> LR CONFIG (zero
price)`. This proves auth (PR #430) works and the only LR failure is pricing.

### 5. Native live-video-to-video (LV2V) envelope probe

```bash
LV2V_MODEL=streamdiffusion GATEWAY_SRC="$GATEWAY_SRC" \
  DISCOVERY_URL="$DISCOVERY_URL" \
  "$GWPY" scripts/run55-lv2v-probe.py
```

Exercises `type:lv2v` cap-35: advertise check, signer payment envelope, public
orch discovery, and `POST /live-video-to-video`. Note billed streamed generation
is **blocked** on our infra (no cap-35 runner attached to a chain-matched orch).

### Reading PASS/FAIL per stage

| Stage | PASS looks like | FAIL looks like |
|---|---|---|
| validate | 200, `signerSession {url,headers}`, composite bearer | 503 `Billing provider unavailable`; token-bundle only |
| signer auth | `/sign-orchestrator-info` 200 (composite ACCEPTED) | 401 `not a JWT` |
| payment | `/generate-live-payment` 200, ~281 B `net.Payment`, `ExpectedPrice==orch` | 400 `missing or zero priceInfo`; `IncompleteRead` |
| generation | `submit_byoc_job` 200 + real `image_url` | 400 `Could not parse payment` / `Could not verify job creds` |
| metering | OpenMeter row `byoc/<cap>` (+1 req, +µUSD) | `unknown` label; no delta |

## Scenario: Test against `liverunner-staging-1` (LR-orch)

A first-class, repeatable scenario for pointing the **entire** billed path at the
**LR orchestrator** instead of the priced control. This is the Run 57 setup and
its outcome is **known and expected today**: PR #430's composite-bearer auth
**holds**, and the only failure is the LR-orch's zero-pricing config.

### Env config (LR-orch)

Reuse the composite bearer + signer + naap-key vars already documented, and point
the orch at the LR host:

```bash
export BYOC_ORCH_URL="https://liverunner-staging-1.daydream.monster:8935"  # LR-orch (DNS 136.66.21.17)
export LR_ORCH="https://liverunner-staging-1.daydream.monster:8935"        # run55-lr-* / run57 read this
# already set: BYOC_SIGNER_URL, COMPOSITE_BEARER, NAAP_KEY, NAAP_VALIDATE_URL, GATEWAY_SRC
```

### Commands (LR path — only real scripts in the repo)

```bash
# 1. validate front door → composite bearer in endpoint form
curl -sS -X POST "$NAAP_VALIDATE_URL" -H "Authorization: Bearer $NAAP_KEY" \
  | jq '.data.signerSession | keys'      # expect ["headers","url"]

# 2. explicit auth-vs-payment stage split on the LR path (the key probe)
LR_ORCH="$LR_ORCH" GATEWAY_SRC="$GATEWAY_SRC" \
  "$GWPY" scripts/run57-lr-auth-vs-pay.py

# 3. confirm LR advertises zero price (vs byoc control), per-cap + generic
LR_ORCH="$LR_ORCH" GATEWAY_SRC="$GATEWAY_SRC" "$GWPY" scripts/run55-lr-orchinfo-diag.py
LR_ORCH="$LR_ORCH" GATEWAY_SRC="$GATEWAY_SRC" "$GWPY" scripts/run55-lr-generic-diag.py

# 4. billed multi-cap against LR (expect paygen 400 "missing or zero priceInfo")
CAP_LIST='flux-schnell,flux-dev,gpt-image' BYOC_ORCH_URL="$LR_ORCH" \
  GATEWAY_SRC="$GATEWAY_SRC" "$GWPY" scripts/run53-multicap-probe.py

# 5. full submit against LR (expect 400 "Could not verify job creds")
BYOC_CAPABILITY=flux-schnell BYOC_ORCH_URL="$LR_ORCH" \
  GATEWAY_SRC="$GATEWAY_SRC" "$GWPY" scripts/run50-direct-signer-probe.py
```

### Expected result per stage (Run 57 reality)

| Stage | Expected on LR-orch | Evidence |
|---|---|---|
| 1. NaaP validate | ✅ **PASS** | 200, `valid:true`, `providerSlug:pymthouse`, `signerSession {url,headers}` |
| 2. Composite bearer (PR #430) | ✅ **PASS** | `headers.Authorization` = `Bearer app_…_pmth_…` (composite, **not** opaque `pmth_`) |
| 3. Signer auth `/sign-orchestrator-info` | ✅ **PASS** | `get_orch_info(liverunner-staging-1)` signed 200, composite **accepted**, recipient `0x180859c3…`, `ticket_params` present — **NOT** 401 `not a JWT` |
| 4. Billed `/generate-live-payment` | ❌ **FAIL — LR config** | **HTTP 400 `missing or zero priceInfo`** — LR advertises `PriceInfo 0/1` + empty `capabilities_prices`; composite accepted, price is the blocker |
| 5. Generation `submit_byoc_job` | ❌ **FAIL — LR config** | **HTTP 400 `Could not verify job creds`** (~0.9 s) — gateway skips payment on `face_value==0`, orch rejects the unpaid job (downstream of stage 4) |
| 6. Metering | ✅ **$0 (expected)** | LR probes mint no payment → no OpenMeter delta, no `unknown` row created |

### Callout — this is the expected/known outcome

> **The LR failure is expected and is NOT a NaaP/auth bug.** PR #430's
> composite-bearer path is fully exercised and **PASSES** on the LR-orch (validate
> emits the composite; the signer accepts it at `/sign-orchestrator-info`; the
> billed endpoint is reached and returns a **pricing** error, not `401 not a
> JWT`). The **only** reason billing doesn't complete on `liverunner-staging-1` is
> its **pre-existing zero-pricing config** — structural orchestrator infra owned
> by **John / orch-infra**, unrelated to NaaP or PR #430.

### Contrast with the `byoc-staging-1` control

Run the same bearer against the priced control to prove the stack is intact:

```bash
BYOC_CAPABILITY=flux-schnell BYOC_ORCH_URL="https://byoc-staging-1.daydream.monster:8935" \
  GATEWAY_SRC="$GATEWAY_SRC" "$GWPY" scripts/run50-direct-signer-probe.py
```

| Orch | Stage 4 payment | Stage 5 generation | Meaning |
|---|---|---|---|
| `liverunner-staging-1` (LR) | ❌ 400 `missing or zero priceInfo` | ❌ 400 `Could not verify job creds` | **Expected** — LR zero-priced (John/orch-infra) |
| `byoc-staging-1` (control) | ✅ 200, ~281 B `net.Payment` | ✅ 200 + real fal.media image | Proves composite/signer/payment/#3993 stack works |

Same composite bearer, same signer, same code — **only the orch differs**. LR
failing on price while byoc succeeds is the signature of an LR-orch config gap,
not a client/auth regression.

## Interpreting results

- **Composite bearer passes `/generate-live-payment`.** The
  `app_<24hex>_pmth_<secret>` composite is accepted by the remote-signer webhook
  at both `/sign-orchestrator-info` (unbilled) and `/generate-live-payment`
  (billed). This is PR #430's design.
- **Opaque `pmth_` session fails 401 `not a JWT`.** The opaque token-bundle form
  is rejected by the billed endpoint. Always forward the **composite** bearer.
  (`/sign-orchestrator-info` is a useful unbilled probe of this auth asymmetry.)
- **`byoc-staging-1` is the fully-priced control.** It advertises 136 per-cap
  prices with the #3993 overhead fix (advertised == bound × 1.01), so payment +
  generation complete and return real images.
- **LR-orch (`liverunner-staging-1.daydream.monster:8935`, DNS `136.66.21.17`)
  zero-pricing is a known config blocker.** Its signature: `PriceInfo 0/1` and
  **empty `capabilities_prices`** for every cap (vs 136 priced caps on
  `byoc-staging-1`), so `/generate-live-payment` → 400 `missing or zero priceInfo`
  and generation never runs. Auth (PR #430) is fine; the gap is orch config.
  **Owner: John / orch infra.** See the dedicated LR-orch scenario above.
- **Metering fee is a floor on the byoc path.** OpenMeter meters at payment-gen
  (`platform_ingest`) at a ~1 µUSD/req floor; the true per-cap tariff (and the
  ~8.33× flux-dev:flux-schnell ratio) is authoritative on the **wei / on-chain**
  seam (payment `ExpectedPrice`, balance debit), not on `networkFeeUsdMicros`.

## Troubleshooting

| Error / symptom | Known cause | Fix |
|---|---|---|
| `401 not a JWT` at signer | Opaque `pmth_` session forwarded instead of composite | Set `COMPOSITE_BEARER` to the `app_…_pmth_…` composite (PR #430) |
| `IncompleteRead(N, M)` | Signer response truncated mid payment-gen (auth passed, payment errored) | Check sender reserve / signer payment path; usually a downstream payment bug, not auth |
| `400 Could not parse payment` | Orch ticket validation: `ExpectedPrice` ≠ bound price (1% overhead mismatch) or unfunded reserve | Ensure orch has #3993 (advertised == bound × 1.01); fund sender reserve for the signer wallet |
| `400 Could not verify job creds` | Orch advertised zero price → gateway skips payment (`face_value==0`) → unpaid job rejected | Point at a priced orch (`byoc-staging-1`); LR-orch is unpriced by design today |
| `400 missing or zero priceInfo` | Orch advertises `PriceInfo 0/1` / empty `capabilities_prices` (LR-orch) | Use a fully-priced orch, or have John deploy BYOC per-cap pricing on the LR box |
| `invalid job type` | Signer `type:byoc` gate not deployed on that signer | Use the test-production signer that has the `type:byoc` gate |
| `recipientRand` / `RecipientRandHash` mismatch | Advertised price ≠ bound price (pre-#3993 overhead bug) | Deploy #3993 on the orch (byoc-staging-1 already has it) |
| `503 Billing provider unavailable` at validate | Prod `PYMTHOUSE_M2M_CLIENT_SECRET` stale/revoked on Vercel (M2M secret drift) | Refresh the M2M secret env on the naap-platform Vercel project + redeploy |
| `insufficient sender reserve` | Signer wallet has no deposit/reserve on the orch's chain | Fund the signer wallet reserve on the matching chain (test-production) |
| `503 insufficient capacity` (LV2V) | No cap-35 (`streamdiffusion`) runner attached to a chain-matched orch | Attach an LV2V runner to a test-production orch, or accept LV2V-gen is unbillable on our infra |

## Coverage caveats — what this does NOT test

- **The MCP → SDK-service hops** when the prod flags are OFF. The probe replaces
  exactly that client-routing hop; it does not exercise Storyboard/MCP →
  `sdk.daydream.monster` → `_effective_signer` in prod.
- **Production orchestrators.** All generation runs against **staging** orchs
  (`byoc-staging-1` / `liverunner-staging-1`), never a prod orch.
- **True per-unit metering.** OpenMeter fee on the byoc path is a per-request
  floor; megapixels / seconds / characters / tokens are not carried on the USD
  seam. Unit-correctness lives only on the wei/on-chain seam.
- **Billed LV2V streamed generation.** Blocked on our infra (no chain-matched
  cap-35 runner); only the LV2V payment envelope + metering label are verified.

## References

Scripts (in `scripts/`):

- `run50-direct-signer-probe.py` — single-cap billed `submit_byoc_job` (auth →
  payment → generation).
- `run53-multicap-probe.py` — multi-cap price / unit / label + `net.Payment`
  decode and advertised-price cross-check.
- `run55-lr-orchinfo-diag.py` / `run55-lr-generic-diag.py` — LR vs byoc
  `OrchestratorInfo` (per-cap and generic pricing).
- `run57-lr-auth-vs-pay.py` — explicit auth-vs-payment stage split on the LR
  path (PR #430 evidence).
- `run55-lv2v-probe.py` — native `type:lv2v` cap-35 envelope / advertise /
  orch-accept probe.

Run docs (authoritative flow + endpoints + per-run evidence):

- `USER-E2E-DEMO-RESULTS.md` — Runs 50–57 (billed E2E, multi-cap, LV2V, LR-orch,
  PR #430).
- `BILLED-E2E-BLOCKER-AUDIT.md` — blocker pipeline (auth / payment / pricing /
  reserve) with owners.
- `STORYBOARD-SIGNER-ROUTING.md` — the prod `SIGNER_FROM_VALIDATE` /
  `AUTH_VALIDATE_URL` gates and the `_effective_signer` decision node.

Key endpoints:

- Signer (test-production): `https://pymthouse-signer-test-production.up.railway.app`
  (`/healthz`, `/sign-orchestrator-info`, `/generate-live-payment`).
- Orchestrators (staging gRPC :8935): `byoc-staging-1.daydream.monster` (priced
  control), `liverunner-staging-1.daydream.monster` (zero-priced, LR blocker).
- NaaP validate: `https://operator.livepeer.org/api/v1/keys/validate`.
