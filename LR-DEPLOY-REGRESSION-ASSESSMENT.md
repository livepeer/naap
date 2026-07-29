# LR Deploy — Regression Assessment (BYOC-safety focus)

**Type:** investigation only — read-only. No code / infra / deploy changes. `byoc-staging-1` inspected read-only, **never touched**.
**Question:** Would the planned deploy — swap the stale BYOC-only SDK/gateway image for a latest `ja/live-runner` gateway build + deploy a `v0.9.0`/≥`#3999` remote-signer + repoint discovery at the `v0.9.0` orch `:8936` — **regress** anything currently working, especially `byoc-staging-1` and its ~137 caps?

**Verdict: GO-WITH-MITIGATIONS.** The gateway/SDK swap and the discovery repoint are safe/additive. **The signer swap to a _raw_ `v0.9.0` image is a NO-GO as written — it is a HARD BYOC regression** because `v0.9.0` dropped the `/sign-byoc-job` route that every on-chain BYOC job on the shared `signer.daydream.live` (= `signer-staging-1/2`) depends on. Deploy a **merged signer** (`v0.9.0` fixed-pricing **+** the `SignBYOCJobRequest` handler) and the plan is GO.

---

## Regression surface table

| # | Surface | Risk | Evidence | Mitigation |
|---|---------|------|----------|------------|
| 1 | **BYOC dispatch symbols survive in `ja/live-runner` gateway** | **NONE** | `ja/live-runner` `src/livepeer_gateway/__init__.py` exports **every** symbol `app.py` imports: `ByocJobRequest, ByocTrainingRequest, LivepeerGatewayError, NoOrchestratorAvailableError, submit_byoc_job, submit_training_job, get_training_status, wait_for_training, list_capabilities, start_lv2v, StartJobRequest`. Submodule imports also present: `live_runner.call_runner`, `remote_signer.get_orch_info_sig` (byoc.py:105), `errors.SkipPaymentCycle` (errors.py:70), `media_publish.MediaPublish/MediaPublishConfig`, `media_output.MediaOutput`, `channel_writer.JSONLWriter`, `channel_reader.JSONLReader`. No dropped symbol → no import failure. | None needed. Pin gateway `ja/live-runner` tip `9f2bc20`. |
| 2 | **Single gateway ref has BOTH native `call_runner` AND all byoc symbols** | **NONE** | `ja/live-runner` ships BOTH `byoc.py` (`submit_byoc_job`, `StartJobRequest`) **and** `live_runner.py` (`call_runner`, `register_runner`, `_RUNNER_PAYMENT_TYPES_BY_UNIT`) in the **same branch**. `submit_byoc_job(req, *, orch_url, discovery_url, signer_url, signer_headers, timeout)` — signature-compatible with every `app.py` call site. | **No merge needed on the gateway.** `ja/live-runner` alone serves both planes. |
| 3 | **SDK routing: byoc caps stay on `byoc-staging-1`, not `:8936`** | **LOW** | `_lr_eligible()` (app.py:208) gates LR dispatch on `SDK_MULTI_ORCH_ENABLED` **AND** `cap ∈ LR_OFFERINGS/LR_MODEL_IDS` **AND** `cap ∈ LR_CAP_ALLOW` (`SELECT_PROVIDER_LR_CAPS`) **AND** canary pct. `LR_ORCH_DISCOVERY` (→`:8936`) feeds ONLY `_dispatch_lr`/`_dispatch_lr_v2`. BYOC routing is a **separate** path: `submit_byoc_job(orch_url=select_provider(cap))` → `_orch_for_capability` → `CAPABILITY_ORCH_MAP`/`ORCH_URL` (byoc-staging-1 `:8935`), unchanged by the discovery repoint. LR failure is **fail-open** back to BYOC (app.py:1349). | Keep `SELECT_PROVIDER_LR_CAPS`/`LR_OFFERINGS_JSON` scoped to the LR caps only. **Ensure no LR cap NAME collides with any of the 137 byoc cap names** — a collision would divert that byoc cap to `:8936`. |
| 4 | **v0.9.0 signer vs BYOC payment path (`/sign-byoc-job`)** | **HIGH** | **Route dropped in `v0.9.0`.** `c0e79ccb` (deployed) registers `POST /sign-orchestrator-info`, `POST /generate-live-payment`, **`POST /sign-byoc-job`** (`SignBYOCJobRequest`) + imports `.../byoc`. **`v0.9.0` registers only the first two + `discover-orchestrators` — `/sign-byoc-job` is GONE, and `byoc` is not referenced at all** in `server/remote_signer.go`. The gateway `byoc.py:250` hard-codes `url = f"{signer}/sign-byoc-job"` for on-chain BYOC. `simple-infra/environments/shared/signers.yaml:18-19`: *"Image MUST include /sign-byoc-job endpoint… Without it, all BYOC inference fails with 'Could not verify job creds.'"* `SIGNER_URL = https://signer.daydream.live` = the **shared** `signer-staging-1/2` HA pair (signers.yaml:33-49). → Raw `v0.9.0` on those VMs = **all 137 byoc-staging-1 caps fail on-chain (404 `/sign-byoc-job`).** | **Deploy a MERGED signer**: `v0.9.0` (has `RemoteType_Fixed`) **+ cherry-pick `SignBYOCJobRequest` / `feat/add-byoc-signing`**. See "single ref" section — **no existing ref has both.** |
| 5 | **Daydream `sk_` path** | **LOW** | Daydream e2e is **lv2v** via `POST /generate-live-payment` (`RemoteType_LiveVideoToVideo` + `RemoteType_Live`) — **both retained** in `v0.9.0` (remote_signer.go:35-37, 486). `RemoteType_Fixed` is **additive** (no removal of live/lv2v). So the lv2v/daydream plane survives a v0.9.0 signer. `signer.daydream.live` is shared, so the merged-signer fix (surface 4) also protects any daydream flow that uses on-chain BYOC. | Covered by the surface-4 merged signer. Verify daydream lv2v post-deploy (`/generate-live-payment` unchanged). |
| 6 | **Capability discovery / registration** | **LOW** | New SDK image doesn't change byoc discovery: `list_capabilities` still exported; byoc caps resolve via `select_provider`→`CAPABILITY_ORCH_MAP`/`ORCH_URL` (byoc-staging-1). LR caps discovered **additively** via `LR_ORCH_DISCOVERY` (`:8936`) + `LR_OFFERINGS_JSON`. No registry rewrite. | Keep `LR_OFFERINGS`/discovery additive; don't remove byoc entries from `CAPABILITY_ORCH_MAP`. |
| 7 | **`byoc-staging-1` orchestrator itself** | **NONE (orch) / see #4 (its caps)** | The plan touches `sdk-staging-1` (image), `signer-staging-1/2` (signer), and SDK discovery env only. It requires **no change to the `byoc-staging-1` VM / `:8935` orch** — separate on-chain orchestrator. | `byoc-staging-1` stays exactly as-is and keeps serving its caps — **provided** the shared signer keeps `/sign-byoc-job` (surface 4). |

---

## Does ONE ref serve BOTH native + byoc? (the explicit answer)

**Gateway / SDK — YES.** `livepeer-python-gateway` `ja/live-runner` (tip `9f2bc20`) contains **both** the native live-runner path (`live_runner.py`: `call_runner`, `register_runner`) **and** the full BYOC symbol set (`byoc.py`: `submit_byoc_job`, `StartJobRequest`, `get_orch_info_sig`, `SkipPaymentCycle`, `MediaPublish`, …) that `app.py` imports. **A raw `ja/live-runner` gateway build is safe — no merge required.** (This is the same reason a prior worker pinned the BYOC `426f019`; but `ja/live-runner` supersedes it because it *also* carries the byoc symbols alongside `call_runner`.)

**Signer — NO. This is the crux.** In `go-livepeer`, the two lines **diverged at `cbd29d89` (2026-06-30)** and neither is an ancestor of the other:

| Signer ref | `RemoteType_Fixed` (LR single-shot) | `POST /sign-byoc-job` (BYOC on-chain) |
|---|---|---|
| `c0e79ccb` (deployed, Jun-10) | ❌ | ✅ |
| `go-livepeer` `ja/live-runner` (`c2db3cbc`, Jul-13) | ❌ | ✅ (SignBYOCJobRequest present) |
| `v0.9.0` | ✅ | ❌ (route + byoc import removed) |

→ **No existing single signer ref has both.** A raw `v0.9.0` signer on the shared `signer.daydream.live` fixes the LR fixed path **but breaks all BYOC signing**. The required artifact is a **merged signer**: `v0.9.0` **+** the `SignBYOCJobRequest`/`feat/add-byoc-signing` handler cherry-picked in. (Alternative — deploy `v0.9.0` to a *new* dedicated LR-fixed signer and keep `signer-staging-1/2` on a `/sign-byoc-job`-capable image — is **not** viable without SDK changes, because `app.py` resolves a **single** `SIGNER_URL` via `_effective_signer` for both the byoc and LR dispatch paths; it has no per-cap signer routing today.)

## v0.9.0-signer payment-type diff (`c0e79ccb` → `v0.9.0`)

| Payment type / endpoint | `c0e79ccb` (now) | `v0.9.0` | Effect on working paths |
|---|---|---|---|
| `RemoteType_LiveVideoToVideo` (`"lv2v"`) | ✅ | ✅ | lv2v preserved (daydream OK) |
| `RemoteType_Live` (`"live"`) | ✅ | ✅ | live preserved |
| `RemoteType_Fixed` (`"fixed"`) | ❌ | ✅ **added** | enables LR fixed single-shot (`billableUnits=1`, `numTickets ~1`) — the goal |
| `POST /generate-live-payment` | ✅ | ✅ | lv2v/live payment preserved |
| `POST /sign-orchestrator-info` | ✅ | ✅ | preserved |
| **`POST /sign-byoc-job` (`SignBYOCJobRequest`)** | ✅ | ❌ **REMOVED** | **HARD BYOC REGRESSION** — 137 byoc-staging-1 caps fail |

Net: `v0.9.0` is **additive** for lv2v/live/fixed but **subtractive** for BYOC signing. That single removal is the entire risk.

---

## Verdict

**GO-WITH-MITIGATIONS.**

- ✅ **GO** — Gateway/SDK: rebuild `sdk-service` from `ja/live-runner` (`9f2bc20`). Serves both byoc + native; imports and `submit_byoc_job` signature verified compatible. No regression.
- ✅ **GO** — Discovery repoint `LR_ORCH_DISCOVERY` → `:8936`: additive to LR caps only; byoc routing (`ORCH_URL`/`CAPABILITY_ORCH_MAP` → `:8935`) untouched; fail-open to BYOC. (Verify no LR-vs-byoc cap-name collision in `SELECT_PROVIDER_LR_CAPS`/`LR_OFFERINGS_JSON`.)
- ⛔ **NO-GO as written / must mitigate** — Signer: do **not** deploy a **raw** `v0.9.0` to `signer-staging-1/2`. Deploy a **merged signer** (`v0.9.0` + `SignBYOCJobRequest`/`feat/add-byoc-signing`). With that merge, lv2v (daydream), fixed (LR), and byoc all coexist → GO.
- ✅ **byoc-staging-1 orch: untouched** — no VM/`:8935` change required. It keeps serving its caps **iff** the shared signer retains `/sign-byoc-job` (the merged-signer mitigation).

### Single biggest risk (one line)
**The `v0.9.0` remote-signer dropped `POST /sign-byoc-job`; the shared `signer.daydream.live` (= `signer-staging-1/2`) is what every on-chain BYOC job on `byoc-staging-1` uses — so a raw `v0.9.0` signer breaks all 137 byoc caps. Mitigation: ship a merged signer that has BOTH `RemoteType_Fixed` AND `/sign-byoc-job` (no single existing ref has both).**

---

*Evidence (read-only): `livepeer-python-gateway` `origin/ja/live-runner` — `src/livepeer_gateway/{__init__.py, byoc.py:105/250/299, errors.py:70, remote_signer.py:105}`; `simple-infra/sdk-service-build/app.py` (imports L51-63, `_lr_eligible` L208, `_dispatch_lr`/`_v2` L222/290, `/inference` L1329-1384, `_effective_signer` L904); `simple-infra/environments/{shared/signers.yaml:18-49, staging/byoc.values.yaml:46-47}`, `docker-compose/sdk-service.yaml:10`; `go-livepeer` `server/remote_signer.go` at `c0e79ccb` (routes L143-145) vs `v0.9.0` (routes L82-90, consts L35-37) vs `origin/ja/live-runner` (`c2db3cbc`, routes L144-146); `git merge-base --is-ancestor ja/live-runner v0.9.0` → diverged at `cbd29d89` (2026-06-30). Cross-checked against `LR-JOHN-DEPLOY-RUNBOOK.md` and `LR-AUTHOR-INPUTS-INVESTIGATION.md`.*
