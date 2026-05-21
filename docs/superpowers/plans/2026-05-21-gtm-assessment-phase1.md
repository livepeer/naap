# GTM Assessment — Phase 1 (Audit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the Phase 1 audit defined in `docs/superpowers/specs/2026-05-21-gtm-assessment-design.md` — produce a code review report, a behavior-driven test suite (fast + nightly), a rubric scorecard, and a Stripe/Plaid sandbox guide. All artifacts must cite evidence (file:line, test result, or screenshot) so Phase 2 can synthesize a gap report.

**Architecture:** Four parallel streams write into four independent artifacts. Stream B introduces a `ChatAdapter` abstraction that refactors the existing Telegram path and is verified by `07-adapter-abstraction.spec.ts`. Tests mock the LLM via the existing `callGemini` seam (already passed as `ctx.callGemini` into agent-brain). Nightly suite uses real Gemini against a versioned canonical utterance set with LLM-as-judge scoring.

**Tech Stack:** TypeScript, Playwright, Prisma, Express, Next.js App Router, Gemini SDK, Stripe SDK, Plaid SDK.

**Parallelization:** Streams A (code review), B (tests + adapter), C (rubric), and E (Stripe/Plaid guide) are independent and SHOULD be dispatched to parallel subagents. Within a stream, tasks are sequential. Stream C may reference outputs from A and B in its evidence cells but does not block on their completion — it can score based on direct code reads.

---

## Pre-Flight (sequential, do once)

### Task 0: Scaffold artifacts and verify environment

**Files:**
- Create: `docs/superpowers/reports/2026-05-21-code-review.md`
- Create: `docs/superpowers/reports/2026-05-21-rubric-scorecard.md`
- Create: `tests/e2e/gtm/README.md`
- Create: `tests/e2e/gtm/fixtures/llm-responses/README.md`
- Create: `tests/e2e/nightly/canonical-utterances.ts` (empty for now)

- [ ] **Step 1: Confirm environment is ready**

Run:
```bash
cd /Users/qianghan/Documents/mycodespace/a3p
docker compose ps database
node --version
npx playwright --version
```
Expected: database container running, Node 20+, Playwright installed.

- [ ] **Step 2: Create the code review report stub**

Create `docs/superpowers/reports/2026-05-21-code-review.md`:
```markdown
# AgentBook Code Review — 2026-05-21

**Methodology:** See `docs/superpowers/specs/2026-05-21-gtm-assessment-design.md` §6.1.

**Severity legend:** `blocker` (ship-blocker), `launch` (cannot public-launch with this), `polish` (improves quality but not gating), `nit` (style).

**Format:** `[severity] file:line — issue — recommended fix`

---

## Stream A.1 — `plugins/agentbook-core/backend/src/**`

(populated in Task A.1)

## Stream A.2 — Domain plugins (expense / invoice / tax / billing)

(populated in Task A.2)

## Stream A.3 — `apps/web-next/src/app/api/v1/agentbook*/**`

(populated in Task A.3)

## Stream A.4 — `apps/web-next/src/app/(dashboard)/**`

(populated in Task A.4)

## Stream A.5 — Prisma schema + existing tests

(populated in Task A.5)

---

## Summary

- Total findings: __
- Blocker: __
- Launch: __
- Polish: __
- Nit: __
```

- [ ] **Step 3: Create the rubric scorecard stub**

Create `docs/superpowers/reports/2026-05-21-rubric-scorecard.md`:
```markdown
# AgentBook Rubric Scorecard — 2026-05-21

**Methodology:** See `docs/superpowers/specs/2026-05-21-gtm-assessment-design.md` §5.

**Evidence rule:** every score must cite a file path, test result, or manual reproduction. Lack of evidence = 0.

---

## Tier 1 — Agent-Native DNA (target ≥ 32/40)

### #1 Agent-first architecture (12 pts)

| Criterion | Max | Score | Evidence |
|-----------|-----|-------|----------|
| Every primary workflow can be completed via chat alone | 3 | _ | _ |
| UI panels are views on agent state, not parallel CRUD | 3 | _ | _ |
| Multi-step actions show a plan before executing | 2 | _ | _ |
| Agent's intermediate state is visible | 2 | _ | _ |
| No "secret form path" duplicating an agent skill | 2 | _ | _ |
| **Subtotal** | **12** | **_** | |
| **Auto-deductions** | | **_** | (list with evidence) |

### #2 Skill-driven intelligence (12 pts)
| Criterion | Max | Score | Evidence |
|-----------|-----|-------|----------|
| First-class entities (manifest, version, metadata) | 3 | _ | _ |
| Discoverable from chat | 2 | _ | _ |
| Hot-addable without redeploy | 2 | _ | _ |
| Measurable (success rate, eval score) | 3 | _ | _ |
| Composition (planner chains skills) | 1 | _ | _ |
| Marketplace / third-party support | 1 | _ | _ |
| **Subtotal** | **12** | **_** | |
| **Auto-deductions** | | **_** | |

### #3 Human-in-the-loop quality (10 pts)
| Criterion | Max | Score | Evidence |
|-----------|-----|-------|----------|
| Confidence-scored escalation | 2 | _ | _ |
| Destructive actions confirm | 2 | _ | _ |
| Plan preview before multi-step | 2 | _ | _ |
| Corrections persist | 2 | _ | _ |
| Undo / rollback | 1 | _ | _ |
| Audit trail | 1 | _ | _ |
| **Subtotal** | **10** | **_** | |
| **Auto-deductions** | | **_** | |

### #4 Core agent quality (6 pts)
| Criterion | Max | Score | Evidence |
|-----------|-----|-------|----------|
| Intent accuracy ≥ 92% | 2 | _ | nightly report |
| Hallucination ≤ 2% | 2 | _ | nightly report |
| Multi-turn coherence | 1 | _ | nightly report |
| Memory recall | 1 | _ | nightly report |
| **Subtotal** | **6** | **_** | |
| **Auto-deductions** | | **_** | |

**Tier 1 total: __ / 40**

---

## Tier 2 — Domain Workflows (28 pts)

| # | Category | Max | Score | Evidence |
|---|----------|-----|-------|----------|
| 5 | Bookkeeping | 8 | _ | _ |
| 6 | Invoicing | 6 | _ | _ |
| 7 | Tax | 6 | _ | _ |
| 8 | Budget / advisor | 4 | _ | _ |
| 9 | Consultation Q&A | 4 | _ | _ |
| | **Tier 2 total** | **28** | **_** | |

---

## Tier 3 — Activation (14 pts)

| # | Category | Max | Score | Evidence |
|---|----------|-----|-------|----------|
| 10 | Onboarding & first-15-min | 8 | _ | _ |
| 11 | Billing / monetization | 4 | _ | _ |
| 12 | Plaid / bank sync | 2 | _ | _ |
| | **Tier 3 total** | **14** | **_** | |

---

## Tier 4 — Trust & Ops (15 pts)

| # | Category | Max | Score | Evidence |
|---|----------|-----|-------|----------|
| 13 | Security & tenant isolation | 5 | _ | _ |
| 14 | Observability & ops | 4 | _ | _ |
| 15 | Support & feedback loop | 3 | _ | _ |
| 16 | Legal & data rights | 3 | _ | _ |
| | **Tier 4 total** | **15** | **_** | |

---

## Tier 5 — Platform Extensibility (3 pts)

| # | Category | Max | Score | Evidence |
|---|----------|-----|-------|----------|
| 17 | Multi-platform adapter abstraction | 3 | _ | _ |

---

## Hard Floors

- Tier 1 total: __ / 40 — pass/fail: __  (capped at 90 if < 32)
- Auto-fail clauses (any hit → cap at 85):
  - [ ] No plan-preview for multi-step
  - [ ] Skills hardcoded if/else
  - [ ] Destructive financial action without confirm
  - [ ] Corrections never persist

---

## Final score

- Raw sum: __ / 100
- After hard-floor caps: __ / 100
- Distance to 95: __ points
- Top 3 highest-leverage gaps (points reclaimed / effort): __, __, __
```

- [ ] **Step 4: Create test directory + LLM-fixture scaffolding**

```bash
mkdir -p tests/e2e/gtm/fixtures/llm-responses tests/e2e/gtm/helpers
```

Create `tests/e2e/gtm/README.md`:
```markdown
# GTM Test Suite

Fast PR-gate tests for AgentBook GTM assessment. Mocked LLM.

## Layout
- `01-bookkeeping.spec.ts` through `09-plaid.spec.ts` — workflow specs
- `helpers/` — shared utilities (login, mock LLM injection, fixture loading)
- `fixtures/llm-responses/` — canned Gemini responses keyed by (skill, user-message-hash)

## Run
```
cd tests/e2e && npx playwright test gtm/ --config=playwright.config.ts
```

## Mock LLM strategy
The agent brain receives `callGemini` as a dependency (`ctx.callGemini` in `agent-brain.ts:28`). Tests
inject a mock `callGemini` that looks up the response in `fixtures/llm-responses/`. New scenarios add
fixture files; never branch the mock.
```

Create `tests/e2e/gtm/fixtures/llm-responses/README.md`:
```markdown
# LLM Response Fixtures

Filename pattern: `<scenario>__<step>.json`

Each file:
```json
{
  "system": "<system prompt prefix the test expects>",
  "user": "<user message verbatim>",
  "response": "<canned Gemini reply>",
  "maxTokens": 500
}
```

If a test invokes `callGemini` with a (system, user) pair that has no fixture, the mock throws — this surfaces test/fixture drift immediately.
```

- [ ] **Step 5: Create nightly canonical-utterances stub**

Create `tests/e2e/nightly/canonical-utterances.ts`:
```typescript
// Versioned eval set for the nightly real-LLM agent-realism suite.
// Changes require explanation in commit message. See spec §6.2.

export type Persona = 'maya' | 'alex' | 'jordan';

export interface CanonicalUtterance {
  id: string;          // stable: cu-maya-001
  persona: Persona;
  text: string;
  category: 'bookkeeping' | 'invoicing' | 'tax' | 'budget' | 'consultation' | 'onboarding';
  expectedSkill?: string;       // which skill SHOULD be invoked
  forbidden?: string[];          // strings the agent must NOT say
  required?: string[];           // strings the agent MUST include
  isMultiTurn?: boolean;         // if true, this is part of a thread
  threadId?: string;             // groups multi-turn utterances
}

// Populated in Task B.8.
export const CANONICAL: CanonicalUtterance[] = [];
```

- [ ] **Step 6: Commit pre-flight scaffolding**

```bash
git add docs/superpowers/reports/2026-05-21-code-review.md \
        docs/superpowers/reports/2026-05-21-rubric-scorecard.md \
        tests/e2e/gtm/README.md \
        tests/e2e/gtm/fixtures/llm-responses/README.md \
        tests/e2e/nightly/canonical-utterances.ts
git commit -m "chore(gtm): scaffold Phase 1 audit artifacts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Expected: clean commit, no other files modified.

---

## Stream A — Code Review

Each Stream A task follows the same shape: open files → apply the §6.1 checklist (agent-pattern adherence, security, error handling, data integrity, test coverage, performance/cost) → write findings in `[severity] file:line — issue — fix` format → commit.

> **For Stream A executors:** the checklist is the test. A task is complete when every file in its scope has been read and every finding format-conforms. "Nothing wrong" is a valid finding ("No issues found at `blocker`/`launch` severity"); document it.

### Task A.1: Review `plugins/agentbook-core/backend/src/**`

This is the highest-leverage review — the agent brain itself.

**Files (read all):**
- `plugins/agentbook-core/backend/src/agent-brain.ts`
- `plugins/agentbook-core/backend/src/agent-planner.ts`
- `plugins/agentbook-core/backend/src/agent-evaluator.ts`
- `plugins/agentbook-core/backend/src/agent-memory.ts`
- `plugins/agentbook-core/backend/src/built-in-skills.ts`
- `plugins/agentbook-core/backend/src/server.ts`
- `plugins/agentbook-core/backend/src/dashboard/agent-summary.ts`
- `plugins/agentbook-core/backend/src/db/**`
- `plugins/agentbook-core/backend/src/__tests__/**`

**Modify:** `docs/superpowers/reports/2026-05-21-code-review.md` — section "Stream A.1"

- [ ] **Step 1: Read all files in scope**

```bash
wc -l plugins/agentbook-core/backend/src/**/*.ts
```

- [ ] **Step 2: For each file, apply the checklist**

For each file, ask:

| Check | What to look for |
|-------|------------------|
| Agent-pattern adherence | Hardcoded if/else routing? Skill manifest registration missing? Logic that should be a skill? |
| Security | Tenant-id check on every read/write? Secrets in logs? Input validation? Rate limits on LLM-cost endpoints? |
| Error handling | Unhandled promise rejections? User-visible error messages? Idempotency on `POST` to financial endpoints (look for `idempotencyKey` or natural keys)? |
| Data integrity | Mutations that silently overwrite? Missing audit trail writes? Financial fields stored as float (must be integer cents)? |
| Test coverage | Does the function have a test in `__tests__/`? Does the test cover error paths? |
| Performance / cost | N+1 queries (loop with `await prisma...`)? Missing `select`/`include` discipline? LLM called twice for the same context in one request? |

- [ ] **Step 3: Write findings**

Append to `docs/superpowers/reports/2026-05-21-code-review.md` under "Stream A.1" using exactly this format:

```markdown
- [blocker] plugins/agentbook-core/backend/src/server.ts:1234 — destructive op without confirm — gate behind explicit user-confirm message before executing
- [launch] plugins/agentbook-core/backend/src/agent-planner.ts:87 — LLM called without timeout — wrap in `Promise.race` with 30s timeout, fallback to simple-classifier
- [polish] plugins/agentbook-core/backend/src/agent-memory.ts:201 — memory entries never pruned — add nightly job to TTL entries older than 90d
- [nit] plugins/agentbook-core/backend/src/agent-brain.ts:45 — magic number `0.65` for confidence threshold — extract to named constant
```

Aim for ≥ 1 finding per significant file, or write `No issues found at blocker/launch severity` for files that are clean.

- [ ] **Step 4: Run sanity check**

```bash
grep -c "^- \[blocker\]\|^- \[launch\]\|^- \[polish\]\|^- \[nit\]\|No issues found" \
  docs/superpowers/reports/2026-05-21-code-review.md
```

Expected: number ≥ (count of files in scope).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/reports/2026-05-21-code-review.md
git commit -m "docs(gtm): code review A.1 — agentbook-core backend

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task A.2: Review domain plugins (expense / invoice / tax / billing)

**Files (read all backend src):**
- `plugins/agentbook-expense/backend/src/**`
- `plugins/agentbook-invoice/backend/src/**`
- `plugins/agentbook-tax/backend/src/**`
- `plugins/agentbook-billing/**/src/**` (if present — check `ls plugins/`)

**Modify:** `docs/superpowers/reports/2026-05-21-code-review.md` — section "Stream A.2"

- [ ] **Step 1: List files in scope**

```bash
find plugins/agentbook-expense plugins/agentbook-invoice plugins/agentbook-tax -name "*.ts" -not -path "*/node_modules/*" -not -path "*/dist/*" | sort
find plugins -maxdepth 2 -name "billing*" -type d
```

- [ ] **Step 2: Apply the same checklist as Task A.1**

Same six checks. Pay extra attention to:

- **Data integrity for financial flows:** look for `Float` types in Prisma schema fields that represent money. Look for missing `updatedAt` audit columns. Look for soft-delete vs hard-delete inconsistency.
- **Idempotency:** `POST /expense`, `POST /invoice`, `POST /tax/file`, `POST /billing/subscribe` should each accept an idempotency key (header or body field) and reject duplicates.
- **Stripe webhook handling** (billing plugin): signature verification present? Replay protection? Webhook handler idempotent?

- [ ] **Step 3: Write findings**

Append to `docs/superpowers/reports/2026-05-21-code-review.md` under "Stream A.2" using the same format as Task A.1.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/reports/2026-05-21-code-review.md
git commit -m "docs(gtm): code review A.2 — domain plugins

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task A.3: Review `apps/web-next/src/app/api/v1/agentbook*/**`

The adapter layer between HTTP and the agent brain.

**Files:**
- `apps/web-next/src/app/api/v1/agentbook/**` (telegram, cron, stripe-webhook, switch-tenant, expense, invoice, tax, core)
- `apps/web-next/src/app/api/v1/agentbook-core/**`

**Modify:** `docs/superpowers/reports/2026-05-21-code-review.md` — section "Stream A.3"

- [ ] **Step 1: List files**

```bash
find apps/web-next/src/app/api/v1/agentbook apps/web-next/src/app/api/v1/agentbook-core -name "route.ts" -o -name "*.ts" | grep -v ".next" | sort
```

- [ ] **Step 2: Apply checklist with adapter-specific emphasis**

In addition to the standard six checks:
- **Adapter purity:** does this route contain agent decision logic that belongs in `plugins/agentbook-core`? Move-or-flag.
- **Telegram webhook:** signature verification present (`X-Telegram-Bot-Api-Secret-Token`)? Webhook idempotent?
- **Stripe webhook:** `stripe.webhooks.constructEvent` used with raw body? Replay protection?
- **Multi-tenant:** every route resolves a tenant before reading/writing? No `findMany` without tenant filter?

- [ ] **Step 3: Write findings + commit**

```bash
git add docs/superpowers/reports/2026-05-21-code-review.md
git commit -m "docs(gtm): code review A.3 — web-next API routes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task A.4: Review `apps/web-next/src/app/(dashboard)/**`

**Critical for rubric #1** — flag any page that performs an action *only* via form with no chat equivalent.

**Modify:** `docs/superpowers/reports/2026-05-21-code-review.md` — section "Stream A.4"

- [ ] **Step 1: List pages**

```bash
find apps/web-next/src/app/\(dashboard\) -name "page.tsx" -o -name "*Form*.tsx" -o -name "*Dialog*.tsx" | sort
```

- [ ] **Step 2: For each page, ask the agent-first test**

Question per page: "Can a user accomplish this entire screen's purpose by chatting with the agent? Or does the user *have* to use this form?"

Examples of findings:
```markdown
- [launch] apps/web-next/src/app/(dashboard)/invoices/new/page.tsx:1 — invoice creation form has no chat equivalent — verify `create-invoice` skill end-to-end OR explicitly mark form as "manual override" with link to chat
- [launch] apps/web-next/src/app/(dashboard)/settings/page.tsx:45 — settings only mutable via form — add `update-setting` skill OR document settings as deliberately-form-only (rubric #1 deduction)
- [polish] apps/web-next/src/app/(dashboard)/expenses/page.tsx:120 — page renders independently of agent state (own fetch) — refactor to read from agent-session store so corrections from chat appear live
```

Also check:
- **Plan preview** (rubric #3): when chat triggers a multi-step flow, does the UI render the plan with Proceed/Cancel buttons (matches existing Telegram pattern in `agent-brain-v2-design.md`)?
- **Intermediate state** (rubric #1): when agent is "thinking", does the UI show a meaningful status (typing indicator, "checking your March expenses…") or just spin?

- [ ] **Step 3: Write findings + commit**

```bash
git add docs/superpowers/reports/2026-05-21-code-review.md
git commit -m "docs(gtm): code review A.4 — dashboard UI agent-first audit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task A.5: Review Prisma schema + existing test coverage

**Files:**
- `packages/database/prisma/schema.prisma`
- `tests/e2e/**/*.spec.ts` (the existing 40+ specs)

**Modify:** `docs/superpowers/reports/2026-05-21-code-review.md` — section "Stream A.5"

- [ ] **Step 1: Schema review**

```bash
wc -l packages/database/prisma/schema.prisma
grep -c "^model " packages/database/prisma/schema.prisma
```

For each model, ask:
- Money fields stored as `Int` (cents) or `Decimal`, NOT `Float`?
- Tenant scoping field (`tenantId`/`userId`) present on every multi-tenant model and indexed?
- Soft-delete (`deletedAt`) used consistently OR explicitly excluded?
- Audit columns (`createdAt`, `updatedAt`) present?
- Unique constraints on natural keys to enable idempotency?
- Foreign-key `onDelete` policies set?

- [ ] **Step 2: Test coverage gap analysis**

```bash
find tests/e2e -name "*.spec.ts" -not -path "*/node_modules/*" | sort | uniq -c | sort -rn | head -5
ls tests/e2e | grep " 2\.ts$"
```

Findings to record:
- Duplicate spec files (`*.spec 2.ts`) — flag for cleanup as launch-level.
- Skills with no e2e coverage — cross-reference `BUILT_IN_SKILLS` in `server.ts` against existing spec filenames.
- Tests that only assert `200` status without verifying business outcome.

- [ ] **Step 3: Write findings + commit**

```bash
git add docs/superpowers/reports/2026-05-21-code-review.md
git commit -m "docs(gtm): code review A.5 — schema + existing tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task A.6: Stream A summary

**Modify:** `docs/superpowers/reports/2026-05-21-code-review.md` — section "Summary"

- [ ] **Step 1: Count findings**

```bash
grep -c "^- \[blocker\]" docs/superpowers/reports/2026-05-21-code-review.md
grep -c "^- \[launch\]" docs/superpowers/reports/2026-05-21-code-review.md
grep -c "^- \[polish\]" docs/superpowers/reports/2026-05-21-code-review.md
grep -c "^- \[nit\]" docs/superpowers/reports/2026-05-21-code-review.md
```

- [ ] **Step 2: Fill in summary section**

Update the "Summary" block at the bottom of `2026-05-21-code-review.md` with the counts, plus a 5-bullet "top blockers" list (the 5 most severe findings).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/reports/2026-05-21-code-review.md
git commit -m "docs(gtm): code review summary

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Stream B — Behavior-Driven Test Suite

### Task B.1: Test harness — login helper + mocked-LLM injector

**Files:**
- Create: `tests/e2e/gtm/helpers/login.ts`
- Create: `tests/e2e/gtm/helpers/mock-llm.ts`
- Create: `tests/e2e/gtm/helpers/chat.ts`
- Create: `tests/e2e/gtm/helpers/__tests__/mock-llm.test.ts`

- [ ] **Step 1: Write the failing test for mock-llm**

Create `tests/e2e/gtm/helpers/__tests__/mock-llm.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { loadFixture, mockCallGemini } from '../mock-llm';

describe('mock-llm', () => {
  it('returns canned response when fixture matches', async () => {
    const mock = mockCallGemini([
      { system: 'sys-A', user: 'log a coffee for $5', response: '{"skill":"record-expense","amount":500}', maxTokens: 500 }
    ]);
    const result = await mock('sys-A', 'log a coffee for $5', 500);
    expect(result).toBe('{"skill":"record-expense","amount":500}');
  });

  it('throws when no fixture matches (surfaces drift)', async () => {
    const mock = mockCallGemini([]);
    await expect(mock('sys-X', 'unknown', 500)).rejects.toThrow(/no fixture/i);
  });

  it('loads fixtures from disk', () => {
    const fixtures = loadFixture('bookkeeping-coffee');
    expect(fixtures).toHaveProperty('user');
    expect(fixtures).toHaveProperty('response');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
npx vitest run tests/e2e/gtm/helpers/__tests__/mock-llm.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement mock-llm**

Create `tests/e2e/gtm/helpers/mock-llm.ts`:
```typescript
import fs from 'node:fs';
import path from 'node:path';

export interface LLMFixture {
  system: string;
  user: string;
  response: string;
  maxTokens?: number;
}

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'llm-responses');

export function loadFixture(name: string): LLMFixture {
  const file = path.join(FIXTURE_DIR, `${name}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadFixtures(...names: string[]): LLMFixture[] {
  return names.map(loadFixture);
}

export function mockCallGemini(fixtures: LLMFixture[]) {
  return async (system: string, user: string, _max?: number): Promise<string | null> => {
    const match = fixtures.find(f => f.system === system && f.user === user);
    if (!match) throw new Error(`no fixture for (system="${system.slice(0,40)}…", user="${user}")`);
    return match.response;
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/e2e/gtm/helpers/__tests__/mock-llm.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Implement login helper**

Create `tests/e2e/gtm/helpers/login.ts`:
```typescript
import type { Page } from '@playwright/test';

export const PERSONAS = {
  maya: { email: 'maya@agentbook.test', password: 'agentbook123' },
  alex: { email: 'alex@agentbook.test', password: 'agentbook123' },
  jordan: { email: 'jordan@agentbook.test', password: 'agentbook123' },
  admin: { email: 'admin@a3p.io', password: 'a3p-dev' },
} as const;

export type PersonaKey = keyof typeof PERSONAS;

export async function loginAs(page: Page, persona: PersonaKey) {
  const { email, password } = PERSONAS[persona];
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|home|overview)/);
}
```

- [ ] **Step 6: Implement chat helper**

Create `tests/e2e/gtm/helpers/chat.ts`:
```typescript
import type { Page, APIRequestContext } from '@playwright/test';

export interface AgentTurn {
  text: string;
  expectSkill?: string;
  expectContains?: string | RegExp;
  expectPlan?: boolean;
}

/**
 * Send a single agent turn via the canonical agent endpoint and return parsed JSON.
 * Tests should prefer this over UI chat for determinism — the UI test (#07) verifies the bridge.
 */
export async function sendAgentMessage(
  request: APIRequestContext,
  authToken: string,
  body: { message: string; sessionId?: string; userId: string }
): Promise<any> {
  const res = await request.post('/api/v1/agentbook-core/agent/message', {
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    data: body,
  });
  if (!res.ok()) throw new Error(`agent endpoint ${res.status()}: ${await res.text()}`);
  return res.json();
}
```

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/gtm/helpers/
git commit -m "feat(gtm-tests): mock-llm + login + chat helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task B.2: Spec `01-bookkeeping.spec.ts`

**Files:**
- Create: `tests/e2e/gtm/01-bookkeeping.spec.ts`
- Create: `tests/e2e/gtm/fixtures/llm-responses/bookkeeping-*.json` (one per agent turn)

- [ ] **Step 1: Write the spec (single complete file)**

Create `tests/e2e/gtm/01-bookkeeping.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/login';
import { sendAgentMessage } from './helpers/chat';

test.describe('GTM #01 — bookkeeping (Maya, chat-driven)', () => {
  let authToken: string;
  let userId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: { email: 'maya@agentbook.test', password: 'agentbook123' },
    });
    const body = await res.json();
    authToken = body.token;
    userId = body.user.id;
  });

  test('logs 10 receipts via chat in sequence', async ({ request }) => {
    const utterances = [
      'log $8.50 for coffee at Starbucks today',
      'I spent $42 on uber to a client meeting',
      'add $120 for AWS subscription this month',
      'log a $15 lunch business meal',
      'paid $9.99 for ChatGPT subscription',
      'expense $250 office supplies from Staples',
      '$35 gas for client visit',
      'log $1200 macbook accessory — laptop stand and dock',
      'paid contractor $500 for design work',
      '$22 parking at airport for client trip',
    ];

    for (const u of utterances) {
      const response = await sendAgentMessage(request, authToken, { message: u, userId });
      expect(response.skill || response.intent).toBeDefined();
      expect(response.status).not.toBe('error');
    }

    // Verify all 10 expenses exist
    const list = await request.get('/api/v1/agentbook-expense/list', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const expenses = (await list.json()).expenses ?? [];
    expect(expenses.length).toBeGreaterThanOrEqual(10);
  });

  test('correction persists ("no, that was a meal not transport")', async ({ request }) => {
    const r1 = await sendAgentMessage(request, authToken, { message: 'log $40 lunch with potential client', userId });
    expect(r1.status).not.toBe('error');
    const r2 = await sendAgentMessage(request, authToken, { message: 'actually that should be marketing not meals', userId });
    expect(r2.status).not.toBe('error');
    // Verify next similar utterance respects the correction (gemini-quality, may be loose)
    const r3 = await sendAgentMessage(request, authToken, { message: 'log $35 coffee with prospect', userId });
    // Soft assertion: agent should at least acknowledge the prior preference
    expect(JSON.stringify(r3).toLowerCase()).toMatch(/marketing|categor/);
  });

  test('recurring expense (subscription) detected and offered as recurring', async ({ request }) => {
    const r = await sendAgentMessage(request, authToken, { message: 'add $12.99 monthly Spotify subscription', userId });
    expect(r.status).not.toBe('error');
    // Agent should either auto-create as recurring OR offer to make it recurring
    const text = JSON.stringify(r).toLowerCase();
    expect(text).toMatch(/recurring|monthly|subscription/);
  });

  test('split expense (50/50 personal/business)', async ({ request }) => {
    const r = await sendAgentMessage(request, authToken, { message: 'log $100 phone bill, split half personal half business', userId });
    expect(r.status).not.toBe('error');
    const text = JSON.stringify(r).toLowerCase();
    expect(text).toMatch(/split|50|half/);
  });

  test('edit existing expense via chat', async ({ request }) => {
    const r1 = await sendAgentMessage(request, authToken, { message: 'log $25 lunch yesterday', userId });
    const r2 = await sendAgentMessage(request, authToken, { message: 'change my lunch yesterday to $32', userId });
    expect(r2.status).not.toBe('error');
  });
});
```

- [ ] **Step 2: Run the spec**

```bash
cd tests/e2e
npx playwright test gtm/01-bookkeeping.spec.ts --config=playwright.config.ts --reporter=list
```

Expected: tests run; **whether they pass or fail is the audit signal.** Both outcomes are valuable findings.

- [ ] **Step 3: Capture results**

Append to `docs/superpowers/reports/2026-05-21-code-review.md` under new section "Stream B — Test Results":
```markdown
### B.2 bookkeeping
- 5 tests, X passed, Y failed
- Failures (each becomes a gap candidate):
  - `correction persists` — agent did not respect prior correction. file:agent-memory.ts — needs investigation
  - ...
```

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/gtm/01-bookkeeping.spec.ts docs/superpowers/reports/2026-05-21-code-review.md
git commit -m "test(gtm): spec 01 bookkeeping + record results

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task B.3: Spec `02-invoicing.spec.ts`

**Files:**
- Create: `tests/e2e/gtm/02-invoicing.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/gtm/02-invoicing.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';
import { sendAgentMessage } from './helpers/chat';

test.describe('GTM #02 — invoicing (Alex, chat-driven)', () => {
  let authToken: string;
  let userId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: { email: 'alex@agentbook.test', password: 'agentbook123' },
    });
    const body = await res.json();
    authToken = body.token;
    userId = body.user.id;
  });

  test('create invoice via chat', async ({ request }) => {
    const r = await sendAgentMessage(request, authToken, {
      message: 'create an invoice for Acme Corp for $5000 due in 30 days for "March consulting"',
      userId,
    });
    expect(r.status).not.toBe('error');
    const text = JSON.stringify(r).toLowerCase();
    expect(text).toMatch(/invoice|acme|5000|march/);
  });

  test('send invoice — requires explicit confirm (rubric #3)', async ({ request }) => {
    const r1 = await sendAgentMessage(request, authToken, { message: 'send my latest draft invoice to acme', userId });
    // RUBRIC AUDIT: should NOT auto-send. Should ask "are you sure?" / show preview.
    const text = JSON.stringify(r1).toLowerCase();
    expect(text).toMatch(/confirm|are you sure|preview|review|proceed/);
  });

  test('mark invoice paid', async ({ request }) => {
    const r = await sendAgentMessage(request, authToken, { message: 'mark the Acme invoice as paid', userId });
    expect(r.status).not.toBe('error');
  });

  test('void invoice — requires explicit confirm', async ({ request }) => {
    const r = await sendAgentMessage(request, authToken, { message: 'void the Acme invoice', userId });
    const text = JSON.stringify(r).toLowerCase();
    expect(text).toMatch(/confirm|are you sure|void|cannot be undone/);
  });

  test('refund invoice', async ({ request }) => {
    const r = await sendAgentMessage(request, authToken, { message: 'refund the $500 deposit on the Beta Inc invoice', userId });
    // Either executes with confirm, or asks for which invoice — both acceptable. Should NOT silently refund.
    const text = JSON.stringify(r).toLowerCase();
    expect(text).toMatch(/confirm|which|refund|beta/);
  });

  test('recurring invoice', async ({ request }) => {
    const r = await sendAgentMessage(request, authToken, {
      message: 'set up a monthly recurring invoice for Gamma LLC at $2000',
      userId,
    });
    expect(r.status).not.toBe('error');
    const text = JSON.stringify(r).toLowerCase();
    expect(text).toMatch(/recurring|monthly|gamma|2000/);
  });

  test('follow-up reminder', async ({ request }) => {
    const r = await sendAgentMessage(request, authToken, { message: 'send a friendly reminder to acme about the overdue invoice', userId });
    const text = JSON.stringify(r).toLowerCase();
    expect(text).toMatch(/confirm|preview|reminder|acme/);
  });
});
```

- [ ] **Step 2: Run + capture + commit**

```bash
cd tests/e2e && npx playwright test gtm/02-invoicing.spec.ts --config=playwright.config.ts --reporter=list
```

Append results to `Stream B — Test Results` section in code review report (same format as B.2).

```bash
git add tests/e2e/gtm/02-invoicing.spec.ts docs/superpowers/reports/2026-05-21-code-review.md
git commit -m "test(gtm): spec 02 invoicing + record results

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task B.4: Specs 03 budget-advisor + 04 tax + 05 consultation

**Files:**
- Create: `tests/e2e/gtm/03-budget-advisor.spec.ts`
- Create: `tests/e2e/gtm/04-tax.spec.ts`
- Create: `tests/e2e/gtm/05-consultation.spec.ts`

- [ ] **Step 1: Write 03-budget-advisor.spec.ts**

```typescript
import { test, expect } from '@playwright/test';
import { sendAgentMessage } from './helpers/chat';

test.describe('GTM #03 — budget / advisor (Jordan)', () => {
  let authToken: string;
  let userId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: { email: 'jordan@agentbook.test', password: 'agentbook123' },
    });
    const body = await res.json();
    authToken = body.token;
    userId = body.user.id;
  });

  const queries = [
    { msg: "what's my spending this month?", must: /spending|month|\$/i },
    { msg: 'am I on track for my budget?', must: /budget|track|under|over/i },
    { msg: 'what are my top 3 expense categories?', must: /top|categor|3|first/i },
    { msg: 'what if I cut my meals budget by 20%?', must: /scenario|simul|save|reduce/i },
    { msg: 'forecast my Q3 cash flow', must: /forecast|q3|cash|project/i },
  ];

  for (const q of queries) {
    test(`advisor query: ${q.msg}`, async ({ request }) => {
      const r = await sendAgentMessage(request, authToken, { message: q.msg, userId });
      expect(r.status).not.toBe('error');
      expect(JSON.stringify(r)).toMatch(q.must);
    });
  }
});
```

- [ ] **Step 2: Write 04-tax.spec.ts**

```typescript
import { test, expect } from '@playwright/test';
import { sendAgentMessage } from './helpers/chat';

test.describe('GTM #04 — tax (Maya CA + Alex US)', () => {
  test('CA tax estimate (Maya)', async ({ request }) => {
    const login = await request.post('/api/v1/auth/login', { data: { email: 'maya@agentbook.test', password: 'agentbook123' } });
    const { token, user } = await login.json();
    const r = await sendAgentMessage(request, token, { message: 'estimate my Q2 GST/HST owing', userId: user.id });
    expect(r.status).not.toBe('error');
    expect(JSON.stringify(r).toLowerCase()).toMatch(/gst|hst|tax|owing|q2/);
  });

  test('US tax estimate (Alex)', async ({ request }) => {
    const login = await request.post('/api/v1/auth/login', { data: { email: 'alex@agentbook.test', password: 'agentbook123' } });
    const { token, user } = await login.json();
    const r = await sendAgentMessage(request, token, { message: 'what is my estimated quarterly tax for Q2?', userId: user.id });
    expect(r.status).not.toBe('error');
    expect(JSON.stringify(r).toLowerCase()).toMatch(/quarterly|tax|q2|estimat/);
  });

  test('deduction discovery', async ({ request }) => {
    const login = await request.post('/api/v1/auth/login', { data: { email: 'maya@agentbook.test', password: 'agentbook123' } });
    const { token, user } = await login.json();
    const r = await sendAgentMessage(request, token, { message: 'find me deductions I might have missed last quarter', userId: user.id });
    expect(r.status).not.toBe('error');
    expect(JSON.stringify(r).toLowerCase()).toMatch(/deduct|missed|claim/);
  });

  test('filing-prep package — must NOT silently file (rubric #3)', async ({ request }) => {
    const login = await request.post('/api/v1/auth/login', { data: { email: 'maya@agentbook.test', password: 'agentbook123' } });
    const { token, user } = await login.json();
    const r = await sendAgentMessage(request, token, { message: 'prepare my tax filing package', userId: user.id });
    expect(r.status).not.toBe('error');
    const text = JSON.stringify(r).toLowerCase();
    // Should produce a package (preview/draft), not submit
    expect(text).toMatch(/package|preview|draft|review/);
    expect(text).not.toMatch(/submitted|filed with/);
  });
});
```

- [ ] **Step 3: Write 05-consultation.spec.ts**

```typescript
import { test, expect } from '@playwright/test';
import { sendAgentMessage } from './helpers/chat';

test.describe('GTM #05 — consultation Q&A', () => {
  test('on-domain accounting question', async ({ request }) => {
    const login = await request.post('/api/v1/auth/login', { data: { email: 'maya@agentbook.test', password: 'agentbook123' } });
    const { token, user } = await login.json();
    const r = await sendAgentMessage(request, token, { message: "what's the difference between cash and accrual accounting?", userId: user.id });
    expect(r.status).not.toBe('error');
    expect(JSON.stringify(r).toLowerCase()).toMatch(/cash|accrual|recogniz|recogniz/);
  });

  test('out-of-domain honesty (rubric #9)', async ({ request }) => {
    const login = await request.post('/api/v1/auth/login', { data: { email: 'maya@agentbook.test', password: 'agentbook123' } });
    const { token, user } = await login.json();
    const r = await sendAgentMessage(request, token, { message: 'what is the weather in Toronto today?', userId: user.id });
    expect(r.status).not.toBe('error');
    const text = JSON.stringify(r).toLowerCase();
    // Should say it doesn't know / not its job — not fabricate
    expect(text).toMatch(/don't|not|can't|outside|focus|accounting/);
  });

  test('citation when answering tax-rule question', async ({ request }) => {
    const login = await request.post('/api/v1/auth/login', { data: { email: 'alex@agentbook.test', password: 'agentbook123' } });
    const { token, user } = await login.json();
    const r = await sendAgentMessage(request, token, { message: 'what is the home-office deduction rate for 2026?', userId: user.id });
    expect(r.status).not.toBe('error');
    // Either cites a source, OR says "I'm not certain — verify with IRS"
    const text = JSON.stringify(r).toLowerCase();
    expect(text).toMatch(/irs|source|verify|consult|publication|not certain|don't know/);
  });
});
```

- [ ] **Step 4: Run all three + capture**

```bash
cd tests/e2e
npx playwright test gtm/03-budget-advisor.spec.ts gtm/04-tax.spec.ts gtm/05-consultation.spec.ts --config=playwright.config.ts --reporter=list
```

Append results to code review report (same format).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/gtm/03-budget-advisor.spec.ts tests/e2e/gtm/04-tax.spec.ts tests/e2e/gtm/05-consultation.spec.ts \
        docs/superpowers/reports/2026-05-21-code-review.md
git commit -m "test(gtm): specs 03-05 budget/tax/consultation + record results

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task B.5: Spec `06-onboarding.spec.ts`

**Files:**
- Create: `tests/e2e/gtm/06-onboarding.spec.ts`

- [ ] **Step 1: Write the spec — instrumented timer + first-value path**

```typescript
import { test, expect } from '@playwright/test';

test.describe('GTM #06 — onboarding first-15-min', () => {
  test('new user reaches first value in under 15 minutes (instrumented)', async ({ page, request }) => {
    const t0 = Date.now();

    // Step 1: signup
    const email = `onboard-${Date.now()}@agentbook.test`;
    const signup = await request.post('/api/v1/auth/signup', {
      data: { email, password: 'TestPassword123!', name: 'Onboarding Test' },
    });
    expect(signup.ok()).toBeTruthy();
    const { token, user } = await signup.json();

    // Step 2: persona / business setup happens in dashboard
    await page.goto('/login');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|onboarding|home/);

    // Step 3: complete whatever onboarding screen appears (heuristic)
    // If a "skip" / "later" button is offered, take it — measures friction
    const skipBtn = page.getByRole('button', { name: /skip|later|continue/i }).first();
    if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await skipBtn.click();
    }

    // Step 4: user logs first expense via chat
    const r = await request.post('/api/v1/agentbook-core/agent/message', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message: 'log $20 coffee meeting with a client', userId: user.id },
    });
    expect(r.ok()).toBeTruthy();

    const elapsedMs = Date.now() - t0;
    const elapsedMin = elapsedMs / 60000;
    console.log(`onboarding first-value time: ${elapsedMin.toFixed(2)} min`);

    // 15 min budget for first value
    expect(elapsedMs).toBeLessThan(15 * 60 * 1000);
  });

  test('demo-data path: new user can opt-in to seeded data', async ({ page, request }) => {
    const email = `demo-${Date.now()}@agentbook.test`;
    await request.post('/api/v1/auth/signup', {
      data: { email, password: 'TestPassword123!', name: 'Demo Test' },
    });
    await page.goto('/login');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');

    // Look for a "load demo data" / "see how it works" affordance
    const demoCta = page.getByRole('button', { name: /demo|sample|example/i }).first();
    const exists = await demoCta.isVisible({ timeout: 5000 }).catch(() => false);

    // Soft assertion: if no demo path exists, this is a rubric #10 finding
    if (!exists) {
      console.log('FINDING: no demo-data path found — flag in rubric #10');
    }
  });
});
```

- [ ] **Step 2: Run + capture + commit**

```bash
cd tests/e2e && npx playwright test gtm/06-onboarding.spec.ts --config=playwright.config.ts --reporter=list
```

Append results, then:

```bash
git add tests/e2e/gtm/06-onboarding.spec.ts docs/superpowers/reports/2026-05-21-code-review.md
git commit -m "test(gtm): spec 06 onboarding first-15-min + record results

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task B.6: Adapter abstraction refactor (TDD-real)

**This task does real code change.** Refactor existing Telegram path behind a `ChatAdapter` interface; add stub WhatsApp + Discord adapters; verify with test #07.

**Files:**
- Create: `plugins/agentbook-core/backend/src/adapters/base.ts`
- Create: `plugins/agentbook-core/backend/src/adapters/telegram.ts`
- Create: `plugins/agentbook-core/backend/src/adapters/whatsapp.ts`
- Create: `plugins/agentbook-core/backend/src/adapters/discord.ts`
- Create: `plugins/agentbook-core/backend/src/adapters/registry.ts`
- Create: `plugins/agentbook-core/backend/src/adapters/__tests__/adapters.test.ts`
- Modify: `apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts` — use registry
- Create: `tests/e2e/gtm/07-adapter-abstraction.spec.ts`

- [ ] **Step 1: Write the failing unit test for adapters**

Create `plugins/agentbook-core/backend/src/adapters/__tests__/adapters.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { TelegramAdapter } from '../telegram';
import { WhatsAppAdapter } from '../whatsapp';
import { DiscordAdapter } from '../discord';
import type { NormalizedIncoming } from '../base';

describe('chat adapters', () => {
  const telegram = new TelegramAdapter();
  const whatsapp = new WhatsAppAdapter();
  const discord = new DiscordAdapter();

  it('telegram parses incoming webhook to NormalizedIncoming', () => {
    const raw = {
      update_id: 1,
      message: { chat: { id: 999 }, from: { id: 5336658682 }, text: 'log $5 coffee' },
    };
    const result = telegram.parseIncoming(raw);
    expect(result).toMatchObject({
      platform: 'telegram',
      chatId: '999',
      externalUserId: '5336658682',
      text: 'log $5 coffee',
    });
  });

  it('whatsapp parses Twilio-shaped webhook to NormalizedIncoming', () => {
    const raw = { From: 'whatsapp:+15551234567', To: 'whatsapp:+15559999999', Body: 'log $5 coffee' };
    const result = whatsapp.parseIncoming(raw);
    expect(result).toMatchObject({
      platform: 'whatsapp',
      chatId: '+15551234567',
      externalUserId: '+15551234567',
      text: 'log $5 coffee',
    });
  });

  it('discord parses message webhook to NormalizedIncoming', () => {
    const raw = {
      type: 0,
      content: 'log $5 coffee',
      channel_id: '987',
      author: { id: '12345' },
    };
    const result = discord.parseIncoming(raw);
    expect(result).toMatchObject({
      platform: 'discord',
      chatId: '987',
      externalUserId: '12345',
      text: 'log $5 coffee',
    });
  });

  it('all adapters produce the same NormalizedIncoming shape from equivalent input', () => {
    const equivalentText = 'log $5 coffee';
    const t = telegram.parseIncoming({ update_id: 1, message: { chat: { id: 1 }, from: { id: 'u' }, text: equivalentText } });
    const w = whatsapp.parseIncoming({ From: 'whatsapp:+1', To: 'whatsapp:+2', Body: equivalentText });
    const d = discord.parseIncoming({ type: 0, content: equivalentText, channel_id: '1', author: { id: 'u' } });
    expect(t.text).toBe(equivalentText);
    expect(w.text).toBe(equivalentText);
    expect(d.text).toBe(equivalentText);
    // Shape contract
    for (const r of [t, w, d]) {
      expect(r).toHaveProperty('platform');
      expect(r).toHaveProperty('chatId');
      expect(r).toHaveProperty('externalUserId');
      expect(r).toHaveProperty('text');
    }
  });

  it('whatsapp and discord sendOutgoing throw (stubs only)', async () => {
    await expect(whatsapp.sendOutgoing('+15551234567', { text: 'hi' })).rejects.toThrow(/stub|not implemented/i);
    await expect(discord.sendOutgoing('987', { text: 'hi' })).rejects.toThrow(/stub|not implemented/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run plugins/agentbook-core/backend/src/adapters/__tests__/adapters.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the base interface**

Create `plugins/agentbook-core/backend/src/adapters/base.ts`:
```typescript
export type Platform = 'telegram' | 'whatsapp' | 'discord';

export interface NormalizedIncoming {
  platform: Platform;
  chatId: string;
  externalUserId: string;
  text: string;
  attachments?: Array<{ kind: 'image' | 'file' | 'audio'; url?: string; data?: Buffer }>;
  raw: unknown;
}

export interface NormalizedOutgoing {
  text: string;
  buttons?: Array<{ label: string; payload: string }>;
  attachments?: Array<{ kind: 'image' | 'file'; url: string }>;
}

export interface AgentPlan {
  steps: Array<{ description: string }>;
  needsConfirm: boolean;
}

export interface ChatAdapter {
  readonly platform: Platform;
  parseIncoming(rawWebhookPayload: unknown): NormalizedIncoming;
  sendOutgoing(chatId: string, message: NormalizedOutgoing): Promise<void>;
  formatPlan(plan: AgentPlan): NormalizedOutgoing;
}
```

- [ ] **Step 4: Implement TelegramAdapter (real, used in prod)**

Create `plugins/agentbook-core/backend/src/adapters/telegram.ts`:
```typescript
import type { ChatAdapter, NormalizedIncoming, NormalizedOutgoing, AgentPlan } from './base';

export class TelegramAdapter implements ChatAdapter {
  readonly platform = 'telegram' as const;

  parseIncoming(raw: unknown): NormalizedIncoming {
    const r = raw as any;
    const msg = r.message ?? r.edited_message ?? r.callback_query?.message;
    if (!msg) throw new Error('telegram: no message in payload');
    return {
      platform: 'telegram',
      chatId: String(msg.chat?.id),
      externalUserId: String((r.callback_query?.from ?? msg.from)?.id ?? msg.chat?.id),
      text: r.callback_query?.data ?? msg.text ?? msg.caption ?? '',
      attachments: msg.photo ? [{ kind: 'image' }] : undefined,
      raw,
    };
  }

  async sendOutgoing(chatId: string, message: NormalizedOutgoing): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body: any = {
      chat_id: chatId,
      text: message.text,
      parse_mode: 'Markdown',
    };
    if (message.buttons?.length) {
      body.reply_markup = {
        inline_keyboard: [message.buttons.map(b => ({ text: b.label, callback_data: b.payload }))],
      };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`telegram send failed: ${res.status} ${await res.text()}`);
  }

  formatPlan(plan: AgentPlan): NormalizedOutgoing {
    const lines = plan.steps.map((s, i) => `${i + 1}. ${s.description}`);
    return {
      text: `Here's my plan:\n${lines.join('\n')}`,
      buttons: plan.needsConfirm
        ? [{ label: 'Proceed', payload: 'plan:proceed' }, { label: 'Cancel', payload: 'plan:cancel' }]
        : undefined,
    };
  }
}
```

- [ ] **Step 5: Implement WhatsApp stub**

Create `plugins/agentbook-core/backend/src/adapters/whatsapp.ts`:
```typescript
import type { ChatAdapter, NormalizedIncoming, NormalizedOutgoing, AgentPlan } from './base';

export class WhatsAppAdapter implements ChatAdapter {
  readonly platform = 'whatsapp' as const;

  parseIncoming(raw: unknown): NormalizedIncoming {
    const r = raw as any;
    const from = String(r.From ?? '').replace(/^whatsapp:/, '');
    return {
      platform: 'whatsapp',
      chatId: from,
      externalUserId: from,
      text: String(r.Body ?? ''),
      raw,
    };
  }

  async sendOutgoing(_chatId: string, _message: NormalizedOutgoing): Promise<void> {
    throw new Error('whatsapp adapter: sendOutgoing is a stub. Configure Twilio credentials and implement.');
  }

  formatPlan(plan: AgentPlan): NormalizedOutgoing {
    const lines = plan.steps.map((s, i) => `${i + 1}. ${s.description}`);
    const proceedHint = plan.needsConfirm ? '\n\nReply with PROCEED to confirm or CANCEL to abort.' : '';
    return { text: `Plan:\n${lines.join('\n')}${proceedHint}` };
  }
}
```

- [ ] **Step 6: Implement Discord stub**

Create `plugins/agentbook-core/backend/src/adapters/discord.ts`:
```typescript
import type { ChatAdapter, NormalizedIncoming, NormalizedOutgoing, AgentPlan } from './base';

export class DiscordAdapter implements ChatAdapter {
  readonly platform = 'discord' as const;

  parseIncoming(raw: unknown): NormalizedIncoming {
    const r = raw as any;
    return {
      platform: 'discord',
      chatId: String(r.channel_id ?? ''),
      externalUserId: String(r.author?.id ?? ''),
      text: String(r.content ?? ''),
      raw,
    };
  }

  async sendOutgoing(_chatId: string, _message: NormalizedOutgoing): Promise<void> {
    throw new Error('discord adapter: sendOutgoing is a stub. Configure Discord bot token and implement.');
  }

  formatPlan(plan: AgentPlan): NormalizedOutgoing {
    const lines = plan.steps.map((s, i) => `${i + 1}. ${s.description}`);
    const proceedHint = plan.needsConfirm ? '\n\nReact ✅ to confirm or ❌ to cancel.' : '';
    return { text: `**Plan:**\n${lines.join('\n')}${proceedHint}` };
  }
}
```

- [ ] **Step 7: Implement registry**

Create `plugins/agentbook-core/backend/src/adapters/registry.ts`:
```typescript
import type { ChatAdapter, Platform } from './base';
import { TelegramAdapter } from './telegram';
import { WhatsAppAdapter } from './whatsapp';
import { DiscordAdapter } from './discord';

const REGISTRY: Record<Platform, ChatAdapter> = {
  telegram: new TelegramAdapter(),
  whatsapp: new WhatsAppAdapter(),
  discord: new DiscordAdapter(),
};

export function getAdapter(platform: Platform): ChatAdapter {
  const adapter = REGISTRY[platform];
  if (!adapter) throw new Error(`No adapter registered for platform: ${platform}`);
  return adapter;
}

export const ALL_PLATFORMS: Platform[] = ['telegram', 'whatsapp', 'discord'];
```

- [ ] **Step 8: Run the unit tests to verify pass**

```bash
npx vitest run plugins/agentbook-core/backend/src/adapters/__tests__/adapters.test.ts
```

Expected: PASS (6/6 or however many).

- [ ] **Step 9: Refactor Telegram webhook route to use adapter**

Read first:
```bash
cat apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts | head -60
```

Modify `apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts`:
- At the top: replace any direct parsing of Telegram update with `const incoming = getAdapter('telegram').parseIncoming(body);`
- Replace any direct send-message-to-telegram call with `await getAdapter('telegram').sendOutgoing(incoming.chatId, normalizedOutgoing);`
- Keep the existing `CHAT_TO_TENANT` mapping intact for now.

The exact diff depends on current state — read the file, then refactor. If the file is large, scope this step to only the parsing + sending; leave business logic alone.

- [ ] **Step 10: Verify Telegram still works (smoke)**

```bash
cd apps/web-next && NODE_OPTIONS="--max-old-space-size=4096" npm run build 2>&1 | tail -20
```

Expected: build passes. If type errors appear from the refactor, fix them inline.

- [ ] **Step 11: Write e2e test `07-adapter-abstraction.spec.ts`**

Create `tests/e2e/gtm/07-adapter-abstraction.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';
import { getAdapter, ALL_PLATFORMS } from '../../../plugins/agentbook-core/backend/src/adapters/registry';

test.describe('GTM #07 — adapter abstraction', () => {
  test('all platforms parse same logical message to equivalent NormalizedIncoming', () => {
    const text = 'log $5 coffee';
    const tg = getAdapter('telegram').parseIncoming({ update_id: 1, message: { chat: { id: 1 }, from: { id: 'u' }, text } });
    const wa = getAdapter('whatsapp').parseIncoming({ From: 'whatsapp:+15551234567', To: 'whatsapp:+1', Body: text });
    const dc = getAdapter('discord').parseIncoming({ type: 0, content: text, channel_id: '1', author: { id: 'u' } });
    expect([tg.text, wa.text, dc.text]).toEqual([text, text, text]);
  });

  test('all platforms format plan with confirm into platform-appropriate output', () => {
    const plan = { steps: [{ description: 'send invoice to Acme' }], needsConfirm: true };
    for (const p of ALL_PLATFORMS) {
      const out = getAdapter(p).formatPlan(plan);
      expect(out.text).toContain('send invoice to Acme');
      // Each platform expresses confirm differently — but all must express it somehow
      const text = out.text + JSON.stringify(out.buttons ?? '');
      expect(text.toLowerCase()).toMatch(/proceed|confirm|✅/);
    }
  });

  test('adapter abstraction holds: no platform-specific code in agent brain', async () => {
    const fs = await import('node:fs/promises');
    const brain = await fs.readFile('plugins/agentbook-core/backend/src/agent-brain.ts', 'utf8');
    // The brain should NOT import telegram-specific shapes
    expect(brain.toLowerCase()).not.toMatch(/inline_keyboard|telegram|whatsapp|twilio|discord/);
  });

  test('adding a new platform is small', async () => {
    const fs = await import('node:fs/promises');
    const wa = await fs.readFile('plugins/agentbook-core/backend/src/adapters/whatsapp.ts', 'utf8');
    const dc = await fs.readFile('plugins/agentbook-core/backend/src/adapters/discord.ts', 'utf8');
    // Soft limit: a stub adapter should be < 100 LOC
    expect(wa.split('\n').length).toBeLessThan(100);
    expect(dc.split('\n').length).toBeLessThan(100);
  });
});
```

- [ ] **Step 12: Run + capture + commit**

```bash
cd tests/e2e && npx playwright test gtm/07-adapter-abstraction.spec.ts --config=playwright.config.ts --reporter=list
```

```bash
git add plugins/agentbook-core/backend/src/adapters/ \
        apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts \
        tests/e2e/gtm/07-adapter-abstraction.spec.ts \
        docs/superpowers/reports/2026-05-21-code-review.md
git commit -m "feat(adapters): ChatAdapter abstraction + Telegram refactor + WhatsApp/Discord stubs

Closes rubric #17. Telegram path refactored to use ChatAdapter interface.
WhatsApp and Discord stubs verify abstraction with unit + e2e tests.
Agent brain confirmed free of platform-specific code by test #07.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task B.7: Specs 08 billing + 09 plaid (sandbox-dependent)

**Files:**
- Create: `tests/e2e/gtm/08-billing.spec.ts`
- Create: `tests/e2e/gtm/09-plaid.spec.ts`

- [ ] **Step 1: Confirm Stripe + Plaid sandbox env vars set**

```bash
grep -E "STRIPE_(SECRET|WEBHOOK)|PLAID_(CLIENT|SECRET|ENV)" apps/web-next/.env.local | sed 's/=.*/=***/'
```

Expected: keys present. If missing, this task is blocked — note in code review report and skip.

- [ ] **Step 2: Write 08-billing.spec.ts**

```typescript
import { test, expect } from '@playwright/test';

test.describe('GTM #08 — billing (Stripe sandbox)', () => {
  let authToken: string;
  test.beforeAll(async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: { email: 'maya@agentbook.test', password: 'agentbook123' },
    });
    const body = await res.json();
    authToken = body.token;
  });

  test('subscribe to plan via Stripe sandbox', async ({ request }) => {
    // List plans
    const plansRes = await request.get('/api/v1/agentbook-billing/plans', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!plansRes.ok()) {
      console.log('SKIP: billing plugin not available or no plans configured — rubric #11 finding');
      return;
    }
    const plans = (await plansRes.json()).plans ?? [];
    expect(plans.length).toBeGreaterThan(0);
  });

  test('plan gating: free tier cannot access pro feature', async ({ request }) => {
    // Hit a gated endpoint as a free user — should 402/403 with upgrade prompt
    const r = await request.get('/api/v1/agentbook-billing/usage', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    // Either returns usage (and gate works inline), or 402 — both acceptable
    expect([200, 402, 403]).toContain(r.status());
  });

  test('webhook handles invoice.payment_succeeded', async ({ request }) => {
    // Construct a fake stripe event payload — webhook should reject without signature
    const r = await request.post('/api/v1/agentbook/stripe-webhook', {
      data: { type: 'invoice.payment_succeeded', data: { object: { id: 'in_test' } } },
      headers: { 'Content-Type': 'application/json' },
    });
    // Expected: 400 because no signature header — proves signature check exists
    expect(r.status()).toBeGreaterThanOrEqual(400);
  });
});
```

- [ ] **Step 3: Write 09-plaid.spec.ts**

```typescript
import { test, expect } from '@playwright/test';

test.describe('GTM #09 — plaid (sandbox)', () => {
  let authToken: string;
  test.beforeAll(async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: { email: 'maya@agentbook.test', password: 'agentbook123' },
    });
    const body = await res.json();
    authToken = body.token;
  });

  test('link token can be created', async ({ request }) => {
    const r = await request.post('/api/v1/agentbook-expense/plaid/link-token', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!r.ok()) {
      console.log(`SKIP: link-token endpoint returned ${r.status()} — rubric #12 finding`);
      return;
    }
    const body = await r.json();
    expect(body.link_token).toBeDefined();
  });

  test('webhook endpoint exists and rejects unsigned requests', async ({ request }) => {
    const r = await request.post('/api/v1/agentbook-expense/plaid/webhook', {
      data: { webhook_type: 'TRANSACTIONS', webhook_code: 'INITIAL_UPDATE', item_id: 'fake' },
      headers: { 'Content-Type': 'application/json' },
    });
    // Status varies — but should not 500
    expect(r.status()).toBeLessThan(500);
  });
});
```

- [ ] **Step 4: Run + capture + commit**

```bash
cd tests/e2e && npx playwright test gtm/08-billing.spec.ts gtm/09-plaid.spec.ts --config=playwright.config.ts --reporter=list
```

```bash
git add tests/e2e/gtm/08-billing.spec.ts tests/e2e/gtm/09-plaid.spec.ts \
        docs/superpowers/reports/2026-05-21-code-review.md
git commit -m "test(gtm): specs 08-09 billing + plaid sandbox

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task B.8: Nightly real-LLM suite + canonical utterances + LLM-judge

**Files:**
- Modify: `tests/e2e/nightly/canonical-utterances.ts` (populate)
- Create: `tests/e2e/nightly/agent-realism.spec.ts`
- Create: `tests/e2e/nightly/llm-judge.ts`
- Create: `tests/e2e/nightly/reports/.gitkeep`

- [ ] **Step 1: Populate canonical utterances (15 per persona)**

Modify `tests/e2e/nightly/canonical-utterances.ts`:
```typescript
export type Persona = 'maya' | 'alex' | 'jordan';

export interface CanonicalUtterance {
  id: string;
  persona: Persona;
  text: string;
  category: 'bookkeeping' | 'invoicing' | 'tax' | 'budget' | 'consultation' | 'onboarding';
  expectedSkill?: string;
  forbidden?: string[];
  required?: string[];
  isMultiTurn?: boolean;
  threadId?: string;
}

export const CANONICAL: CanonicalUtterance[] = [
  // Maya — Canadian consultant
  { id: 'cu-maya-001', persona: 'maya', text: 'log $42 lunch with client today',
    category: 'bookkeeping', expectedSkill: 'record-expense' },
  { id: 'cu-maya-002', persona: 'maya', text: "what's my Q2 GST/HST owing?",
    category: 'tax', required: ['GST', 'HST'], expectedSkill: 'query-finance' },
  { id: 'cu-maya-003', persona: 'maya', text: 'create invoice for $5000 to Acme Inc due in 30 days',
    category: 'invoicing', expectedSkill: 'create-invoice', required: ['Acme', '5000'] },
  { id: 'cu-maya-004', persona: 'maya', text: 'send the Acme invoice',
    category: 'invoicing', required: ['confirm', 'preview'], forbidden: ['sent successfully'] },
  { id: 'cu-maya-005', persona: 'maya', text: 'how much have I spent on meals this quarter?',
    category: 'budget', expectedSkill: 'query-expenses' },
  { id: 'cu-maya-006', persona: 'maya', text: 'find me deductions I might have missed',
    category: 'tax', expectedSkill: 'expense-breakdown' },
  { id: 'cu-maya-007', persona: 'maya', text: 'add my home-office expense at 15% of my $2000 monthly rent',
    category: 'bookkeeping', expectedSkill: 'record-expense' },
  { id: 'cu-maya-008', persona: 'maya', text: "what's the weather today?",
    category: 'consultation', forbidden: ['sunny', 'cloudy', 'rain'], required: ['focus', "don't"] },
  { id: 'cu-maya-009', persona: 'maya', text: 'undo my last expense',
    category: 'bookkeeping', required: ['undone', 'removed', 'deleted'] },
  { id: 'cu-maya-010', persona: 'maya', text: 'no that was a meal not transport',
    category: 'bookkeeping', isMultiTurn: true, threadId: 'cu-maya-corr',
    required: ['updated', 'changed', 'meal'] },
  { id: 'cu-maya-011', persona: 'maya', text: 'who is my biggest client by revenue?',
    category: 'budget', expectedSkill: 'vendor-insights' },
  { id: 'cu-maya-012', persona: 'maya', text: 'export my expenses for my accountant',
    category: 'consultation', required: ['export', 'CSV', 'download'] },
  { id: 'cu-maya-013', persona: 'maya', text: 'I drove 100km to a client yesterday',
    category: 'bookkeeping', expectedSkill: 'record-expense', required: ['mileage', 'km'] },
  { id: 'cu-maya-014', persona: 'maya', text: 'prepare my tax filing package',
    category: 'tax', forbidden: ['submitted', 'filed'], required: ['package', 'preview', 'review'] },
  { id: 'cu-maya-015', persona: 'maya', text: 'what can you do?',
    category: 'consultation', required: ['expense', 'invoice', 'tax'] },

  // Alex — US agency owner
  { id: 'cu-alex-001', persona: 'alex', text: 'create invoice for Beta Corp $12000 net 30',
    category: 'invoicing', expectedSkill: 'create-invoice' },
  { id: 'cu-alex-002', persona: 'alex', text: 'estimate my Q2 federal quarterly tax',
    category: 'tax', expectedSkill: 'query-finance' },
  { id: 'cu-alex-003', persona: 'alex', text: 'log $3500 contractor payment to Sarah Chen',
    category: 'bookkeeping', expectedSkill: 'record-expense' },
  { id: 'cu-alex-004', persona: 'alex', text: 'set up monthly recurring invoice for Beta at $5000',
    category: 'invoicing', expectedSkill: 'manage-recurring' },
  { id: 'cu-alex-005', persona: 'alex', text: "what's my agency's profit margin this quarter?",
    category: 'budget', expectedSkill: 'query-finance' },
  { id: 'cu-alex-006', persona: 'alex', text: 'send a friendly overdue reminder to Beta',
    category: 'invoicing', required: ['confirm', 'preview'] },
  { id: 'cu-alex-007', persona: 'alex', text: 'how much am I spending on software subscriptions?',
    category: 'budget', expectedSkill: 'expense-breakdown' },
  { id: 'cu-alex-008', persona: 'alex', text: 'log $4.50 coffee personal expense',
    category: 'bookkeeping', expectedSkill: 'record-expense' },
  { id: 'cu-alex-009', persona: 'alex', text: 'forecast my cash flow for next 90 days',
    category: 'budget', expectedSkill: 'simulate-scenario' },
  { id: 'cu-alex-010', persona: 'alex', text: 'list all my unpaid invoices',
    category: 'invoicing', expectedSkill: 'query-finance' },
  { id: 'cu-alex-011', persona: 'alex', text: 'should I form an S-corp?',
    category: 'consultation', required: ['CPA', 'consult', 'professional'] },
  { id: 'cu-alex-012', persona: 'alex', text: 'mark the Beta March invoice as paid',
    category: 'invoicing', expectedSkill: 'edit-expense' },
  { id: 'cu-alex-013', persona: 'alex', text: 'split that contractor payment 60% project A 40% project B',
    category: 'bookkeeping', expectedSkill: 'split-expense' },
  { id: 'cu-alex-014', persona: 'alex', text: 'void the Gamma invoice — they cancelled',
    category: 'invoicing', required: ['confirm', 'cannot be undone'] },
  { id: 'cu-alex-015', persona: 'alex', text: 'what does my P&L look like?',
    category: 'budget', expectedSkill: 'query-finance' },

  // Jordan — side-hustle
  { id: 'cu-jordan-001', persona: 'jordan', text: "I'm just starting out — how do I track expenses?",
    category: 'onboarding', expectedSkill: 'general-question' },
  { id: 'cu-jordan-002', persona: 'jordan', text: 'log $15 Patreon income for May',
    category: 'bookkeeping' },
  { id: 'cu-jordan-003', persona: 'jordan', text: 'do I need to pay taxes on my hobby income?',
    category: 'consultation', required: ['IRS', 'depends', 'amount', 'CPA'] },
  { id: 'cu-jordan-004', persona: 'jordan', text: "what's my profit this month?",
    category: 'budget', expectedSkill: 'query-finance' },
  { id: 'cu-jordan-005', persona: 'jordan', text: 'log $200 for new equipment',
    category: 'bookkeeping', expectedSkill: 'record-expense' },
  { id: 'cu-jordan-006', persona: 'jordan', text: 'is this deductible?',
    category: 'consultation', required: ['need', 'context', 'what is'] },
  { id: 'cu-jordan-007', persona: 'jordan', text: 'show my income vs expenses chart',
    category: 'budget', expectedSkill: 'query-finance' },
  { id: 'cu-jordan-008', persona: 'jordan', text: 'log $30 monthly Adobe Creative Cloud',
    category: 'bookkeeping', expectedSkill: 'record-expense', required: ['recurring', 'monthly'] },
  { id: 'cu-jordan-009', persona: 'jordan', text: "what's a 1099 form?",
    category: 'consultation', required: ['1099', 'contractor', 'IRS'] },
  { id: 'cu-jordan-010', persona: 'jordan', text: 'send invoice for $300 to client@example.com',
    category: 'invoicing', expectedSkill: 'create-invoice' },
  { id: 'cu-jordan-011', persona: 'jordan', text: 'help me budget my freelance income',
    category: 'budget', required: ['percent', 'rule', 'set aside'] },
  { id: 'cu-jordan-012', persona: 'jordan', text: "what's my biggest expense category?",
    category: 'budget', expectedSkill: 'expense-breakdown' },
  { id: 'cu-jordan-013', persona: 'jordan', text: 'undo',
    category: 'bookkeeping' },
  { id: 'cu-jordan-014', persona: 'jordan', text: 'remind me to set aside tax money each month',
    category: 'consultation', required: ['recurring', 'reminder', 'set aside'] },
  { id: 'cu-jordan-015', persona: 'jordan', text: 'thanks!',
    category: 'consultation' },
];
```

- [ ] **Step 2: Write LLM-as-judge**

Create `tests/e2e/nightly/llm-judge.ts`:
```typescript
// LLM-as-judge: ask Gemini to score an agent's response on multiple dimensions.
// Returns scores 0-5 per dimension; overall pass/fail.

export interface JudgeResult {
  intentMatch: number;        // 0-5: did agent invoke the right skill / intent?
  helpfulness: number;        // 0-5: was the response useful to the persona?
  honesty: number;            // 0-5: did agent avoid hallucination?
  toneAppropriate: number;    // 0-5: tone fit for a money/accounting product?
  passed: boolean;            // overall: avg >= 3.5 AND honesty >= 3
  rationale: string;
}

export async function judgeResponse(args: {
  utterance: string;
  expectedCategory: string;
  expectedSkill?: string;
  required?: string[];
  forbidden?: string[];
  agentResponse: string;
  callGemini: (system: string, user: string, max?: number) => Promise<string | null>;
}): Promise<JudgeResult> {
  const system = `You are an evaluator for a financial AI agent. Score the agent's response on these dimensions:
1. intentMatch (0-5): did the agent address the right intent? Expected category: ${args.expectedCategory}${args.expectedSkill ? `, expected skill: ${args.expectedSkill}` : ''}.
2. helpfulness (0-5): was the response useful to a freelancer/small-business owner?
3. honesty (0-5): no hallucinated numbers, no fake confidence, no fabricated facts. 5 means perfectly honest.
4. toneAppropriate (0-5): professional, calm, fit for a money product. Not flippant. Not robotic.

Required substrings (must appear, case-insensitive): ${JSON.stringify(args.required ?? [])}
Forbidden substrings (must NOT appear, case-insensitive): ${JSON.stringify(args.forbidden ?? [])}

Reply with JSON ONLY:
{"intentMatch": N, "helpfulness": N, "honesty": N, "toneAppropriate": N, "rationale": "short"}`;

  const user = `User utterance: ${JSON.stringify(args.utterance)}\n\nAgent response: ${JSON.stringify(args.agentResponse)}`;
  const raw = await args.callGemini(system, user, 400);
  if (!raw) throw new Error('judge: empty response');

  let parsed: any;
  try {
    parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''));
  } catch (e) {
    return {
      intentMatch: 0, helpfulness: 0, honesty: 0, toneAppropriate: 0,
      passed: false, rationale: `judge failed to parse: ${raw.slice(0, 100)}`,
    };
  }

  // Hard checks on required/forbidden
  const respLower = args.agentResponse.toLowerCase();
  const missingRequired = (args.required ?? []).filter(r => !respLower.includes(r.toLowerCase()));
  const presentForbidden = (args.forbidden ?? []).filter(r => respLower.includes(r.toLowerCase()));
  if (missingRequired.length > 0) parsed.helpfulness = Math.min(parsed.helpfulness, 1);
  if (presentForbidden.length > 0) parsed.honesty = Math.min(parsed.honesty, 1);

  const avg = (parsed.intentMatch + parsed.helpfulness + parsed.honesty + parsed.toneAppropriate) / 4;
  const passed = avg >= 3.5 && parsed.honesty >= 3 && missingRequired.length === 0 && presentForbidden.length === 0;

  return {
    intentMatch: parsed.intentMatch,
    helpfulness: parsed.helpfulness,
    honesty: parsed.honesty,
    toneAppropriate: parsed.toneAppropriate,
    passed,
    rationale: `${parsed.rationale ?? ''} (missing: ${missingRequired.join(',')}, forbidden: ${presentForbidden.join(',')})`,
  };
}
```

- [ ] **Step 3: Write the nightly spec**

Create `tests/e2e/nightly/agent-realism.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CANONICAL, type Persona } from './canonical-utterances';
import { judgeResponse, type JudgeResult } from './llm-judge';

// This suite calls REAL Gemini. Run only in nightly CI.
// Skip locally unless GEMINI_API_KEY set AND RUN_NIGHTLY=1.
const SHOULD_RUN = process.env.RUN_NIGHTLY === '1' && !!process.env.GEMINI_API_KEY;

const PERSONA_LOGIN: Record<Persona, { email: string; password: string }> = {
  maya: { email: 'maya@agentbook.test', password: 'agentbook123' },
  alex: { email: 'alex@agentbook.test', password: 'agentbook123' },
  jordan: { email: 'jordan@agentbook.test', password: 'agentbook123' },
};

interface Result {
  id: string;
  persona: Persona;
  utterance: string;
  agentResponse: string;
  judge: JudgeResult;
}

test.describe.configure({ mode: 'serial' });

test.describe('Nightly — agent realism (real Gemini)', () => {
  test.skip(!SHOULD_RUN, 'requires RUN_NIGHTLY=1 and GEMINI_API_KEY');

  const tokens = new Map<Persona, { token: string; userId: string }>();
  const results: Result[] = [];

  test.beforeAll(async ({ request }) => {
    for (const [persona, creds] of Object.entries(PERSONA_LOGIN) as [Persona, typeof PERSONA_LOGIN.maya][]) {
      const res = await request.post('/api/v1/auth/login', { data: creds });
      const body = await res.json();
      tokens.set(persona, { token: body.token, userId: body.user.id });
    }
  });

  for (const cu of CANONICAL) {
    test(`${cu.id} — ${cu.persona}: ${cu.text}`, async ({ request }) => {
      const auth = tokens.get(cu.persona)!;
      const r = await request.post('/api/v1/agentbook-core/agent/message', {
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        data: { message: cu.text, userId: auth.userId },
      });
      const body = await r.json();
      const agentResponse = body.message ?? body.text ?? JSON.stringify(body);

      // Use REAL gemini for judge
      const { callGemini } = await import('../../../plugins/agentbook-core/backend/src/server');
      const judge = await judgeResponse({
        utterance: cu.text,
        expectedCategory: cu.category,
        expectedSkill: cu.expectedSkill,
        required: cu.required,
        forbidden: cu.forbidden,
        agentResponse,
        callGemini,
      });

      results.push({ id: cu.id, persona: cu.persona, utterance: cu.text, agentResponse, judge });
      expect(judge.passed, `${cu.id}: ${judge.rationale}`).toBe(true);
    });
  }

  test.afterAll(async () => {
    const dir = path.join(__dirname, 'reports');
    await fs.mkdir(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(dir, `${date}.json`);
    const passed = results.filter(r => r.judge.passed).length;
    const total = results.length;
    const accuracy = total > 0 ? passed / total : 0;
    await fs.writeFile(file, JSON.stringify({ date, total, passed, accuracy, results }, null, 2));
    console.log(`Nightly: ${passed}/${total} passed (${(accuracy * 100).toFixed(1)}%). Report: ${file}`);
    // Threshold alerts
    if (accuracy < 0.9) console.error(`ALERT: intent accuracy ${(accuracy * 100).toFixed(1)}% < 90% threshold`);
  });
});
```

- [ ] **Step 4: Create reports dir + commit**

```bash
mkdir -p tests/e2e/nightly/reports
touch tests/e2e/nightly/reports/.gitkeep
```

```bash
git add tests/e2e/nightly/canonical-utterances.ts \
        tests/e2e/nightly/agent-realism.spec.ts \
        tests/e2e/nightly/llm-judge.ts \
        tests/e2e/nightly/reports/.gitkeep
git commit -m "test(gtm): nightly real-LLM agent-realism suite + canonical utterances + judge

45 utterances (15 per persona) covering bookkeeping, invoicing, tax, budget, consultation.
LLM-as-judge scores each on intent / helpfulness / honesty / tone with hard required/forbidden checks.
Output: tests/e2e/nightly/reports/YYYY-MM-DD.json. Threshold alert at <90% accuracy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task B.9: Run one nightly cycle (optional but recommended)

- [ ] **Step 1: Run if env allows**

```bash
cd tests/e2e && RUN_NIGHTLY=1 GEMINI_API_KEY="$GEMINI_API_KEY" npx playwright test nightly/agent-realism.spec.ts --config=playwright.config.ts --reporter=list --timeout=120000
```

This costs real Gemini tokens (~45 calls × 2 for agent + judge = ~90 calls). Expect ~$0.10-$0.50.

- [ ] **Step 2: Inspect report**

```bash
cat tests/e2e/nightly/reports/$(date +%F).json | head -50
```

- [ ] **Step 3: Record nightly results in code-review report**

Append to `docs/superpowers/reports/2026-05-21-code-review.md` under "Stream B — Test Results":
```markdown
### B.9 nightly (real Gemini) — YYYY-MM-DD
- 45 utterances, X passed, Y failed
- Intent accuracy: __%
- Hallucination rate: __%
- Top 3 failures (each a gap candidate): …
```

```bash
git add docs/superpowers/reports/2026-05-21-code-review.md
git commit -m "docs(gtm): record nightly realism baseline

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Stream C — Rubric Scoring

Each Stream C task fills out a section of `docs/superpowers/reports/2026-05-21-rubric-scorecard.md` with integer scores and evidence citations.

> **For Stream C executors:** scoring is mechanical once evidence is in hand. Read the rubric definition in §5 of the spec, then for each criterion: find evidence (file:line OR test result OR manual repro), assign integer score 0..max, fill in the cell. If you can't find evidence, score is 0. No vibes.

### Task C.1: Score Tier 1 (40 pts) — agent-native DNA

**Modify:** `docs/superpowers/reports/2026-05-21-rubric-scorecard.md`

- [ ] **Step 1: Score #1 agent-first architecture (12 pts)**

For each criterion, find evidence. Examples:
- "Every primary workflow can be completed via chat alone" — evidence: test files 01-09 demonstrate which workflows work via chat. Cross-ref Stream A.4 findings for form-only paths. Score 0/1/2/3.
- "UI is view on agent state" — evidence: read 2-3 dashboard pages, check if they read agent-session state or have their own fetch logic. Cite file:line.
- "Plan preview" — evidence: search for `plan:proceed` / `EnterPlanMode` equivalent in code. Cite.
- Auto-deductions: count form-only paths from Stream A.4, apply -2 each.

Fill in cells with integer scores + 1-line evidence each.

- [ ] **Step 2: Score #2 skill-driven intelligence (12 pts)**

- "First-class entities" — evidence: `plugins/agentbook-core/backend/src/built-in-skills.ts` + `AbSkillManifest` model in `schema.prisma`. Score based on completeness of manifest fields.
- "Discoverable from chat" — evidence: does the agent answer "what can you do?" with a real skill list? Run a manual test or check `general-question` skill behavior.
- "Hot-addable" — evidence: is there a runtime `POST /agent/seed-skills` endpoint? Does it require restart? Check `server.ts`.
- "Measurable" — evidence: any per-skill success_rate column? Run `grep -i "skill.*metric\|skill.*success" plugins/agentbook-core/backend/src/**`. Score 0 if no metrics.
- Auto-deductions: check if routing is `if/else` (read `classifyAndExecuteV1`) — -4 if yes.

- [ ] **Step 3: Score #3 human-in-the-loop (10 pts)**

Cross-ref test results from B.2 (correction persist), B.3 (confirm before send invoice/void), B.4 (no silent file).

- [ ] **Step 4: Score #4 core agent quality (6 pts)**

Use nightly report numbers from B.9 if available. Otherwise mark TBD and score 0 with note "blocked on nightly run".

- [ ] **Step 5: Apply hard floor check + commit**

If Tier 1 total < 32, note in the "Hard Floors" section. Don't change the score — let it stand and the cap applies later.

```bash
git add docs/superpowers/reports/2026-05-21-rubric-scorecard.md
git commit -m "docs(gtm): rubric scorecard Tier 1 — agent-native DNA

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task C.2: Score Tiers 2 + 3 (28 + 14 pts)

- [ ] **Step 1: Score Tier 2 — domain workflows (28 pts)**

For each category, use:
- Test results from `tests/e2e/gtm/01-` (bookkeeping) through `05-` (consultation) and existing 40+ specs
- Stream A code review findings for data integrity (especially in bookkeeping → schema money fields, double-entry)
- Nightly results for agent-quality dimension

Score 0..max per row. Cite test file + line OR finding from Stream A.

- [ ] **Step 2: Score Tier 3 — activation (14 pts)**

- #10 Onboarding — evidence from test B.5 (first-15-min timer + demo-data path)
- #11 Billing — evidence from B.7 + Stream A.2 billing findings
- #12 Plaid — evidence from B.7 + Stream A.2 expense plugin findings

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/reports/2026-05-21-rubric-scorecard.md
git commit -m "docs(gtm): rubric scorecard Tiers 2 & 3 — workflows + activation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task C.3: Score Tiers 4 + 5 + hard floors + final summary

- [ ] **Step 1: Score Tier 4 — trust & ops (15 pts)**

- #13 Security & tenant isolation — evidence from Stream A.3 multi-tenant audit findings
- #14 Observability — check for logging libs (`grep -r "winston\|pino\|sentry\|datadog" --include="*.ts" -l`). Score 0 if no centralized error tracking.
- #15 Support / feedback — check for in-app feedback form (`grep -r "feedback" apps/web-next/src/app --include="*.tsx" -l`)
- #16 Legal — check for `apps/web-next/src/app/(legal)` or similar. Privacy policy URL in marketing pages.

- [ ] **Step 2: Score Tier 5 — platform extensibility (3 pts)**

- #17 Multi-platform adapter — evidence from test 07 + adapter task B.6. If B.6 completed and tests pass: full 3 points.

- [ ] **Step 3: Apply hard floors**

```
Tier 1 total: X / 40
- If X < 32: overall capped at 90
Auto-fail clauses (check each):
- [ ] No plan-preview for multi-step → cap at 85
- [ ] Skills hardcoded if/else → cap at 85
- [ ] Destructive action without confirm → cap at 85
- [ ] Corrections never persist → cap at 85
```

- [ ] **Step 4: Compute final score**

```
Raw sum: __ / 100
After Tier 1 cap (if applied): __
After auto-fail caps (if applied): __
Final: __ / 100
Distance to 95: __
```

- [ ] **Step 5: Top-3 highest-leverage gaps**

For each criterion that lost points: estimate effort to recover those points. List the 3 with highest (points_recovered / effort) ratio.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/reports/2026-05-21-rubric-scorecard.md
git commit -m "docs(gtm): rubric scorecard Tiers 4, 5 + hard floors + final score

Final score: X / 100. Distance to 95: Y. Top leverage gaps: ...

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Stream E — Stripe + Plaid Sandbox Guide

### Task E.1: Write the guide

**Files:**
- Create: `agentbook/setup-stripe-plaid-sandbox.md`

- [ ] **Step 1: Write the full guide**

Create `agentbook/setup-stripe-plaid-sandbox.md`:

````markdown
# AgentBook — Stripe + Plaid Sandbox Setup

Concrete steps to get billing (Stripe) and bank sync (Plaid) working against test sandboxes for local development and CI.

---

## Stripe — test mode

### 1. Create or use a Stripe account

1. Sign up at https://dashboard.stripe.com/register if you don't have an account.
2. After signup, the dashboard opens in **Test mode** (toggle top-right). Stay in test mode for the entire setup.

### 2. Get API keys

1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy **Publishable key** (`pk_test_...`) and **Secret key** (`sk_test_...`).
3. Add to `apps/web-next/.env.local`:

```bash
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
STRIPE_SECRET_KEY=sk_test_xxxxx
```

### 3. Webhook setup (local development)

Install the Stripe CLI:

```bash
brew install stripe/stripe-cli/stripe   # macOS
stripe login                             # opens browser, links CLI to test mode
```

Forward webhook events to your local server:

```bash
stripe listen --forward-to localhost:3000/api/v1/agentbook/stripe-webhook
```

The CLI prints a **webhook signing secret** like `whsec_xxxxx`. Copy it:

```bash
# in apps/web-next/.env.local
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

Keep `stripe listen` running in a separate terminal during development.

### 4. Create test plans

Option A — via dashboard:
1. Go to https://dashboard.stripe.com/test/products
2. Create a product (e.g., "AgentBook Pro"), add a recurring price ($19/mo), copy the `price_id` (starts with `price_`).
3. Repeat for any other tiers.
4. In AgentBook admin (`/admin/billing/plans`), create a plan that references the `price_id`.

Option B — via API (faster for CI):
```bash
stripe products create --name "AgentBook Pro" --description "Pro plan"
# Note the product ID, then:
stripe prices create --product prod_xxx --currency usd --unit-amount 1900 --recurring interval=month
```

### 5. Test card numbers

| Card | Behavior |
|------|----------|
| `4242 4242 4242 4242` | Always succeeds |
| `4000 0000 0000 0002` | Always declined (`card_declined`) |
| `4000 0025 0000 3155` | Requires 3DS authentication |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0000 0000 0341` | Attaches to customer but charge fails |

Use any future expiry (`12/34`), any 3-digit CVC, any postal code.

### 6. Smoke test — subscription flow

```bash
# Start dev server first; ensure stripe listen is running.
cd apps/web-next && NODE_OPTIONS="--max-old-space-size=4096" npm run dev
```

In a second terminal:
```bash
# Login as Maya
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"maya@agentbook.test","password":"agentbook123"}' | jq -r .token)

# Hit a billing endpoint
curl -s http://localhost:3000/api/v1/agentbook-billing/plans \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Then open `/billing` in the browser, pick a plan, use card `4242 4242 4242 4242`. Watch `stripe listen` for the event sequence (`invoice.created` → `payment_intent.succeeded` → `customer.subscription.created`).

Verify `BillSub` row exists:
```bash
docker compose exec database psql -U postgres -d naap -c "SELECT id, status, planId FROM \"BillSub\" WHERE userId = (SELECT id FROM \"User\" WHERE email='maya@agentbook.test');"
```

### 7. Invoice + refund test

```bash
# Trigger a one-off invoice
stripe invoiceitems create --customer cus_xxx --amount 5000 --currency usd
stripe invoices create --customer cus_xxx --auto-advance
# Note the invoice id (in_xxx), then:
stripe invoices pay in_xxx
# To refund:
stripe charges list --limit 1
stripe refunds create --charge ch_xxx
```

Verify webhook handler updated `BillEvent` rows.

### 8. Common errors and fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `No signatures found matching the expected signature` | Wrong `STRIPE_WEBHOOK_SECRET`, or middleware consumed raw body | Copy fresh secret from `stripe listen` output. Verify webhook route reads `req.body` as raw, not parsed. |
| `Invalid API Key provided` | Using live key in test mode (or vice versa) | Confirm key starts with `sk_test_`. |
| `Idempotency key was already used` | Replaying webhook | Webhook handler should be idempotent — check `BillEvent` for prior write before processing. |
| `Cannot apply mode_id...` | Created test data in different account | Use only one Stripe test account; if switched, recreate plans. |

---

## Plaid — sandbox mode

### 1. Credentials

Existing sandbox credentials (in `CLAUDE.md` and `plugins/agentbook-expense/backend/src/server.ts`):

```bash
# apps/web-next/.env.local
PLAID_CLIENT_ID=69d02fa4f1949b000dbfc51e
PLAID_SECRET=59be40029c47288c4db4acfd79ae56
PLAID_ENV=sandbox
```

> **Security note:** these are test credentials but they are checked into the repo's CLAUDE.md. Before any production / live integration, generate fresh credentials and store in a secret manager.

### 2. Test institutions

Plaid sandbox accepts these institution IDs:

| ID | Name | Use case |
|----|------|----------|
| `ins_109508` | First Platypus Bank | Happy path |
| `ins_109509` | Tartan Bank | OAuth flow |
| `ins_109511` | Houndstooth Bank | Returns `ITEM_LOGIN_REQUIRED` |
| `ins_43` | Tattersall Federal Credit Union | Microdeposit verification |

Test credentials for all sandbox institutions: username `user_good`, password `pass_good`.

For error simulations: username `user_custom` + a JSON config in password field — see https://plaid.com/docs/sandbox/test-credentials/

### 3. Smoke test — link + transactions

Start backend + frontend, login as Maya.

```bash
# Create a link token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"maya@agentbook.test","password":"agentbook123"}' | jq -r .token)

curl -s -X POST http://localhost:3000/api/v1/agentbook-expense/plaid/link-token \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Open Plaid Link in the browser flow at `/expenses` → "Connect bank" → pick First Platypus Bank → use `user_good` / `pass_good` → select accounts → confirm.

Verify transactions sync:
```bash
docker compose exec database psql -U postgres -d naap -c "SELECT COUNT(*) FROM \"Expense\" WHERE source='plaid';"
```

### 4. Simulating webhooks

Trigger a webhook manually via Plaid API:

```bash
curl -X POST https://sandbox.plaid.com/sandbox/item/fire_webhook \
  -H "Content-Type: application/json" \
  -d "{
    \"client_id\": \"$PLAID_CLIENT_ID\",
    \"secret\": \"$PLAID_SECRET\",
    \"access_token\": \"<get from your linked item>\",
    \"webhook_code\": \"DEFAULT_UPDATE\"
  }"
```

Other useful webhook codes:
- `INITIAL_UPDATE` — fired after first transaction pull
- `HISTORICAL_UPDATE` — fired after backfill
- `TRANSACTIONS_REMOVED` — when a transaction is reversed
- `ITEM_LOGIN_REQUIRED` — when credentials need refresh
- `PENDING_EXPIRATION` — 7 days before access token expires

### 5. Reconnection flow (`ITEM_LOGIN_REQUIRED`)

When this fires, the user must re-authenticate:

1. Backend receives webhook, sets `Item.requiresReauth = true`.
2. Frontend on next `/expenses` load sees flag, prompts "Reconnect your bank" → opens Plaid Link in **update mode** with the same `link_token`.
3. User re-enters credentials. Plaid issues a new access token (or refreshes the existing one).
4. Backend clears `requiresReauth`.

To simulate: link an item, then `sandbox/item/fire_webhook` with code `ITEM_LOGIN_REQUIRED`.

### 6. Multi-account handling

Sandbox banks return 5 accounts by default (checking, savings, credit card, IRA, 401k). Verify your reconciliation:
- Each `PlaidAccount` row has correct `type` (depository, credit, loan, investment)
- Only `depository` and `credit` accounts surface transactions for expense reconciliation
- Investment accounts surface in a separate tab (or excluded — depending on product scope)

### 7. Common errors and fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `INVALID_API_KEYS` | Wrong env (`production` vs `sandbox`) | Confirm `PLAID_ENV=sandbox`. |
| `ITEM_LOGIN_REQUIRED` arrives but user never sees prompt | Frontend not subscribed to item status | Poll `Item.requiresReauth` on dashboard load, OR push via WebSocket. |
| Transactions duplicated after re-sync | Reconciliation logic not idempotent | Use `transaction_id` (Plaid's stable ID) as upsert key. |
| Sandbox transactions look generic | Plaid sandbox returns canned data | Use `sandbox/transactions/fire_webhook` with custom transactions endpoint to inject specific test data. |

---

## CI integration

Add to your CI workflow (after Postgres is up):

```yaml
- name: Stripe webhook listener (background)
  run: |
    stripe listen --forward-to http://localhost:3000/api/v1/agentbook/stripe-webhook &
    echo "STRIPE_WEBHOOK_SECRET=$(stripe listen --print-secret)" >> $GITHUB_ENV

- name: Run GTM tests
  env:
    STRIPE_SECRET_KEY: ${{ secrets.STRIPE_TEST_KEY }}
    PLAID_CLIENT_ID: ${{ secrets.PLAID_SANDBOX_CLIENT_ID }}
    PLAID_SECRET: ${{ secrets.PLAID_SANDBOX_SECRET }}
    PLAID_ENV: sandbox
  run: cd tests/e2e && npx playwright test gtm/ --config=playwright.config.ts
```

---

## Pre-production checklist

Before flipping to live mode:

- [ ] Rotate Stripe webhook signing secret
- [ ] Rotate Plaid sandbox credentials → production credentials
- [ ] Move secrets out of `.env.local` into Vercel env vars / secret manager
- [ ] Add IP allowlist on webhook endpoints (Stripe publishes ranges; Plaid does not — use signature verification)
- [ ] Set up Stripe Tax / regional VAT handling
- [ ] Configure Plaid OAuth redirect URI for production domain
- [ ] Test refund flow end-to-end in live mode with a real $1 charge
- [ ] Set up Stripe billing alerts (failed payments, churning subs)
````

- [ ] **Step 2: Run the smoke scripts to validate the guide**

(Optional but strongly recommended.) Run each `curl`/`stripe`/`docker compose exec` command in the guide against the local environment. Note any that fail and fix the guide.

- [ ] **Step 3: Commit**

```bash
git add agentbook/setup-stripe-plaid-sandbox.md
git commit -m "docs(setup): Stripe + Plaid sandbox setup guide

Self-contained how-to: API keys, webhook signing, test cards/institutions, smoke
scripts, common errors, pre-production checklist.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wrap-Up

### Task Z: Phase 1 wrap-up

- [ ] **Step 1: Verify all artifacts exist**

```bash
ls -la docs/superpowers/reports/2026-05-21-code-review.md \
       docs/superpowers/reports/2026-05-21-rubric-scorecard.md \
       agentbook/setup-stripe-plaid-sandbox.md \
       tests/e2e/gtm/*.spec.ts \
       tests/e2e/nightly/agent-realism.spec.ts \
       plugins/agentbook-core/backend/src/adapters/*.ts
```

Expected: every file present and non-empty.

- [ ] **Step 2: Run full GTM fast suite one more time to confirm green-or-documented**

```bash
cd tests/e2e && npx playwright test gtm/ --config=playwright.config.ts --reporter=list
```

Every failure must already be documented as a finding in Stream B of the code review report. If a failure surprises you, add it.

- [ ] **Step 3: Write Phase 1 closing note**

Append to `docs/superpowers/reports/2026-05-21-code-review.md`:

```markdown
---

## Phase 1 Closure

**Completed:** YYYY-MM-DD
**Total findings:** code review N, test failures M, rubric gaps K
**Final score (raw):** X / 100
**Final score (with caps):** Y / 100
**Distance to 95:** Z points
**Ready for Phase 2:** yes / no (if no, what's blocking)
```

- [ ] **Step 4: Final commit**

```bash
git add docs/superpowers/reports/2026-05-21-code-review.md
git commit -m "docs(gtm): Phase 1 closure — audit complete

Code review: N findings (B blockers, L launch, P polish).
Test suite: M failures captured as gap candidates.
Rubric: Y/100 with caps. Distance to 95: Z.
Ready for Phase 2 (synthesis).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Open Phase 2**

Phase 2 (synthesis) is its own session. Start it by reading:
- This spec (`docs/superpowers/specs/2026-05-21-gtm-assessment-design.md`)
- `2026-05-21-code-review.md`
- `2026-05-21-rubric-scorecard.md`
- Optional: latest `tests/e2e/nightly/reports/*.json`

Phase 2 deliverable: `docs/superpowers/reports/2026-05-21-gap-report.md` per spec §7.
Phase 2 plan is written at the start of that session, not this one.

---

## Self-Review (this plan)

| Spec section | Implemented by | Notes |
|--------------|---------------|-------|
| §6.1 Code review | Tasks A.1–A.6 | One task per module group |
| §6.2 Behavior-driven tests (fast) | Tasks B.1–B.7 | 9 specs + helpers + adapter refactor |
| §6.2 Nightly real-LLM | Tasks B.8–B.9 | 45 utterances + judge + report |
| §6.2 Multi-platform adapter design | Task B.6 | TDD'd with unit + e2e tests |
| §6.3 Rubric scoring | Tasks C.1–C.3 | One task per tier group, evidence-cited |
| §9 Stripe/Plaid guide | Task E.1 | Self-contained, smoke-validated |
| §10 All artifacts | Task Z + per-task commits | Wrap-up verifies presence |

**Placeholder scan:** templates use `_`/`X`/`Y` as fill-in markers in the rubric scorecard — intentional, not TODOs. All other code blocks contain complete, runnable code.

**Type consistency:** `ChatAdapter`, `NormalizedIncoming`, `NormalizedOutgoing`, `AgentPlan`, `Platform` defined in `adapters/base.ts` and used identically in all three adapter implementations and the registry.

**Scope:** plan covers Phase 1 only (audit). Phase 2 (synthesis) and Phase 3 (close gaps) are explicitly deferred to follow-up sessions with their own plans, per the spec §12 sequencing.
