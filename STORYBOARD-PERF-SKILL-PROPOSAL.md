# Storyboard MCP — Performance-Bias Skill / Adaptive Agent Proposal

**Status:** Proposal for review — *no product code or skill has been built.* Approve before implementation.
**Author:** seanhanca · **Date:** 2026-07-20 · **Branch:** `fix/signer-composite-bearer-forward`
**Grounding:** [`STORYBOARD-MCP-PERF-INVESTIGATION.html`](./STORYBOARD-MCP-PERF-INVESTIGATION.html) (live root-cause investigation, same day) + `user-storyboard` MCP tool schemas.

---

## 0 · TL;DR feasibility verdict

**Is it *totally* doable with just a skill? → PARTLY (a big, real "partly").**

A skill/agent that biases the Storyboard MCP toward speed **can** deliver large wins on **perceived latency** and **reliability**, and moderate wins on **actual latency** and **throughput** — *by choosing warm models, streaming previews first, drafting-then-upscaling, and parallelizing.* It **cannot** create GPU / warm-orchestrator capacity, and it cannot raise the ~180 s SDK abort ceiling. Those are infra/server fixes.

The single most important finding from the perf investigation makes the verdict concrete:

> The slowness / "out of capacity" is **concentrated in image-to-video (i2v)** and traces to **Livepeer orchestrator / GPU capacity per capability**. A capability's **`live` (warm-orchestrator) flag correlates almost perfectly with success and speed.** Worst offender: **`seedance-i2v-fast`** — 33 % success, 176–181 s (vs an advertised 30 s), routinely hitting the ~180 s abort ceiling.

The cruel irony that drives the whole proposal: **the MCP's current `prefer_fast:true` for `animate` routes straight into `seedance-i2v-fast`, the single worst capability.** Meanwhile the `quality:'fast'` tier routes `animate` to `pixverse-i2v` — a **warm, 100 %-success, ~48 s** capability. So today, asking for "fast" the naive way makes things *slower and less reliable*.

**A skill can exploit exactly this gap** — bias toward *warm* caps and the *correctly-wired* fast tier — and get most of the perceived win **without any server change**. That is why the answer is "partly, but the skill-reachable part is worth shipping."

| Dimension | Can a skill/agent move it? | How | Ceiling (needs infra) |
|---|---|---|---|
| **Perceived latency** (time-to-first-preview) | ✅ **Large** | Stream previews (`subscribe_progress`), keyframe-first (`generate_project checkpoint:'keyframes'`), draft image before video | — |
| **Reliability** ("out of capacity") | ✅ **Large** | Pre-flight `live`-flag check via `list_capabilities`; route to warm caps; avoid `seedance-i2v-fast` | Cold caps with *no* warm orch anywhere |
| **Actual latency** | 🟡 **Moderate** | Fast tier / cheaper model, lower `duration`, fewer steps, draft-then-`upscale`, skip `quality_gate` | Model floor; 180 s abort ceiling |
| **Throughput** (jobs/min) | 🟡 **Moderate** | Parallel fan-out (`generate_project`, `create_variations`, `moodboard_spread`), `native` multi-shot | GPU concurrency on the network |
| **GPU / upstream capacity** | ❌ **None** | — | Warm-orchestrator provisioning; raise/tier 180 s ceiling; billing of aborted jobs |

---

## 1 · Two ways to deliver it (the choice you're making)

- **Option A — Explicit skill, two modes.** User says *"prefer faster iteration"* or *"prefer better quality"* (default). Deterministic. Remembered across sessions.
- **Option B — Self-learning adaptive agent.** Watches behavioral signals, learns the user's bias, and auto-adjusts — no explicit mode.

The rest of the doc specifies both, compares them head-to-head (§5), and recommends a **phased path**: ship A as the MVP, then layer B as a thin, interpretable, flag-gated nudge on top of A's levers.

---

## 2 · Option A — Explicit two-mode skill

### 2.1 Behavior
- **Default = "better quality."** No behavior change vs today except *safer routing* (prefer warm caps).
- **"prefer faster iteration"** flips a bias that pulls the levers in §2.3 toward speed/throughput.
- Activation is conversational: the user just says *"prefer faster iteration"* / *"prefer quality"* / *"draft mode"* etc. The skill maps loose phrasing → mode.
- **First-use prompt:** if no preference is stored anywhere (see §4), the skill asks **once**: *"Bias toward faster iteration (cheaper, warm models, previews first) or better quality (premium, full settings)? Default is quality."* — then remembers.

### 2.2 The lever matrix (mode → exact MCP tool + param)

Every lever below maps to a real, cited parameter in the `user-storyboard` schemas. **No new MCP surface is required for Option A.**

| Lever | faster-iteration | better-quality (default) | Tool · param |
|---|---|---|---|
| **Warm-cap routing** (biggest reliability win) | Pre-check `live` flag; route to warm sibling; **never** `seedance-i2v-fast` | Same pre-check; premium warm cap ok | `list_capabilities` → `create_media.model_override` |
| **Video quality tier** | `quality:'fast'` → `pixverse-i2v` (warm, ~48 s, 100 %) | `quality:'hq'` → `kling-o3-i2v` (or `balanced`) | `create_media.quality` |
| **Image model** | `flux-schnell` (~1.6 s) | `flux-dev` / `gpt-image` / premium | `create_media.model_override` or `prefer_fast` (image only) |
| **⚠️ `prefer_fast` for animate** | **Do NOT use** (routes to broken `seedance-i2v-fast`) — force `quality:'fast'` instead | n/a | `create_media.prefer_fast` (image-safe, i2v-unsafe today) |
| **Duration** | shortest acceptable (e.g. 4–5 s) | as briefed | `create_media.duration` |
| **Resolution / aspect** | smaller / default | full target | `create_media.aspect_ratio` |
| **Draft-then-upscale** | fast draft image → `upscale` only on the pick | render final directly | `create_media action:'generate'` then `action:'upscale'` |
| **Streaming first feedback** | `subscribe_progress` (2 s cadence, inline) | optional | `subscribe_progress.job_id` |
| **Preview-first multi-scene** | `checkpoint:'keyframes'` — cheap still per scene first, review, then animate | single-pass full render | `generate_project.checkpoint` |
| **Parallel throughput** | `generate_project` (scenes render in parallel), `create_variations`, `moodboard_spread` | same, fewer at once | `generate_project` / `create_variations` / `moodboard_spread` |
| **Native multi-shot** | `generation_mode:'native'` → one Kling call ≤15 s for 2–6 shots | `'scenes'` orchestrated | `submit_creative_job.generation_mode` |
| **Quality gate** | keep **off** (default) — saves seconds | `quality_gate:true`, `max_quality_retries:1–2` | `create_media.quality_gate` |
| **Timeout behavior** | `on_i2v_timeout:'fallback'` (stock b-roll, never stalls) | `'wait'` (surface + ask) | `create_media.on_i2v_timeout` |
| **Budget guard / throughput** | `max_cost_usd` cap per call | higher cap | `create_media.max_cost_usd` |
| **Wait budget (router)** | low `wait_minutes` → auto-downgrade to fast model | high `wait_minutes` → keep premium | `generate_project.wait_minutes` |
| **Idempotency (avoid dup spend on retry)** | set `idempotency_key` | same | `create_media.idempotency_key` |
| **Measurement tag** | always stamp `session_id` | same | `create_media.session_id` |

### 2.3 Expected wins (quantified from the investigation's own numbers)

- **Time-to-first-preview:** ~1.6 s (`flux-schnell` draft) or a keyframe still, vs **37–180 s** waiting on a video model. **~10–100× perceived-latency win.**
- **i2v reliability:** route `animate` to `pixverse-i2v` (warm, **100 %**, ~48 s) instead of `seedance-i2v-fast` (**33 %**, 176–181 s). **Success ~33 % → ~100 %; latency ~180 s → ~48 s** on the fast path.
- **Throughput:** parallel scene fan-out + `native` multi-shot (≤15 s for 2–6 shots) instead of N sequential 60–180 s renders.
- **Cost:** faster tiers are cheaper (`flux-schnell` $0.003 vs premium image; `pixverse` vs failed-but-billed `seedance`). Fast mode is *also* the cheaper mode.

---

## 3 · What a skill CANNOT do (honest ceiling)

Conditioned on the perf root-cause (Livepeer orchestrator / GPU capacity):

- **Cannot create warm-orchestrator / GPU capacity.** If *every* i2v cap is cold, no routing trick helps — the skill can only fall back to stock footage or a still.
- **Cannot raise the ~180 s SDK `/inference` abort ceiling.** Models whose real p50 is >180 s (seedance family, some kling/ray) will keep coin-flipping. *(Owner: SDK service / simple-infra.)*
- **Cannot fix server-side defects surfaced in the investigation:** aborted i2v jobs are still billed; the synchronous `mux_audio` mime-decode bug. *(Owner: Storyboard billing / ffmpeg finishing.)*
- **Cannot fix the mis-wired `prefer_fast:true` → `seedance-i2v-fast` routing** at the source — the skill can only *route around* it. The real fix (point fast-animate at `pixverse-i2v`) is a one-line server change and is **the single highest-impact fix overall**.

> **Implication:** the skill and the infra fixes are complementary, not substitutes. The skill is the fast, safe, shippable half; it should also *surface* the infra asks (it makes them visible by measuring them).

---

## 4 · Preference capture & memory (Option A)

**Design goals:** default = quality; ask **once** on first use if unset; remember across sessions; work across **Cursor / Claude Code / Codex**; simplest thing that works.

### Recommended: one small preference file (cross-environment source of truth)

```
~/.storyboard/perf-preference.json
{ "bias": "quality" | "fast", "set_at": "<iso8601>", "source": "explicit_prompt" }
```

- **Why a file:** all three agent runtimes (Cursor, Claude Code, Codex) can read/write a home-dir file. One mechanism, no per-environment branching, trivially testable, trivially resettable (`rm` the file), and inspectable by the user. This is the least-over-engineered option.
- **Read** at skill start; **write** on the first explicit choice or the first-use prompt answer.
- **Precedence:** in-message phrasing ("draft this") > stored file > default (quality). An in-message override does **not** overwrite the file unless the user says "remember this."

### Optional mirror (nice-to-have, not MVP)
- **Cursor:** mirror the choice into a Cursor **user rule** so it's visible in settings (via `cursor-app-control` if the rule-writing action is available in-session). Skip if the action isn't exposed — the file already covers Cursor.
- **Claude Code / Codex:** the file *is* the mechanism; no extra state needed.

**Anti-over-engineering:** one file, one field. No DB, no service, no schema migrations for Option A.

---

## 5 · Option B — Self-learning adaptive agent

An agent that infers the bias from behavior instead of asking. Evaluated honestly below.

### 5.1 Signals to learn from (observable, privacy-respecting)

| Signal | Implies | Source |
|---|---|---|
| High regenerate / re-run rate on same brief | wants faster drafts | count `create_media` / `create_variations` repeats per brief |
| Accepts first output (no redo) | quality is fine → keep quality | absence of regen |
| Cancels / abandons long jobs | impatience → faster tier | job cancel / no poll follow-through |
| Prompt phrasing: "quick", "draft", "rough", "just try" | fast | prompt text |
| Prompt phrasing: "final", "hero", "high quality", "for the deck" | quality | prompt text |
| Upscales/edits after a draft | draft-then-refine workflow → fast draft default | `action:'upscale'` after `generate` |
| Explicit thumbs / "love it" / "no, worse" | direct reward | user feedback |
| Abandonment right after a capacity/timeout error | route-to-warm matters more than tier | error + drop-off |

**Privacy stance:** only *counts and coarse categories* (not prompt contents beyond keyword flags) are persisted; store locally in the same preference file; user can inspect and wipe it. No server-side behavioral profile.

### 5.2 How it adapts (interpretable, not a black box)

- Maintain **one scalar**: `impatience` ∈ [0,1], updated as an **EWMA** over the signals above (`impatience ← (1-α)·impatience + α·signal`, α≈0.3).
- **Threshold, don't gradient-descend:** `impatience > 0.6` → nudge defaults toward the **faster-iteration** levers of §2.2; `< 0.4` → back to quality; hysteresis band in between to avoid flapping.
- The nudge pulls **the exact same levers as Option A** — nothing new to build downstream.
- **Transparency is mandatory:** when it flips, it says so — *"You've been regenerating a lot, so I switched to faster drafts. Say 'prefer quality' to switch back."* Always an easy one-phrase override.

### 5.3 Where learning/state lives

- **Same local preference file**, extended with a tiny counters block — **no ML, no model server.** EWMA + thresholds are ~20 lines of logic.
- **Cold-start:** default to **quality**; require **≥ K signals** (e.g. K=5) before the first nudge; converge over a few sessions. Never nudge on a single data point.

```
~/.storyboard/perf-preference.json  (Option B extension)
{ "bias":"quality", "auto":true,
  "signals": { "regen":0, "accept_first":0, "cancel_long":0, "n":0 },
  "impatience":0.0, "last_nudge":null }
```

### 5.4 Feasibility & effort vs Option A

- **Materially harder — but only incrementally.** B is *A + telemetry capture + a feedback loop + persistence of counters.* The downstream levers are identical.
- **New infra B needs that A doesn't:** (1) reliable **signal capture** (regen/cancel/accept detection across turns), (2) **persistence** of counters (the file handles it), (3) a **feedback loop** that's safe against instability.
- **MVP for B is a thin heuristic layer on top of A** — read the file, bump counters, recompute EWMA, nudge the default. No new services.
- **The hard part isn't the code — it's testing/validation** of a non-deterministic loop (see §5.6).

### 5.5 Risks specific to self-learning

- **Silent quality regressions** — auto-fast produces worse output the user didn't ask for.
- **Non-determinism / surprise** — "why did the output change?" erodes trust. *Mitigation: always announce the flip + one-phrase override.*
- **Privacy of behavioral tracking** — mitigated by local-only, coarse, inspectable, wipeable counters.
- **Feedback-loop instability** — capacity-driven slowness (an infra problem) reads as "user is impatient," pushing the agent to fast mode and **masking the real capacity problem.** *Mitigation: separate `capacity_error` signals from `user_impatience` signals — a timeout is an infra event, not a preference signal.*
- **Harder to test & measure** than a deterministic mode.

### 5.6 Testability & metrics (B must be measurable, not hand-wavy)

- **A/B:** cohort 1 = static default (quality); cohort 2 = adaptive. Same harness as the perf investigation (`session_id` tagging + `get_perf_report` + `get_cost_report`).
- **Primary metrics:** median **time-to-first-preview (TTFP)**, **regeneration rate**, **task-completion rate**, **cost/asset**, **failure rate under load**.
- **Success bar for B:** adaptive beats static on regeneration rate and TTFP **without** a measurable quality-acceptance drop. If it can't clear that bar, B stays off.
- **Guardrail metric:** watch that fast-mode share doesn't spike in lockstep with capacity errors (that's the masking failure mode).

---

## 6 · Option A vs Option B — side-by-side

| Criterion | **A — Explicit two-mode skill** | **B — Self-learning adaptive** |
|---|---|---|
| **Capability delivered** | Full lever access on demand | Same levers, auto-selected |
| **UX** | Predictable; user in control; one phrase to switch | Zero-effort *when it's right*; confusing *when it's wrong* |
| **Determinism** | ✅ Deterministic | ❌ Non-deterministic |
| **Effort to build** | **Low** — skill + 1 preference file | **Medium** — A + telemetry + feedback loop |
| **New infra** | None | Signal capture + counter persistence |
| **Risk** | Low (worst case: user picks wrong mode, fixes in one phrase) | Higher (silent regressions, surprise, loop instability, masking capacity) |
| **Testability** | ✅ Easy (deterministic assertions) | 🟡 Harder (A/B, non-deterministic) |
| **Over-engineering risk** | Low | Medium — easy to gold-plate |
| **Time-to-value** | Immediate | After telemetry exists + validated |
| **Reversibility** | Trivial | Needs a kill-switch/flag |

**Narrative:** A is the safe, shippable, fully-testable core that delivers ~all of the *reachable* wins today. B's *upside* is only "the user never has to say the mode" — genuine but marginal next to A's wins, and it buys real cost in non-determinism, testing difficulty, and the capacity-masking trap. B is worth doing **only as a thin, interpretable, opt-out nudge on top of A, after telemetry exists** — never as a from-scratch alternative to A.

---

## 7 · Recommendation — phased path

1. **Phase 0 — Route-around + measure (do first, tiny).** In the skill, always pre-check the `live` flag (`list_capabilities`) and steer `animate` to `pixverse-i2v`; never emit `prefer_fast:true` for i2v. Stamp `session_id` on everything. *This alone flips i2v success ~33 %→~100 % on the fast path.* Also file the server asks (re-route `prefer_fast`, raise/tier 180 s ceiling, stop billing aborts) — the skill can't fix these but should make them visible.
2. **Phase 1 — Option A MVP (ship this).** Two explicit modes, the §2.2 lever matrix, default=quality, one-file preference memory (§4), first-use prompt. Deterministic and fully testable.
3. **Phase 2 — Option B thin nudge (flag-gated, only after telemetry).** Add local signal counters + EWMA `impatience`; nudge the default **only** with transparency + one-phrase override; separate capacity errors from impatience; behind a feature flag with a kill-switch. Validate with the §5.6 A/B before default-on.

**Why phased:** Phase 1 captures the vast majority of value deterministically; Phase 2 is a low-cost, reversible enhancement that *reuses Phase 1's levers* and only earns default-on if it beats static in a measurable A/B.

---

## 8 · Metrics & test plan (both options, reuse the perf harness)

**Instruments (already exist in the MCP):** `session_id` tagging on every call · `get_perf_report` (p50/p95, success%) · `get_cost_report` (cost/asset) · `get_recent_failures` · `list_capabilities` (`live` flag).

| Metric | Definition | Baseline (from investigation) | Target (fast mode) |
|---|---|---|---|
| **TTFP** | time to first visible preview/keyframe | 37–180 s | **< 10 s** |
| **E2E latency p50/p95** | submit → final asset | i2v p50 ~180 s | pixverse ~48 s |
| **i2v success rate** | done / attempts | 33 % (`seedance-i2v-fast`) | **~100 %** (warm cap) |
| **Throughput** | assets/min under parallel fan-out | ~sequential | N× (scene count) |
| **Cost/asset** | USD per delivered asset | incl. billed failures | lower (cheaper tier, fewer aborts) |
| **Regeneration rate** (B) | redos / brief | — | ↓ vs static |

**Test plan:**
- **Unit / deterministic (A):** given mode=fast, assert the skill emits `quality:'fast'`, warm-cap `model_override`, `subscribe_progress`, no `prefer_fast` for i2v; given mode=quality, assert premium routing. Assert preference file read/write/precedence.
- **Integration (both):** run the perf-investigation scenario set (i2v/t2v/ffmpeg/image) under each mode with `max_cost_usd` caps; compare against the table above. Budget the run (~$2, matching the investigation).
- **A/B (B only):** static vs adaptive cohorts on the §5.6 metrics; adaptive must win TTFP + regen rate with no quality-acceptance drop.
- **Guardrail test (B):** inject capacity errors; assert they do **not** drive the impatience score (no masking).

---

## 9 · DO / DON'T / risks

**DO**
- Bias to **warm (`live`) caps first** — reliability beats tier tricks; it's the biggest reachable win.
- Make faster-iteration mean **preview-first + draft-then-upscale + parallel**, not just "cheaper model."
- Keep memory to **one small local file**; default to quality; ask once.
- Always keep a **one-phrase override**; announce any auto-flip (B).
- **Measure** with the existing harness; surface the infra asks the skill can't fix.

**DON'T**
- ❌ Don't use `prefer_fast:true` for `animate` — it routes to the broken `seedance-i2v-fast`.
- ❌ Don't let faster mode silently degrade a "final"/"hero" asset — respect quality phrasing.
- ❌ Don't build a DB, ML model, or telemetry service for the MVP — heuristics + one file.
- ❌ Don't let B treat **capacity/timeout errors as impatience** — that masks the real infra problem.
- ❌ Don't ship B default-on before it beats static in a measurable A/B.

**Residual risks:** quality regressions if fast is too aggressive (mitigate: quality-phrasing guard + easy override); cost surprises (mitigate: `max_cost_usd`); **masking real capacity problems** (mitigate: keep infra asks visible + separate capacity signals); non-determinism confusion in B (mitigate: transparency + flag + kill-switch).

---

*Proposal only — no product code or skill created. Approve to proceed with Phase 0 + Phase 1 (Option A MVP).*
