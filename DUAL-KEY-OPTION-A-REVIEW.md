# Dual-Key Option A — Critical Review Verdict (Rev 2)

**Plan reviewed:** `DUAL-KEY-OPTION-A-IMPL-PLAN.html` (Rev 2, commit `1b1d08ca`, branch `docs/pricing-scope-simplified`)
**Source of truth:** `livepeer/simple-infra` `sdk-service-build/app.py` (local checkout, byte-identical spans verified)
**Reviewer:** seanhanca · **Date:** 2026-07-29

## Verdict

| Gate | Result |
|------|--------|
| **COMPLETE** | ✅ All three PRs, config surface, routing flow, test matrix, rollout, and rollback are specified and mutually referenced. |
| **CONSISTENT** | ✅ Config table (§4) ↔ routing flow (§3) ↔ test matrix (§6) ↔ PR breakdown (§5) agree after 3 minor citation fixes (below). |
| **NO MAJOR FLAWS** | ✅ No confirmed-good path regresses with flags OFF; no flag is unimplementable at its seam. Proceeding to Phase 2. |
| **NOT OVER-ENGINEERED** | ✅ 6 env vars total (4+1+1), all default-legacy, single symmetrical pin flag, glob-not-regex. Minimal for the stated goals. |

## Grounding — every cited line verified against real `app.py`

| Claim in plan | Verified in `app.py` |
|---|---|
| `_effective_signer` = `:904-923` | ✅ `async def _effective_signer` at 904; fall-through `return SIGNER_URL` at 923 |
| `_resolve_validate_session` = `:833-901`, `startswith("naap_")` at `:854` | ✅ exact |
| `_lr_eligible` = `:208-219` | ✅ exact (`def _lr_eligible(cap_name)` at 208) |
| `_dispatch_lr_v2` = `:290`, `_dispatch_lr` = `:222` | ✅ exact |
| dispatch call site `/inference` = `:1329-1332` | ✅ `if _lr_eligible(...)` at 1329, `_lr_fn(...)` at 1332; BYOC fail-open `except` at 1349-1350 |
| `SIGNER_FROM_VALIDATE:373`, `AUTH_VALIDATE_URL:372`, `SIGNER_URL:351` | ✅ exact |
| `LR_ORCH_DISCOVERY:128`, `SELECT_PROVIDER_LR_CAPS→LR_CAP_ALLOW:149` | ✅ exact |

## Zero-regression confirmation (flags OFF)

- **PR1** `KEY_ROUTING_FROM_ENV=0` → `_effective_signer` never calls `_match_key_path`; the legacy `startswith("naap_")` branch runs unchanged. Byte-identical.
- **PR2** `ORCH_PIN_BY_PATH=0` → the dispatch call site keeps today's `_lr_eligible`-gated LR attempt with BYOC fail-open (`:1349-1350`) and leaves the daydream path untouched.
- **PR3** `NAAP_FAIL_CLOSED=0` → the pymthouse branch keeps falling through to `SIGNER_URL` at `:923`.
- Test-matrix rows **1 & 3** (the two confirmed paths: Daydream→lv2v→byoc, naap→pymthouse→LR) are unchanged; rows **6 & 7** prove the default patterns reproduce them.

## Minor corrections applied directly to the HTML plan

1. **PR3 citation (§4 + §5).** The reject must be inserted at the fall-through return `_effective_signer:923`, not `:921` (line 921 is the *success* branch returning the per-key signer). Also documented the prerequisite that `NAAP_FAIL_CLOSED` is only effective when `SIGNER_FROM_VALIDATE=1` — otherwise `_effective_signer` returns early at `:918` and never reaches the pymthouse branch.
2. **PR2 enforcement seam (§4).** Clarified that `_lr_eligible(cap_name)` alone has no path context, so the pin is enforced at the `/inference` dispatch call site (`:1329-1352`) where `signer_url_eff` is already available. Added the operational definition of "resolved path": `signer_url_eff == SIGNER_URL` ⇒ daydream, else (per-key session signer) ⇒ pymthouse.
3. **PR1 consistency note (§5).** `_resolve_validate_session` independently hard-gates on `startswith("naap_")` at `:854`. Default `KEY_PATTERN_PYMTHOUSE=naap_*` is byte-identical, but a *non-`naap_`* pymthouse pattern requires the engine to relax that `:854` gate for the matched path — otherwise such keys route to pymthouse in `_effective_signer` yet resolve no session. Default patterns and both confirmed paths are unaffected.

## Observations carried forward (not blockers)

- **NAAP_FAIL_CLOSED vs KEY_ROUTING_UNMATCHED are disjoint** — the former handles a *matched* pymthouse key with no session (row 5); the latter handles a key matching *no* pattern (row 8). No overlap; both can be enabled independently.
- **ORCH_PIN_BY_PATH assumes the pymthouse signer plane is active** (`SIGNER_FROM_VALIDATE=1`). Enabling it where the signer plane is off would classify all traffic as the daydream path and exclude it from LR — an operator config concern, gated by canary rollout + OQ-1, not a merge-time regression. Documented in the config guide.
- **OQ-1 (John) / OQ-2 (SDK owner)** remain open and correctly gate *enablement* (Phase 3), not merge. All three PRs ship flag-OFF.

## Decision

**Proceed to Phase 2.** All controls are implementable at the cited seams with zero regression when OFF. LOCKED decisions (`KEY_ROUTING_UNMATCHED=fail_closed` default; PR3 included) are preserved.

## Deploy (live-lineage layered) — 2026-07-29

Dual-key Option A was shipped to the LIVE SDK (`sdk.daydream.monster`, VM `sdk-staging-1`, `us-west1-b`) by **layering** the PR1/PR2/PR3 change set onto the LIVE image lineage — **not** by rebuilding from `origin/main` (which has diverged and lacks merit-selection + `CAPABILITY_ORCH_OFFERINGS`).

**Method (no gateway rebuild):**
- Extracted the exact dual-key change set from `simple-infra` main (`git diff cd07405..a5ea48f -- sdk-service-build/`): the new `key_routing.py` classifier + the `app.py` wiring hunks from PR1 (`#112`/`6abf96e`), PR2 (`#113`/`56e65d0`), PR3 (`#114`/`a5ea48f`).
- Pulled the LIVE `app.py` (sha256 `e860dd0e…`) out of the running container (`/app/app.py`) — this build HAS merit selection (`SELECT_PROVIDER_MERIT`), `CAPABILITY_ORCH_OFFERINGS`, and `provider_selection.py`, at different line numbers than main.
- **Ported the dual-key hooks onto the LIVE `app.py` by semantic location** (the `naap_` gate in `_resolve_validate_session`, the `_effective_signer` fall-through, the `/inference` `_lr_eligible` dispatch call site) — NOT by line number. Additive-only: an in-place diff against the pristine live `app.py` shows exactly 7 lines modified (each expanded, none deleted) and zero removals of merit/offerings/`provider_selection` code. Ported `app.py` sha256 `99104b53…`.
- Built the new image **`FROM` the live image** `optA-lr-multi-2026-07-23` (image id `sha256:7afbf749…`) on the VM (the base tag exists only locally on `sdk-staging-1`; its registry manifest was absent), `COPY`-ing only the ported `app.py` + new `key_routing.py` into `/app`. The `file:///sdk` gateway layer and all pip deps were **reused unchanged** — no reinstall, no gateway rebuild.
- Dual-key unit tests (`test_key_routing.py`, 20 cases) run green both locally and **inside the built image**.

**Image:**
- New: `us-docker.pkg.dev/livepeer-simple-infra/simple-infra/sdk-service:optA-lr-multi-dualkey-2026-07-29`
  - image id `sha256:15b89da1853ad5ed880edfa9a30ac4dd18a852f4584e04b153f9c7d249894f01`
  - registry manifest digest `sha256:a90c67cc8917070797a633a2748a4099a8f49516e6073d565e6d1caa448eba67`
- Base reused: `optA-lr-multi-2026-07-23` (image id `sha256:7afbf749852a808ca57e828f89358127900d781304c2874fe7fb51b9dd31af2c`).

**Swap (SDK-only, no `deploy-byoc.sh`):**
- Changed **only** the `SDK_IMAGE=` tag line in `/opt/sdk/.env` (backup: `/opt/sdk/.env.bak.dualkey-20260729-225901`; `diff` confirmed exactly one line changed). All ~15 runtime vars — `SELECT_PROVIDER_MERIT=1`, `SELECT_PROVIDER_MERIT_TTL=30`, `CAPABILITY_ORCH_OFFERINGS`, `SIGNER_FROM_VALIDATE=1`, `AUTH_VALIDATE_URL`, LR/validate wiring — preserved verbatim.
- `docker compose -f /opt/sdk/docker-compose.yaml up -d sdk-service` — recreated **only** the `sdk-service` container. `sdk-caddy`, `hermes`, `promtail` untouched. `deploy-byoc.sh` was **NOT** run; `byoc-staging-1` and the prod signers were **not** touched.

**All six dual-key flags remain DEFAULT-OFF** — none of `KEY_ROUTING_FROM_ENV`, `KEY_PATTERN_PYMTHOUSE`, `KEY_PATTERN_DAYDREAM`, `KEY_ROUTING_UNMATCHED`, `ORCH_PIN_BY_PATH`, `NAAP_FAIL_CLOSED` is set in `/opt/sdk/.env` or the running container env, so behavior is byte-identical to the live baseline (legacy `naap_` routing path).

**Post-deploy verification:**
- `sdk.daydream.monster/health` → HTTP 200; `/capabilities` → **172 caps** (unchanged from baseline).
- New code live: running image `…:optA-lr-multi-dualkey-2026-07-29`; in-container `/app/app.py` sha256 `99104b53…` (≠ live `e860dd0e…`); `/app/key_routing.py` present; `provider_selection.py` + `lr_offerings.py` present; 20 merit/offerings/provider references still in `app.py`.
- Live features intact: startup log `LR offering-driven dispatch ACTIVE: 9 offerings`; a real `ffmpeg-colorgrade` `/inference` returned **200 OK** (signed sender + payment tickets) — merit/offerings/per-key-signer paths all working. No tracebacks at startup.

**Rollback:** set `/opt/sdk/.env` `SDK_IMAGE=us-docker.pkg.dev/livepeer-simple-infra/simple-infra/sdk-service:optA-lr-multi-2026-07-23` (image id `sha256:7afbf749…`) and `docker compose up -d sdk-service`. The pre-swap `.env` is backed up at `/opt/sdk/.env.bak.dualkey-20260729-225901`.

> **NOTE — lineage drift:** `origin/main` of `simple-infra` remains diverged from the deployed live lineage — main carries the dual-key commits but **lacks** merit-selection and `CAPABILITY_ORCH_OFFERINGS`, while the live image has both. This deploy layered dual-key onto the live lineage rather than reconciling the two. A separate **lineage-reconciliation follow-up** is recommended to fold merit/offerings back into `main` (or forward-port dual-key into the canonical `sdk-service-build/` source) so the repo and the running image converge.

---

## Lineage reconciliation — merit/offerings/provider_selection landed in `main` (2026-07-29)

The lineage-drift follow-up noted above is **resolved**. Merit-based orchestrator selection, `CAPABILITY_ORCH_OFFERINGS` handling, and `provider_selection.py` are now captured in `simple-infra` `main` — **code capture only, NO deploy** (prod already runs this exact merit code).

**PR:** [livepeer/simple-infra#115](https://github.com/livepeer/simple-infra/pull/115) — *"Land live merit-based orch selection + CAPABILITY_ORCH_OFFERINGS + provider_selection into main (converge main with prod)"* — **MERGED**, merge commit `2e0024f7545ef849366aae57b4f87e667ec8ce99`.

**What was drifted:** `origin/main` (`a5ea48f`) had the dual-key PRs #112/#113/#114 (all default-OFF) but was missing merit-selection, `CAPABILITY_ORCH_OFFERINGS`, and `provider_selection.py`. Those live only in the deployed image lineage.

**Source of truth used:** the local `main` branch commits `9902cee` (generalized merit selection + `provider_selection.py` + `test_provider_selection.py`) and `a61a020` (merit probe reads BYOC per-cap price + capacity precisely), branched off the same base (`44a4e42`) as the dual-key PRs. Verified **byte-identical** to the live merit image `sdk-service:merit-precise-2026-07-20` (`docker cp` of `/app/app.py`, `provider_selection.py`, `lr_offerings.py` → `diff` = identical). These two commits were cherry-picked (`-x`, provenance preserved) onto a branch off `origin/main`; `app.py` auto-merged cleanly against the dual-key seams (only the Dockerfile `COPY` list needed a trivial both-keep resolution).

**`main` now captures:** `provider_selection.py`, `test_provider_selection.py`, and the merit/offerings rewiring of `select_provider()`/`_merit_probe` in `app.py` — alongside the pre-existing dual-key modules (`key_routing.py` + all six flags), all still **DEFAULT-OFF**. Env passthrough for `CAPABILITY_ORCH_OFFERINGS` / `SELECT_PROVIDER_MERIT` / `SELECT_PROVIDER_MERIT_TTL` already existed in `docker-compose/sdk-service.yaml` (default-empty). Tests: `test_key_routing.py` **20/20**, `test_provider_selection.py` **15/15**, `test_lr_offerings.py` 9/9 (44 total). No secrets committed.

**main ↔ live convergence:** `main`-after-PR `app.py` was diffed against the deployed superset `optA-lr-multi-dualkey-2026-07-29` (`/app/app.py` sha `99104b53…`). It is a **faithful superset of the live merit lineage + dual-key**; the **only** remaining delta is the separately-tracked `optA-lr-multi` native-dispatch features (comma-separated `LR_ORCH_DISCOVERY` multi-orch discovery, `direct-post` free single-shot dispatch, non-media LR result passthrough) which live on branch `fix/lr-native-dispatch-call-runner` and are **out of scope** for this merit reconciliation. Zero merit/dual-key differences. Folding that native-dispatch branch into `main` is the remaining step for full byte-convergence with the deployed image.
