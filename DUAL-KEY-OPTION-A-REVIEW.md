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
