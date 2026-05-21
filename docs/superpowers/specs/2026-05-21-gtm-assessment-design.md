# AgentBook GTM Assessment — Design Spec

**Date:** 2026-05-21
**Author:** brainstorm session with @seanhanca
**Status:** Approved — methodology only; execution happens in follow-up sessions
**Goal:** Take AgentBook from current state to **≥ 95/100** on an agent-native production-readiness rubric, ready to ship to first paying customers and survive a public launch within ~4 weeks.

---

## 1. Why this document exists

AgentBook has reached substantial scope (4 plugins, 140 endpoints, 41 models, 26 pages, 40+ e2e tests, Telegram bot live). Before pushing on revenue or press, we need an objective answer to: **is this an agent-native product that can survive contact with real paying users — or a SaaS with a chatbot bolted on?**

This spec defines the **methodology** for that assessment. It does not perform the assessment. Three follow-up phases (audit → synthesis → close-gaps) execute against this methodology, each in its own session for context hygiene and reviewability.

The rubric is calibrated against **Claude Code as the agent-native reference exemplar** — the bar is "would a Claude Code user recognize this as the same species of product?"

## 2. Goals

- **Primary:** Score the product on a 100-pt agent-first rubric and produce a gap report with PR-sized fixes ordered by ship-impact.
- **Revenue gate:** First paying customer in ~4 weeks. Assessment is ruthless about anything that blocks revenue.
- **Launch gate:** Public/press launch follows. Assessment also covers polish, onboarding, support load, and trust signals (security, legal, observability).
- **Agent-native gate:** Tier 1 (40 pts) must reach ≥ 32 or the overall score is capped at 90. Cannot trade points elsewhere.

## 3. Non-goals

- No production WhatsApp or Discord live traffic in this cycle — only adapter-abstraction proof via tests. Adding live platforms is a follow-up.
- No new feature work outside what the gap report justifies.
- No marketing/positioning work — this is product readiness, not GTM messaging.
- No team-scaling decisions, hiring plans, or pricing strategy.

## 4. Scope decomposition

The work decomposes into three phases, each its own session:

| Phase | Session | Output |
|-------|---------|--------|
| **1 — Audit** | Next session | Three parallel streams: code review, behavior-driven test runs, rubric scoring. Each cites file:line / test-result / rubric-row evidence. |
| **2 — Synthesis** | Session after Phase 1 | Consolidated gap report ranked by blocker / launch / polish, with rubric-points-recovered per gap and effort estimate. |
| **3 — Close gaps** | One or more sessions after Phase 2 | Execute PRs against the implementation plan. Each PR ≤ 500 LOC, one gap (or coupled cluster), test included, rubric-points reclaimed called out. |

This spec covers all three phases at methodology level. The implementation plan written immediately after this spec covers Phase 1 in detail. Phases 2 and 3 get their own plans once Phase 1 results land.

## 5. The 100-point rubric (agent-native, Claude-Code-calibrated)

### Tier 1 — Agent-Native DNA (40 pts) — load-bearing

#### #1 Agent-first architecture (12 pts)
*Claude Code parallel: the terminal IS the UX. No GUI required for any operation.*

| Criterion | Pts |
|-----------|-----|
| Every primary workflow can be completed via chat alone (no UI required) | 3 |
| UI panels are views on agent state, not parallel CRUD apps | 3 |
| Multi-step actions show a plan before executing | 2 |
| Agent's intermediate state is visible (what it's doing, why) | 2 |
| No "secret form path" duplicating an agent skill | 2 |

**Auto-deductions:**
- −2 per occurrence: feature exists *only* as a form with no chat equivalent
- −3: agent silently performs multi-step action with no plan visible

#### #2 Skill-driven intelligence (12 pts)
*Claude Code parallel: Skills tool, slash commands, plugin SDK, MCP servers.*

| Criterion | Pts |
|-----------|-----|
| Skills are first-class entities: manifest, version, metadata | 3 |
| Skills discoverable from chat ("what can you do?") | 2 |
| New skill addable without code redeploy | 2 |
| Skills measurable: success rate, eval score, hallucination flags per skill | 3 |
| Skill composition: planner chains multiple skills cleanly | 1 |
| Skill registry supports third-party / marketplace skills | 1 |

**Auto-deductions:**
- −4: skill routing is hardcoded if/else in code
- −3: adding a skill requires redeploy
- −2: skill-level metrics don't exist

#### #3 Human-in-the-loop quality (10 pts)
*Claude Code parallel: confirmation before destructive actions, AskUserQuestion, plan mode, memory system.*

| Criterion | Pts |
|-----------|-----|
| Confidence-scored: agent escalates below threshold instead of guessing | 2 |
| Destructive actions (send invoice, file tax, delete) require explicit confirm | 2 |
| Plan preview shown before any multi-step execution | 2 |
| Corrections persist to memory and adjust future behavior | 2 |
| Undo / rollback exists on agent actions | 1 |
| Audit trail of agent decisions (timestamp, inputs, why) | 1 |

**Auto-deductions:**
- −3: any destructive action happens without confirm
- −2: corrections don't persist
- −2: no plan preview for multi-step

#### #4 Core agent quality (6 pts)
*Measured via the nightly real-LLM suite.*

| Criterion | Pts |
|-----------|-----|
| Intent classification accuracy ≥ 92% on 15-utterance-per-persona canonical set | 2 |
| Hallucination rate ≤ 2% on canonical set | 2 |
| Multi-turn coherence (5+ turn convos stay on topic, remember refs) | 1 |
| Memory recall correctness (recalls user prefs without re-asking) | 1 |

**Auto-deductions:**
- −2: any nightly utterance produces a financially incorrect agent response (wrong total, wrong category, wrong tax)

### Tier 2 — Domain workflows (28 pts)

Each scored on agent-first execution **and** data-correctness (immutability, audit trail, math integrity).

| # | Category | Pts |
|---|----------|-----|
| 5 | Bookkeeping (expense capture, OCR, categorization, edit/split/recurring + double-entry / audit-trail) | 8 |
| 6 | Invoicing (create, send, payment, recurring, follow-ups) | 6 |
| 7 | Tax (estimates, deductions, filing prep — CA + US) | 6 |
| 8 | Budget / advisor (insights, alerts, forecasting, scenario sim) | 4 |
| 9 | Consultation Q&A (open-ended, citation, "I don't know" honesty) | 4 |

### Tier 3 — Activation (14 pts)

| # | Category | Pts |
|---|----------|-----|
| 10 | Onboarding & first-15-min (signup → first value path, persona setup, demo data) | 8 |
| 11 | Billing / monetization (Stripe flows, plan gating, dunning, refunds, invoice edge cases) | 4 |
| 12 | Plaid / bank sync (link, reconciliation, error states, multi-account) | 2 |

### Tier 4 — Trust & ops (15 pts)

| # | Category | Pts |
|---|----------|-----|
| 13 | Security & tenant isolation (auth, RLS/scoping, secrets, PII, OWASP top issues) | 5 |
| 14 | Observability & ops (logging, error tracking, metrics, alerting, runbooks) | 4 |
| 15 | Support & feedback loop (in-app support, error visibility to user, feedback capture) | 3 |
| 16 | Legal & data rights (ToS, privacy policy, export/delete, region-aware CA/US) | 3 |

### Tier 5 — Platform extensibility (3 pts)

| # | Category | Pts |
|---|----------|-----|
| 17 | Multi-platform adapter abstraction (clean interface, proven by test, <100 LOC to add new platform) | 3 |

### Hard floors (auto-caps)

- **Tier 1 total < 32/40** → overall score capped at 90.
- **Any auto-fail clause hit → overall score capped at 85** until fixed:
  - Agent has no plan-preview mechanism for any multi-step action
  - Skills are hardcoded in if/else rather than manifest-driven
  - Any destructive financial action ever happens without user confirm
  - Corrections never persist (no memory-write path)

### Scoring methodology

- Each criterion scored on integer points 0..max. No fractions.
- Every score must cite evidence: a file path, a test result, a screenshot, or a documented manual reproduction.
- "Lack of evidence" = 0 points. Don't grade on intent.
- Final score is `sum(criteria) - sum(auto_deductions)`, then apply hard-floor caps.

## 6. Phase 1 — Audit methodology

Three parallel streams. Each owns its own deliverable, all feed Phase 2.

### 6.1 Stream A — Code review

**Path:** `docs/superpowers/reports/2026-05-21-code-review.md`

Walk every plugin and every API route group. For each module, grade against:

| Dimension | Looks like |
|-----------|-----------|
| **Agent-pattern adherence** | Does the route delegate to agent brain, or carry its own decision logic? Is the corresponding skill manifest registered? Could this be a skill instead of an endpoint? |
| **Security** | Tenant isolation, auth, input validation, SQL/injection vectors, secret handling, rate-limiting on cost-bearing endpoints |
| **Error handling** | Try/catch boundaries, user-visible error messages, idempotency on writes (financial endpoints MUST be idempotent) |
| **Data integrity** | Immutability of financial records, audit trail completeness, double-entry where applicable, no silent overwrites |
| **Test coverage** | Unit + e2e present; meaningful (not just smoke); covers happy + error paths |
| **Performance / cost** | N+1 queries, missing indexes, LLM token waste (over-prompting, redundant calls) |

**Findings format (every line):**
```
[severity] file:line — issue — recommended fix
```
Severities: `blocker` / `launch` / `polish` / `nit`.

**Modules to cover:**
- `plugins/agentbook-core/backend/src/**` — agent brain, memory, planner, evaluator, skill manifests
- `plugins/agentbook-expense/backend/src/**`
- `plugins/agentbook-invoice/backend/src/**`
- `plugins/agentbook-tax/backend/src/**`
- `plugins/agentbook-billing/**` (if present)
- `apps/web-next/src/app/api/v1/agentbook/**` — adapter routes (telegram, cron, stripe webhook, switch-tenant)
- `apps/web-next/src/app/api/v1/agentbook-core/**`
- `apps/web-next/src/app/(dashboard)/**` — UI pages, to check for "form-only paths" that violate rubric #1
- `packages/database/prisma/schema.prisma` — data integrity & constraints
- `tests/e2e/**` — coverage gap analysis

### 6.2 Stream B — Behavior-driven test suite

**Path:** `tests/e2e/gtm/*.spec.ts` + `tests/e2e/nightly/agent-realism.spec.ts`

Two suites:

#### Fast suite (PR gate, mocked LLM) — `tests/e2e/gtm/`

| Spec file | Scenario |
|-----------|----------|
| `01-bookkeeping.spec.ts` | Maya logs 10 receipts via chat; expense list reflects state; corrections persist; recurring expense; split expense; edit existing |
| `02-invoicing.spec.ts` | Alex creates → sends → marks paid; void; refund; recurring invoice; follow-up reminder |
| `03-budget-advisor.spec.ts` | Jordan asks 5 advisor queries; insights & alerts triggered correctly; scenario sim |
| `04-tax.spec.ts` | CA estimate, US estimate, deduction discovery, filing-prep package |
| `05-consultation.spec.ts` | Open-ended Q&A; citation; "I don't know" honesty when out of domain |
| `06-onboarding.spec.ts` | Brand-new user → first value in <15 min (instrumented timer); persona setup; demo-data path |
| `07-adapter-abstraction.spec.ts` | Instantiate Telegram + stub WhatsApp + stub Discord adapters from same agent core; verify identical message lifecycle across all three. Fails if any platform-specific logic leaks into agent brain. |
| `08-billing.spec.ts` | Stripe sandbox: subscribe, gating, dunning, refund, invoice edge cases |
| `09-plaid.spec.ts` | Plaid sandbox: link, reconciliation, `ITEM_LOGIN_REQUIRED`, multi-account |

Mocked LLM strategy: intercept Gemini SDK at module boundary; return canned responses keyed by `(user-message, conversation-state)`. Fixtures live in `tests/e2e/fixtures/llm-responses/`. New scenarios add fixtures, not branches in the mock.

#### Nightly real-LLM suite — `tests/e2e/nightly/agent-realism.spec.ts`

- 15 canonical utterances × 3 personas (Maya / Alex / Jordan) = 45 real Gemini calls
- For each: capture full agent response, plan, skill invoked, tokens used
- LLM-as-judge (separate Gemini call) scores each response on: accuracy, helpfulness, hallucination, tone, refusal-correctness
- Output: JSON report → `reports/agent-realism/YYYY-MM-DD.json`
- Threshold alert: if intent accuracy drops below 90%, hallucination above 3%, or any financially-incorrect response → fail with summary

Canonical utterance set lives in `tests/e2e/nightly/canonical-utterances.ts`. Treated as a versioned eval set — changes require explanation in commit.

#### Multi-platform adapter design (delivered as part of test #07)

```
plugins/agentbook-core/backend/src/adapters/
  base.ts          # ChatAdapter interface
  telegram.ts      # existing logic, refactored to implement ChatAdapter
  whatsapp.ts      # stub: parses Twilio-shaped webhook, no real send
  discord.ts       # stub: parses Discord-shaped webhook, no real send
  registry.ts      # adapter lookup by platform key
```

`ChatAdapter` interface (minimum):
```ts
interface ChatAdapter {
  readonly platform: 'telegram' | 'whatsapp' | 'discord';
  parseIncoming(rawWebhookPayload: unknown): NormalizedIncoming;
  sendOutgoing(chatId: string, message: NormalizedOutgoing): Promise<void>;
  formatPlan(plan: AgentPlan): NormalizedOutgoing;
}
```

Existing Telegram route refactored to: parse → adapter.parseIncoming → agentBrain.handleMessage → adapter.sendOutgoing. Same code path for stubs. Test #07 sends identical user utterance through all three webhook shapes; asserts identical agent decision and identical-modulo-format response. Telegram remains the only platform with live credentials.

### 6.3 Stream C — Rubric scoring

**Path:** `docs/superpowers/reports/2026-05-21-rubric-scorecard.md`

Line-by-line walk of the 100-pt rubric. For each criterion: integer score + evidence citation. Auto-deductions enumerated explicitly. Hard-floor checks last. Output ends with a "to reach 95: close gaps X, Y, Z" projection that feeds Phase 2.

## 7. Phase 2 — Synthesis

**Path:** `docs/superpowers/reports/2026-05-21-gap-report.md`

Combine findings from streams A, B, C into a single ranked list. Each gap formatted as:

```
## Gap G-NNN — [severity] one-line summary
**Found by:** [stream A: file:line] [stream B: test name] [stream C: rubric row]
**Affects:** rubric pts N, M  |  user trust  |  legal exposure  |  revenue
**Effort:** S (~4h) / M (~1d) / L (>1d)
**Risk if shipped:** [concrete consequence]
**Fix:** [approach in 2-3 sentences]
**Rubric points reclaimed:** +N
```

Sort: blockers → launch → polish. Within each, by `points-reclaimed / effort` ratio (highest leverage first).

Gap report ends with a **rubric projection table:**

| If we close | Estimated score |
|-------------|-----------------|
| All blockers | X / 100 |
| Blockers + top-N launch | Y / 100 |
| Everything except polish | Z / 100 |

This tells us exactly how much work it takes to hit 95.

## 8. Phase 3 — Close gaps (implementation plan)

**Path:** `docs/superpowers/plans/2026-05-21-close-gtm-gaps.md` (written after Phase 2 lands)

PR-cycle plan with:

- Each PR ≤ 500 LOC diff target
- One gap (or tightly-coupled gap cluster) per PR
- Test added/updated as part of the PR (no untested fixes)
- PR description includes: "Closes G-NNN. Rubric points reclaimed: +N (now X/100)."
- Order: Tier 1 (agent-DNA) gaps first → revenue blockers → launch polish

Plan-doc structure mirrors existing `docs/superpowers/plans/` files for consistency.

## 9. Stripe + Plaid sandbox guide

**Path:** `agentbook/setup-stripe-plaid-sandbox.md`

Self-contained how-to:

### Stripe section
- Create Stripe account, switch to test mode
- Generate API keys (publishable + secret), wire to `.env.local`
- Webhook setup: `stripe listen --forward-to localhost:3000/api/v1/agentbook/stripe-webhook` for local; signing secret extraction
- Test card numbers: `4242 4242 4242 4242` (success), `4000 0000 0000 0002` (decline), `4000 0025 0000 3155` (3DS required)
- Subscription test flow: create plan in dashboard → checkout from `/billing` → verify webhook arrives → check `BillSub` row
- Invoice test, refund test, dunning test
- Recovering from common errors: missing webhook signature, idempotency key collisions, mode mismatch (live/test)
- Copy-pasteable smoke test script

### Plaid section
- Existing sandbox credentials (Client ID `69d02fa4f1949b000dbfc51e`, Secret `59be40029c47288c4db4acfd79ae56`) — documented but flagged to rotate before live
- Test institutions: `ins_109508` (First Platypus Bank — happy path), `ins_109509` (error path)
- Simulated webhooks: how to trigger `TRANSACTIONS_UPDATE`, `ITEM_LOGIN_REQUIRED`, `PENDING_EXPIRATION`
- Reconnection flow when `ITEM_LOGIN_REQUIRED` fires
- Multi-account handling test
- Copy-pasteable smoke test script

## 10. Deliverable artifacts (consolidated)

| Artifact | Path | Phase |
|----------|------|-------|
| Spec | `docs/superpowers/specs/2026-05-21-gtm-assessment-design.md` | Now |
| Phase 1 plan | `docs/superpowers/plans/2026-05-21-gtm-assessment-phase1.md` | Now (next step) |
| Code review report | `docs/superpowers/reports/2026-05-21-code-review.md` | Phase 1 |
| Rubric scorecard | `docs/superpowers/reports/2026-05-21-rubric-scorecard.md` | Phase 1 |
| Test code | `tests/e2e/gtm/*.spec.ts` + `tests/e2e/nightly/agent-realism.spec.ts` | Phase 1 |
| Adapter refactor | `plugins/agentbook-core/backend/src/adapters/*` | Phase 1 (part of test #07) |
| Gap report | `docs/superpowers/reports/2026-05-21-gap-report.md` | Phase 2 |
| Implementation plan | `docs/superpowers/plans/2026-05-21-close-gtm-gaps.md` | Phase 2 |
| Stripe/Plaid guide | `agentbook/setup-stripe-plaid-sandbox.md` | Phase 1 (small, parallel) |
| PR series closing gaps | one PR per gap-cluster | Phase 3 |

## 11. Acceptance criteria for this assessment cycle

- Rubric scorecard published with citations for every score
- Gap report identifies path to ≥ 95 with effort estimate
- Test suite (fast + nightly) running green on current `main`, with failures explicitly documented as gap items
- Adapter abstraction proven by test #07; Telegram still works in production
- Stripe & Plaid sandbox guides validated by running their smoke scripts on a fresh checkout

## 12. Sequencing summary

```
[brainstorm — done]
  ↓
[write spec — this doc] → user review
  ↓
[writing-plans skill] → Phase 1 implementation plan
  ↓
[new session] → execute Phase 1: parallel audit (streams A, B, C) + Stripe/Plaid guide
  ↓
[new session] → execute Phase 2: synthesize gap report + Phase 3 plan
  ↓
[1..N sessions] → execute Phase 3: PRs closing gaps to ≥ 95/100
```

Each session ends at a reviewable artifact. No phase silently merges into the next.

## 13. Open items deferred to follow-up

- Live WhatsApp / Discord adapters (scope option B/C from brainstorm) — pending demand from first customers
- Marketplace / third-party skill SDK — flagged as rubric criterion but full implementation is post-launch
- LLM-judge prompt tuning for nightly suite — start with simple rubric prompt, iterate after first nightly run
- Cost-per-user dashboard — observability sub-area, deferred unless rubric scoring surfaces it as blocker
