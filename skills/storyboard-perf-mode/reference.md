# storyboard-perf-mode — test plan & measurement

Companion to [SKILL.md](SKILL.md). Grounding evidence:
`STORYBOARD-MCP-PERF-INVESTIGATION.html` and `STORYBOARD-PERF-SKILL-PROPOSAL.md`
(workspace root). This covers the **Option A MVP** only — Phase 2 self-learning is
not implemented.

## Metrics (reuse the perf harness)

Instruments already in the MCP: `session_id` tagging on every call ·
`get_perf_report` (p50/p95, success%) · `get_cost_report` (cost/asset) ·
`get_recent_failures` · `list_capabilities` (`live` flag).

| Metric | Definition | Baseline (investigation) | Target (fast mode) |
|---|---|---|---|
| **TTFP** | time to first visible preview/keyframe | 37–180s | **< 10s** |
| **E2E p50/p95** | submit → final asset | i2v p50 ~180s | pixverse ~48s |
| **i2v success rate** | done / attempts | 33% (`seedance-i2v-fast`) | **~100%** (warm cap) |
| **Throughput** | assets/min under parallel fan-out | ~sequential | N× (scene count) |
| **Cost/asset** | USD per delivered asset | incl. billed failures | lower (cheaper tier) |

## Deterministic tests (Option A — no spend)

Preference file + mode resolution can be validated without any generation.

```bash
S=skills/storyboard-perf-mode/scripts/perf_pref.py

# 1. Reset → unset (triggers first-use prompt path)
python3 "$S" reset            # expect: unset
python3 "$S" get              # expect: unset

# 2. Set + read back
python3 "$S" set fast         # expect: fast
python3 "$S" get              # expect: fast
python3 "$S" set quality      # expect: quality
python3 "$S" get              # expect: quality

# 3. Corrupt file → treated as unset (no crash)
echo 'not json' > ~/.storyboard/perf-preference.json
python3 "$S" get              # expect: unset

# 4. File shape
python3 "$S" set fast explicit_prompt
cat ~/.storyboard/perf-preference.json
# expect: { "bias": "fast", "set_at": "<iso8601 Z>", "source": "explicit_prompt" }
```

**Mode-resolution assertions (agent behavior, verify by inspection of the calls):**

- `mode=fast` → emits `quality:'fast'`, a warm-cap `model_override` for i2v,
  `subscribe_progress`, and **no** `prefer_fast:true` for `animate`.
- `mode=quality` → premium routing (`quality:'hq'`/`'balanced'`, premium image model).
- Precedence: in-message "draft this" beats a stored `quality` for that one run and
  does **not** overwrite the file; "remember this / always" **does** write.
- Phase 0: an `animate` path is never dispatched without a prior `list_capabilities`
  `live`-flag check, and `seedance-i2v-fast` is never selected.

## Integration test (both modes — budgeted, ~$2)

Run the same small scenario set (one i2v, one t2v, one image, one finishing op)
under each mode with `max_cost_usd` caps and a fresh `session_id` per mode:

```
session_id: perf-test-fast-<date>     (mode=fast)
session_id: perf-test-quality-<date>  (mode=quality)
```

Then compare against the metrics table:

```
get_perf_report({ since:'1h', capability:'pixverse-i2v' })
get_perf_report({ since:'1h', capability:'seedance-i2v-fast' })   # baseline, do NOT route here
get_cost_report({ scope:'session', session_id:'perf-test-fast-<date>' })
get_cost_report({ scope:'session', session_id:'perf-test-quality-<date>' })
```

**Pass criteria (fast mode):** i2v routes to a warm cap (`pixverse-i2v`), i2v
success ≈100%, TTFP < 10s via keyframe/draft, per-session cost < quality mode.

## Out of scope (Phase 2 — NOT built)

No behavioral signal capture, no `impatience` EWMA, no auto-nudge, no counters
block in the preference file. The file is one field (`bias`) plus provenance.
Phase 2 remains deferred per the approved proposal.
