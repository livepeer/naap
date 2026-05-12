# Chat Engagement Agent — Review & Plan

**Status:** Draft for review
**Date:** 2026-05-12
**Audience:** Engineering + product

## 1. What we have today (honest assessment)

### Strengths
- **LLM-first intent classifier** (`agentbook-bot-agent.ts`) with regex fallback and a structured slot vocabulary. Currently classifies ~25 intents.
- **Confirmation gate** on every record-expense / OCR / NL booking. The "draft → confirm → posted" loop is correct and audit-logged.
- **Conversation context shim** (PR #35) — `AbUserMemory:telegram:conv_ctx:<chatId>` stores last 3 turns, mentioned entities, pending slot fills. 10-min TTL.
- **Slot accumulator** (PR #36) for invoice creation — bot asks targeted follow-ups instead of re-classifying.
- **Reference resolver** — "first", "INV-007", "Acme", "all of them", single-entity "yes". Unit-tested.
- **Daily-briefing chat command** (PR #37) — typing "daily briefing" produces the same insightful format the cron sends.
- **Audit trail** (PR #10) wraps 12 mutating endpoints — we can answer "what changed when, by whom, from where?"

### What's still flat, broken, or ad-hoc
1. **Every chat feels disconnected.** convCtx exists but most code paths don't read it. The active-expense memory key (`telegram:active_expense`) is the SOLE thing most flows look at — so vague follow-ups like "more details", "what about that one", "fix it" almost always resolve to whichever receipt is active rather than the thread the user is on.
2. **No thread boundaries.** convCtx keeps the last 3 turns forever (until 10-min TTL). Long sessions accumulate stale references. A clear topic shift ("anyway, my taxes") doesn't reset.
3. **Pending state is scattered.** A dozen `telegram:pending_*` keys live alongside convCtx with no shared lifecycle. State leaks between flows; cleanup is per-feature.
4. **Slot fill only works for invoice creation.** SLOT_SPECS is registered for estimate / per-diem / budget too but their executors don't yet write `needs_clarify_partial`. Mechanical, not done.
5. **Behavioral learning is shallow.** `AbPattern` records vendor → category from confirmations, and `AbUserMemory` has confidence-decay scaffolding. Nothing else. The bot doesn't notice that Maya always splits "co-working" expenses 50/50 between personal and business, or that Alex never categorizes Stripe payouts on weekends, or that Jordan needs the Q tax estimate phrased as a percentage of revenue not dollars.
6. **The agent doesn't introspect.** It can't answer "show me the patterns you've learned about me" or "what behavioral assumptions are you making for my tax filing?" That makes trust impossible — the user has no way to audit what the bot is doing on their behalf.

## 2. Three-layer plan

Three concerns, three layers. Each is independently shippable.

### Layer A — Unified conversation memory (the foundation)

Replace the ad-hoc `telegram:active_expense` / `telegram:pending_*` keys with a **single conversation state object** that every flow reads and writes.

**Schema (extends existing `AbConversation` table or adds a new `AbConvThread`):**
```
AbConvThread {
  id, tenantId, channel ('telegram'|'web'|'api'), chatId
  status: 'active' | 'closed' | 'archived'
  startedAt, lastActiveAt, closedAt?
  closeReason?: 'idle_timeout' | 'topic_shift' | 'explicit' | 'length_cap'

  // What's "in flight" — the working set the user is operating on.
  activeEntities: Json    // [{kind, id, label, focus: bool, refCount, addedAt}]
  pendingSlots:  Json?    // current multi-turn fill, if any
  topic:         String?  // 'expense_review' | 'invoice_draft' | 'tax_filing' | 'reporting' | ...
  subtopic:      String?  // narrower label inside topic

  // Recent verbatim history (capped).
  turns:         Json     // [{role, text, at, intent?, entities?}]
  turnCount:     Int      // total turns ever in this thread (not just kept)

  // A summary of older turns once we trim, so context doesn't vanish.
  summary:       String?  // <= 800 chars, regenerated as the thread grows
}

AbConvThread.@@index([tenantId, status, lastActiveAt])
```

**Lifecycle helpers** (`agentbook-thread.ts`):
- `openThread(tenantId, channel, chatId)` — find active or create.
- `addTurn(thread, role, text, intent?, entities?)` — append; auto-summarize when `turns.length > 12` (call Gemini to compress older 6 → summary, keep recent 6 verbatim).
- `closeThread(thread, reason)` — set status='closed'; new turns open a fresh thread.
- `attachEntity(thread, entity)` / `detachEntity(thread, id)` — manage the working set.

**Wiring:** the webhook handler stops calling `setActiveExpense` directly. Instead it `attachEntity(thread, {kind:'expense', id, ...})` and `setFocus(thread, expenseId)` — the focused entity is what "this", "it", "fix it" resolve to.

**Why this matters:** today the bot has ~12 ad-hoc keys for different in-flight states. Consolidating to one row makes references real (the bot can answer "what are we doing right now?" because it has the thread on hand) and makes thread closure / summarization possible.

### Layer B — Thread boundaries (so the user doesn't repeat themselves)

A thread is a coherent unit of conversation. Today the bot has no concept of one; it treats every turn as standalone except for the 10-min sliding window.

**When to close the current thread and start a new one:**

1. **Idle timeout** — `lastActiveAt > 30 minutes ago` → close as `idle_timeout`. Configurable per-tenant.
2. **Length cap** — `turnCount > 30` AND no pending slot fill → close, retain summary, open new. Prevents thread bloat from chatty users.
3. **Explicit reset** — user says "new conversation" / "reset" / "/reset" / "/end" / "start over" → close as `explicit`.
4. **Detected topic shift** — Gemini classifier returns confidence ≥ 0.85 that the user's latest message is on a different top-level topic AND no pending slot fill is active. Top-level topics:
   - `expense_management` (record, categorize, split, review)
   - `invoice_management` (create, send, track, void)
   - `tax_filing` (estimate, deductions, packages, slips)
   - `reporting` (P&L, balance sheet, cashflow, dashboards)
   - `bank_reconciliation` (matches, transactions, accounts)
   - `mileage` (record trips, summary)
   - `time_billing` (timer, time entries)
   - `cpa_collaboration` (invites, requests)
   - `system_admin` (settings, briefing prefs, integrations)

5. **Pending slot fill survives topic shifts** — if the user asked an invoice and is half-way through ("invoice Beta" / "How much?") and then says "wait, what's my cash balance?", the bot:
   - Closes the pending slot (don't lose it — stash to `parkedFills[]`)
   - Handles the new question
   - When the user comes back ("ok and so the invoice was $5K"), re-attaches the parked fill

**What summarization preserves**: the open entities (still mentioned in summary), confirmed actions in this session, and any user preferences expressed ("I always categorize Uber as Travel"). The verbatim 6 recent turns stay; older 6 → summary; older still → drop.

### Layer C — Behavioral learning (so it actually becomes "expert")

The bot needs to **observe how the user works** and adapt its prompts, confirmations, and defaults accordingly. Not personalization in the marketing sense — observable patterns that affect bookkeeping decisions.

**Pattern types to learn** (`AbBehaviorPattern` model, scoped by tenantId):

| Category | Pattern | Example signal | How it changes bot behavior |
|---|---|---|---|
| **Vendor → category** | Stable mapping after 3+ confirmations | Esso → Travel | Auto-confirm next Esso receipt |
| **Vendor → split** | Recurring split across categories | Wi-Fi 70% biz / 30% personal | Pre-fill split on upload |
| **Time of day** | When user usually books | Maya books at 9pm | Schedule auto-categorize before 9pm |
| **Decision threshold** | When user needs review vs trusts auto | Approves auto-cat under $50 silently | Lower confirm-required threshold |
| **Language style** | How user names things | Uses "client meeting" not "business lunch" | Echo their phrasing in confirmations |
| **Reporting cadence** | When user pulls reports | Always asks for tax estimate end-of-quarter | Preempt with proactive estimate |
| **Risk tolerance** | How user reacts to flags | Skips most receipt-expiry warnings | Suppress lower-priority warnings |
| **Tax handling** | Jurisdiction-specific habits | Always claims home-office deduction | Surface relevant rules first |
| **Categorization confidence** | When user overrides bot picks | Often re-categorizes after auto-pick | Lower auto-confidence threshold |
| **Invoice cadence** | Recurring invoice patterns user creates manually | Same $5K to TechCorp 1st of each month | Suggest recurring schedule after 3rd manual |

**Schema:**
```
AbBehaviorPattern {
  id, tenantId
  category: String  // see table above
  signal:   Json    // {vendorId, categoryId, ...} — keyed lookup
  evidence: Int     // how many observations
  confidence: Float // 0-1, time-decayed
  firstSeenAt, lastSeenAt
  overrideCount: Int  // times user contradicted this pattern
}
```

**Observation hooks** (one per pattern type, fires after relevant action):
- `recordVendorCategoryConfirmation(tenantId, vendorId, categoryId)` — bumps Vendor→category evidence.
- `recordCategoryOverride(tenantId, fromCatId, toCatId, vendorId?)` — bumps override + creates Vendor→split signal if split observed.
- `recordBookingTime(tenantId, hourLocal)` — sliding histogram per hour of day.
- `recordReviewSkip(tenantId, alertType)` — fires when user dismisses a digest section.
- ...etc.

**Pattern application** (one per pattern type, consulted before user-facing action):
- Before an OCR receipt's confirmation gate: if vendor→category confidence ≥ 0.85 AND amount ≤ user's silent-confirm threshold → auto-book.
- Before sending a digest: filter out sections the user routinely skips (override count > 2× include count).
- Before showing the same nudge twice: check `AbBehaviorPattern{category:'nudge_dismissal', signal:{nudgeType}}`.

**Self-introspection** (UX surface):
- `/patterns` Telegram command (and `/agentbook/patterns` web page) — shows the top 10 patterns the bot has learned about you, with one-tap "forget this" buttons. Maya can audit: "you think I always do 70/30 on Wi-Fi — actually adjust to 60/40." This is what turns the bot from "automation that surprises you" into "accountant you can fire patterns from".

**Why we're not building generic ML**: every pattern above is a small, observable, auditable rule. The user can see, override, and reset each one. That's the trust contract — and we already have the audit trail (PR #10) to back it up.

## 3. Implementation roadmap (8 PRs, ~3 weeks)

| # | PR | What it ships | Depends on |
|---|---|---|---|
| 1 | **`AbConvThread` model + `agentbook-thread.ts` lib** | Schema, openThread, addTurn (no summarization yet), closeThread. Migrate convCtx readers in 3 hot paths (entry handler, slot-fill intercept, daily-briefing intercept). Existing convCtx coexists; new code uses thread. | — |
| 2 | **Migrate active-expense to focused entity** | `setActiveExpense` becomes `setFocus(thread, expenseId)`; all reads go via `thread.focusedEntity`. Delete the legacy memory key after a 7-day compat window. | #1 |
| 3 | **Idle timeout + explicit reset** | Close thread on `lastActiveAt > 30m` and on "/reset"/"new conversation". Open new thread on next turn. Surface in `/status`. | #1 |
| 4 | **Length cap + Gemini summarization** | When `turnCount > 12`, summarize older 6 turns to ≤800-char summary; keep recent 6 verbatim; thread continues. | #1 |
| 5 | **Topic-shift detection** | Gemini classifier returns top-level topic confidence. ≥0.85 + no pending fill → close + reopen. Pending fill on topic shift → park to `parkedFills[]`; re-attach later. | #1, #3 |
| 6 | **Slot fill for the other 3 intents** | `create_estimate`, `record_per_diem`, `set_budget` get the same partial-extract pattern PR #36 added for invoice. | #1 |
| 7 | **`AbBehaviorPattern` model + observer hooks** | Schema, 10 observation hooks (vendor→cat, override, booking-time, review-skip, ...). Hooks fire from existing audit calls — non-blocking. No application yet. | #10 (audit trail, already shipped) |
| 8 | **Pattern application + `/patterns` UX** | Three apply sites (auto-confirm threshold, digest filtering, nudge dedup). `/patterns` Telegram command + `/agentbook/patterns` web page with view + one-tap forget. | #7 |

After PR 8, the agent has: unified thread memory, automatic boundaries, behavioral learning across 10 dimensions, and a UX surface for the user to audit and edit what the bot has learned.

## 4. What's deliberately not in this plan

- **Cross-tenant learning.** No "Maya's pattern improves Alex's auto-cat". Privacy guardrail; if we want it, it goes through a separate "anonymized benchmark" proposal.
- **Long-term semantic memory** (e.g., RAG over chat history). The thread summary covers the in-session case; the audit log covers the durable case. Going beyond means a vector store, ranking, and recency / relevance tradeoffs — out of scope until the three layers above are stable.
- **Multi-channel context bridging.** Today a Telegram thread and a web session are separate. Joining them is a UX question (do we want a web-bookkeeping session to inherit the Telegram pending fill?) more than a tech one. Deferred.
- **Voice / image as first-class thread turns.** Voice transcripts and OCR results land as turn metadata; the thread itself stays text. Voice/image expansion would change `turns.text` to `turns.modality + media_ref`.

## 5. Success criteria (so we know we got there)

After PR 8 lands, the user should be able to:

1. Type "more details" / "fix that" / "the second one" and have the bot resolve against the active thread, not just whatever expense is active.
2. Have a 30-message conversation without the bot losing track of what was decided 20 messages ago (summarization keeps the gist).
3. Switch topic mid-stream and have the bot acknowledge ("setting aside the invoice — what's your question?") rather than confuse intents.
4. Look at `/patterns` and see exactly what the bot has learned about their bookkeeping, with the ability to override or forget any pattern.
5. See the silent auto-confirm threshold get more permissive over time as the bot's accuracy on their vendors improves — and have the bot tell them when it does ("I've started auto-confirming Esso receipts; reply 'review esso' to stop").

That last one is the trust loop: behavior changes are transparent, not silent.
