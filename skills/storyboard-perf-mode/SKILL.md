---
name: storyboard-perf-mode
description: >-
  Run Storyboard MCP generations with a user-selectable performance bias — two
  explicit modes (prefer-quality default, prefer-fast) with a remembered
  preference. Routes image-to-video around the broken seedance-i2v-fast cap to
  warm caps (pixverse-i2v), streams previews, renders keyframes first, and
  parallel-fans-out for throughput. Use when the user runs Storyboard /
  Livepeer media generation (create_media, generate_project, submit_creative_job,
  moodboard_spread, create_variations, animate, i2v) or says "prefer faster
  iteration" / "prefer better quality" / "draft mode".
disable-model-invocation: false
---

# Storyboard Performance Mode

Bias Storyboard MCP (`user-storyboard`) generations toward **quality** (default) or
**fast iteration**, with the choice remembered across sessions in one small file.
The fast path exploits the one big finding from the perf investigation: **the
`live` (warm-orchestrator) flag predicts i2v success and speed**, and the MCP's
naive `prefer_fast:true` for `animate` routes straight into the worst capability
(`seedance-i2v-fast`: ~33% success, 176–181s). This skill routes around that.

> Scope: this is the **Option A MVP** (Phase 0 route-around + Phase 1 two-mode
> skill). Self-learning / adaptive behavior (Phase 2) is intentionally **not**
> implemented here.

## Workflow

Copy this checklist and track progress:

```
Perf-mode run:
- [ ] Step 1: Resolve mode (in-message override > stored file > default=quality)
- [ ] Step 2: First-use — if no stored preference, ASK once, then remember
- [ ] Step 3: Pre-flight live-flag check before any i2v (list_capabilities)
- [ ] Step 4: Stamp a session_id on every generation call
- [ ] Step 5: Apply the lever matrix for the resolved mode
- [ ] Step 6: Stream / keyframe-first for perceived latency (fast mode)
- [ ] Step 7: Measure with get_perf_report / get_cost_report (scope=session)
```

## Step 1 — Resolve the mode

Precedence (highest wins):

1. **In-message phrasing** — the current request's wording.
   - Fast: "prefer faster iteration", "faster iteration", "draft", "rough",
     "quick", "just try", "cheap", "preview".
   - Quality: "prefer better quality", "better quality", "final", "hero",
     "high quality", "for the deck", "premium".
   - An in-message override does **not** overwrite the stored file **unless** the
     user says "remember this" (or "always" / "from now on"). If they do, write
     the file (Step 2 contract).
2. **Stored preference file** — `~/.storyboard/perf-preference.json` (see below).
3. **Default** — `quality`.

Read the stored file with the helper (preferred — deterministic, cross-tool):

```bash
python3 skills/storyboard-perf-mode/scripts/perf_pref.py get
```

It prints `quality`, `fast`, or `unset` (exit 0). Any other tool runtime can read
the raw JSON directly — the file is the single source of truth.

## Step 2 — First-use prompt + memory

If Step 1 resolves to **`unset`** (no stored file and no in-message phrasing),
ask the user **exactly once**:

> Bias toward faster iteration (cheaper, warm models, previews first) or better
> quality (premium, full settings)? Default is quality.

Then persist the answer:

```bash
# after the user answers, or on any explicit "remember this" override:
python3 skills/storyboard-perf-mode/scripts/perf_pref.py set fast
python3 skills/storyboard-perf-mode/scripts/perf_pref.py set quality
```

If the user does not answer, proceed with **quality** for this run and do **not**
write the file (ask again next time).

### Preference file contract

- **Location:** `~/.storyboard/perf-preference.json` (home dir — readable/writable
  by Cursor, Claude Code, and Codex; one mechanism, no per-runtime branching).
- **Format:**
  ```json
  { "bias": "quality", "set_at": "2026-07-20T23:00:00Z", "source": "explicit_prompt" }
  ```
  `bias` ∈ `"quality" | "fast"`. `source` ∈ `"explicit_prompt" | "override"`.
- **Read:** at skill start (Step 1). Missing/corrupt file → treat as `unset`.
- **Write:** only on (a) the first-use prompt answer, or (b) an explicit
  "remember this" override. A plain in-message override is single-run and does
  **not** write.
- **Reset:** `python3 skills/storyboard-perf-mode/scripts/perf_pref.py reset`
  (or `rm ~/.storyboard/perf-preference.json`). User can inspect it any time.

## Step 3 — Phase 0 route-around (ALWAYS, both modes)

Before selecting **any** image-to-video (`animate` / i2v) capability:

1. Call `list_capabilities` (kind `ai`) and read each i2v cap's `live` flag.
2. **Prefer a warm (`live:true`) cap.** For `animate`, that is **`pixverse-i2v`**
   (warm, ~48s, ~100% success).
3. **Never** select `seedance-i2v-fast`, and **never** emit `prefer_fast:true`
   for `animate` — that routes to `seedance-i2v-fast` (~33% success, ~180s).
   `prefer_fast` is image-safe only.
4. If **every** i2v cap is cold, fall back to a still/keyframe or stock b-roll
   (`on_i2v_timeout:'fallback'` / `source:'stock'`) and tell the user — the skill
   cannot create GPU capacity.

This route-around alone flips i2v success ~33% → ~100% on the fast path.

## Step 4 — Session tagging (ALWAYS)

Generate one `session_id` per logical run (e.g. a UUID) and pass it on **every**
`create_media` call so the run is measurable via `get_cost_report({ scope:
'session', session_id })` and reconciles even on a shared demo key.

## Step 5 — The lever matrix (mode → exact MCP tool + param)

Every lever maps to a real `user-storyboard` parameter. No new MCP surface needed.

| Lever | prefer-fast | prefer-quality (default) | Tool · param |
|---|---|---|---|
| **Warm-cap routing** (biggest reliability win) | Pre-check `live`; route `animate` → `pixverse-i2v`; **never** `seedance-i2v-fast` | Same pre-check; premium warm cap ok | `list_capabilities` → `create_media.model_override` |
| **Video quality tier** | `quality:'fast'` → `pixverse-i2v` (warm, ~48s) | `quality:'hq'` → `kling-o3-i2v` (or `'balanced'`) | `create_media.quality` |
| **Image model** | `flux-schnell` (~1.6s) | `flux-dev` / `gpt-image` / premium | `create_media.model_override` (or `prefer_fast` — **image only**) |
| **⚠️ `prefer_fast` for animate** | **Do NOT use** — force `quality:'fast'` instead | n/a | `create_media.prefer_fast` (i2v-unsafe today) |
| **Duration** | shortest acceptable (4–5s) | as briefed | `create_media.duration` |
| **Resolution / aspect** | smaller / default | full target | `create_media.aspect_ratio` |
| **Draft-then-upscale** | fast draft image → `upscale` only the pick | render final directly | `create_media action:'generate'` then `action:'upscale'` |
| **Streaming first feedback** | `subscribe_progress` (2s cadence) | optional | `subscribe_progress.job_id` |
| **Preview-first multi-scene** | `checkpoint:'keyframes'` — cheap still per scene, review, then animate | single-pass full render | `generate_project.checkpoint` |
| **Parallel throughput** | `generate_project` / `create_variations` / `moodboard_spread` (parallel fan-out) | same, fewer at once | those tools |
| **Native multi-shot** | `generation_mode:'native'` → one Kling call ≤15s for 2–6 shots | `'scenes'` orchestrated | `submit_creative_job.generation_mode` |
| **Quality gate** | keep **off** (default) | `quality_gate:true`, `max_quality_retries:1–2` | `create_media.quality_gate` |
| **Timeout behavior** | `on_i2v_timeout:'fallback'` (never stalls) | `'wait'` (surface + ask) | `create_media.on_i2v_timeout` |
| **Budget guard** | `max_cost_usd` cap per call | higher cap | `create_media.max_cost_usd` |
| **Wait budget (router)** | low `wait_minutes` → auto-downgrade | high `wait_minutes` → keep premium | `generate_project.wait_minutes` |
| **Idempotency** (no dup spend on retry) | set `idempotency_key` | same | `create_media.idempotency_key` |
| **Measurement tag** | always stamp `session_id` | same | `create_media.session_id` |

## Step 6 — Perceived-latency first (fast mode)

For fast mode, show *something* fast, then upgrade:

- **Single asset:** draft a `flux-schnell` image (~1.6s) or keyframe first; only
  `upscale` / animate the pick.
- **Multi-scene:** `generate_project` with `checkpoint:'keyframes'` → returns cheap
  stills inline for review; resume to animate approved keyframes.
- **Any async job:** `subscribe_progress({ job_id })` to stream status inline
  instead of silent polling.

## Step 7 — Measure (makes the MVP testable)

Reuse the perf harness — same `session_id`, read back the metrics:

- `get_perf_report({ since, capability })` — p50/p95 latency + success rate per cap.
- `get_cost_report({ scope:'session', session_id })` — cost for exactly this run.
- `get_recent_failures` — what gaps got hit.

Metric targets (from the investigation): **TTFP < 10s** (fast) vs 37–180s baseline;
**i2v success ~100%** (warm cap) vs 33% (`seedance-i2v-fast`); **E2E p50 ~48s**
(pixverse) vs ~180s; throughput N× under parallel fan-out.

## Quality-phrasing guard (DON'T)

Even in fast mode, do **not** silently degrade an asset the user called "final",
"hero", or "for the deck" — respect quality phrasing and confirm before drafting.

## Infra ceilings this skill CANNOT fix (surface, don't hide)

Cannot create warm GPU capacity; cannot raise the ~180s abort ceiling; cannot fix
the mis-wired `prefer_fast:true → seedance-i2v-fast` at source (only route around);
cannot stop aborted-i2v billing. Surface these when they bite — the measurement in
Step 7 makes them visible.

## Additional resources

- Test plan + measurement harness detail: [reference.md](reference.md)
- Preference helper: `scripts/perf_pref.py` (get / set / reset) — **execute** it.

## Location & activation

This skill lives in the repo at `skills/storyboard-perf-mode/` (committed +
shared) because `.cursor/` is gitignored here. To have Cursor auto-discover it as
a personal/project skill, symlink or copy the directory into a skills path:

```bash
ln -s "$(pwd)/skills/storyboard-perf-mode" .cursor/skills/storyboard-perf-mode
```
