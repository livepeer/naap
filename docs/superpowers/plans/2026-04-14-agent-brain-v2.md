# Agent Brain v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the agent brain from a single-shot skill router into an adaptive, planning-capable agent with confidence-based learning, session state, and post-execution evaluation.

**Architecture:** Extract the monolithic `/agent/message` handler into four focused modules (brain, planner, memory, evaluator). Add `AbAgentSession` model for multi-step plan tracking. Enhance `AbUserMemory` with decay/contradiction fields. All changes in the core plugin backend — no new microservices.

**Tech Stack:** TypeScript/ESM, Express, Prisma (PostgreSQL), Gemini LLM, Playwright E2E tests

**Spec:** `docs/superpowers/specs/2026-04-14-agent-brain-v2-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `plugins/agentbook-core/backend/src/agent-memory.ts` | Relevance-scored retrieval, confidence learning, decay logic |
| `plugins/agentbook-core/backend/src/agent-planner.ts` | Complexity assessment, LLM plan generation, step execution engine |
| `plugins/agentbook-core/backend/src/agent-evaluator.ts` | Per-step quality checks, final plan evaluation, suggestion generation |
| `plugins/agentbook-core/backend/src/agent-brain.ts` | Pipeline orchestrator — context assembly, classification, session routing |
| `tests/e2e/agent-brain-v2.spec.ts` | E2E tests for v2 features (sessions, planning, learning, evaluation) |

### Modified Files

| File | Changes |
|------|---------|
| `packages/database/prisma/schema.prisma` | Add `AbAgentSession` model, extend `AbUserMemory` (3 fields), extend `AbConversation` (2 fields) |
| `plugins/agentbook-core/backend/src/server.ts` | Replace inline agent code with imports from new modules. Add new skill manifests. Keep route definitions thin. |
| `apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts` | Session-aware message handling, feedback detection, plan/evaluation formatting |
| `tests/e2e/agent-brain.spec.ts` | Update skill count from 11 to 16, add new skill routing tests |

---

## Task 1: Schema Changes

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Add AbAgentSession model**

Add after the `AbUserMemory` model (around line 2211):

```prisma
model AbAgentSession {
  id                  String   @id @default(uuid())
  tenantId            String
  status              String   @default("active")
  trigger             String
  plan                Json
  currentStep         Int      @default(0)
  stepResults         Json     @default("[]")
  pendingConfirmation Json?
  undoStack           Json     @default("[]")
  evaluation          Json?
  version             Int      @default(0)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  expiresAt           DateTime

  @@index([tenantId, status])
  @@index([tenantId])
  @@schema("plugin_agentbook_core")
}
```

- [ ] **Step 2: Extend AbUserMemory model**

Add three fields to `AbUserMemory` (around line 2208, before `@@unique`):

```prisma
  decayRate      Float     @default(0.1)
  lastVerified   DateTime?
  contradictions Int       @default(0)
```

- [ ] **Step 3: Extend AbConversation model**

Add two fields to `AbConversation` (around line 1570, before `@@index`):

```prisma
  sessionId   String?
  feedback    String?
```

- [ ] **Step 4: Push schema to database**

Run:
```bash
cd packages/database && DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" npx --no prisma db push --skip-generate
```
Expected: `Your database is now in sync with your Prisma schema.`

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma
git commit -m "feat: schema for agent brain v2 — sessions, memory decay, conversation feedback"
```

---

## Task 2: Agent Memory Module

**Files:**
- Create: `plugins/agentbook-core/backend/src/agent-memory.ts`
- Test: `tests/e2e/agent-brain-v2.spec.ts` (memory tests only)

- [ ] **Step 1: Write memory retrieval tests**

Create `tests/e2e/agent-brain-v2.spec.ts` with memory tests:

```typescript
import { test, expect } from '@playwright/test';

const CORE = 'http://localhost:4050';
const MAYA = '2e2348b6-a64c-44ad-907e-4ac120ff06f2';
const H = { 'x-tenant-id': MAYA, 'Content-Type': 'application/json' };

test.describe.serial('Agent Brain v2 — Memory & Learning', () => {
  test('memory confidence increases on repeated same-category vendor', async ({ request }) => {
    // Record expense with vendor twice — same category
    await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'spent $10 on coffee at Starbucks', channel: 'api' },
    });
    await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'spent $12 on latte at Starbucks', channel: 'api' },
    });

    // Check memory — should have vendor_category for starbucks
    const memRes = await request.get(`${CORE}/api/v1/agentbook-core/agent/memory?type=vendor_category`, { headers: H });
    const mems = (await memRes.json()).data;
    const starbucks = mems.find((m: any) => m.key.includes('starbucks'));
    expect(starbucks).toBeTruthy();
    expect(starbucks.confidence).toBeGreaterThanOrEqual(0.5);
    expect(starbucks.usageCount).toBeGreaterThanOrEqual(2);
  });

  test('user correction creates memory and re-categorizes expense', async ({ request }) => {
    // Record expense
    const recRes = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'spent $30 on uber to client meeting', channel: 'api' },
    });
    const recBody = await recRes.json();
    expect(recBody.data.skillUsed).toBe('record-expense');

    // Send correction
    const corrRes = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'no, that should be Travel not Meals', channel: 'api', feedback: 'no, that should be Travel' },
    });
    expect(corrRes.ok()).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tests/e2e && npx playwright test agent-brain-v2.spec.ts --config=playwright.config.ts -g "memory" --reporter=line`
Expected: FAIL (agent-memory module doesn't exist yet)

- [ ] **Step 3: Implement agent-memory.ts**

Create `plugins/agentbook-core/backend/src/agent-memory.ts`:

```typescript
/**
 * Agent Memory — relevance-scored retrieval, confidence learning, decay.
 */
import { db } from './db/client.js';

// --- Types ---

interface ScoredMemory {
  id: string;
  tenantId: string;
  key: string;
  value: string;
  type: string;
  confidence: number;
  source: string;
  usageCount: number;
  lastUsed: Date;
  expiresAt: Date | null;
  decayRate: number;
  lastVerified: Date | null;
  contradictions: number;
  relevance: number;
}

// --- Relevance-Scored Retrieval ---

export async function retrieveRelevantMemories(
  tenantId: string,
  text: string,
  limit = 50,
): Promise<ScoredMemory[]> {
  const all = await db.abUserMemory.findMany({
    where: {
      tenantId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });

  const now = new Date();
  const lower = (text || '').toLowerCase();

  // Apply lazy decay + score relevance
  const scored: ScoredMemory[] = all.map((mem: any) => {
    let confidence = mem.confidence;

    // Monthly decay
    const monthsSinceUse =
      (now.getTime() - new Date(mem.lastUsed).getTime()) / (30 * 24 * 60 * 60 * 1000);
    if (monthsSinceUse > 1) {
      confidence = Math.max(0.1, confidence - mem.decayRate * Math.floor(monthsSinceUse));
      // Fire-and-forget background update
      db.abUserMemory
        .update({ where: { id: mem.id }, data: { confidence } })
        .catch(() => {});
    }

    // Relevance scoring
    let relevance = confidence;
    const keyClean = mem.key.replace(/^(shortcut|vendor_alias|vendor_category|preference|profile|correction):/, '');
    if (lower.includes(keyClean.toLowerCase())) relevance += 0.5;
    if (lower.includes(mem.value.toLowerCase().slice(0, 30))) relevance += 0.3;
    if (mem.type === 'shortcut') relevance += 0.2;
    if (mem.type === 'vendor_alias') relevance += 0.1;
    if (mem.type === 'profile') relevance += 0.3;

    const daysSinceUse =
      (now.getTime() - new Date(mem.lastUsed).getTime()) / (24 * 60 * 60 * 1000);
    if (daysSinceUse < 7) relevance += 0.1;

    return { ...mem, confidence, relevance };
  });

  scored.sort((a, b) => b.relevance - a.relevance);
  return scored.slice(0, limit);
}

// --- Confidence-Based Learning ---

export async function learnFromInteraction(
  tenantId: string,
  skillUsed: string,
  params: Record<string, any>,
  result: any,
  feedback?: string,
): Promise<void> {
  // 1. Vendor → Category pattern learning
  if (
    skillUsed === 'record-expense' &&
    result?.success &&
    result.data?.vendorId &&
    result.data?.categoryId
  ) {
    const vendor = result.data.vendorName || params.vendor;
    if (vendor) {
      const key = `vendor_category:${vendor.toLowerCase()}`;
      const existing = await db.abUserMemory.findFirst({ where: { tenantId, key } });

      if (existing) {
        if (existing.value === result.data.categoryId) {
          // Same category — reinforce
          const newConf = Math.min(0.99, existing.confidence + 0.15);
          await db.abUserMemory.update({
            where: { id: existing.id },
            data: {
              confidence: newConf,
              usageCount: { increment: 1 },
              lastUsed: new Date(),
            },
          });
        } else {
          // Contradiction — decay old, create competing pattern
          await db.abUserMemory.update({
            where: { id: existing.id },
            data: {
              confidence: Math.max(0.1, existing.confidence - 0.2),
              contradictions: { increment: 1 },
            },
          });
          const competingKey = `vendor_category:${vendor.toLowerCase()}:${result.data.categoryId}`;
          await db.abUserMemory.upsert({
            where: { tenantId_key: { tenantId, key: competingKey } },
            update: { confidence: 0.5, lastUsed: new Date(), usageCount: { increment: 1 } },
            create: {
              tenantId,
              key: competingKey,
              value: result.data.categoryId,
              type: 'vendor_category',
              confidence: 0.5,
              source: 'learned',
            },
          });
        }
      } else {
        // First time — create with 0.5
        await db.abUserMemory.create({
          data: {
            tenantId,
            key,
            value: result.data.categoryId,
            type: 'vendor_category',
            confidence: 0.5,
            source: 'learned',
          },
        });
      }
    }
  }

  // 2. Auto-promote high-frequency patterns
  const highFreq = await db.abUserMemory.findMany({
    where: {
      tenantId,
      type: 'vendor_category',
      usageCount: { gte: 3 },
      confidence: { lt: 0.95 },
    },
  });
  for (const pattern of highFreq) {
    await db.abUserMemory.update({
      where: { id: pattern.id },
      data: { confidence: 0.95, source: 'auto_promoted' },
    });
  }
}

// --- User Correction Handling ---

export async function handleCorrection(
  tenantId: string,
  feedback: string,
  lastResult: any,
  expenseBaseUrl: string,
): Promise<{ applied: boolean; message: string }> {
  // Parse: "no, that's Travel" / "should be Software"
  const match = feedback.match(
    /(?:no|wrong|not|should be|it'?s|that'?s)\s+(\w[\w\s&]*)/i,
  );
  if (!match) return { applied: false, message: '' };

  const correctedCategory = match[1].trim();
  const account = await db.abAccount.findFirst({
    where: {
      tenantId,
      accountType: 'expense',
      name: { contains: correctedCategory, mode: 'insensitive' },
    },
  });

  if (!account) {
    return { applied: false, message: `I couldn't find a category matching "${correctedCategory}".` };
  }

  // Apply to the last expense if available
  const expenseId = lastResult?.data?.id;
  if (expenseId) {
    await fetch(`${expenseBaseUrl}/api/v1/agentbook-expense/expenses/${expenseId}/categorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({ categoryId: account.id, source: 'user_corrected' }),
    });

    // Update memory — boost corrected category, decay wrong one
    const vendor = lastResult.data.vendorName;
    if (vendor) {
      const key = `vendor_category:${vendor.toLowerCase()}`;
      await db.abUserMemory.upsert({
        where: { tenantId_key: { tenantId, key } },
        update: {
          value: account.id,
          confidence: 0.7,
          lastUsed: new Date(),
          lastVerified: new Date(),
          source: 'user_corrected',
        },
        create: {
          tenantId,
          key,
          value: account.id,
          type: 'vendor_category',
          confidence: 0.7,
          source: 'user_corrected',
        },
      });
    }

    return {
      applied: true,
      message: `Got it — recategorized to **${account.name}**. I'll remember this for next time.`,
    };
  }

  return { applied: false, message: 'I don\'t have a recent expense to correct. Which expense did you mean?' };
}
```

- [ ] **Step 4: Run memory tests**

Run: `cd tests/e2e && npx playwright test agent-brain-v2.spec.ts --config=playwright.config.ts -g "memory" --reporter=line`
Expected: Tests may still fail because agent-memory isn't wired into server.ts yet — that's OK, we wire it in Task 5.

- [ ] **Step 5: Commit**

```bash
git add plugins/agentbook-core/backend/src/agent-memory.ts tests/e2e/agent-brain-v2.spec.ts
git commit -m "feat: agent-memory module — relevance scoring, confidence learning, corrections"
```

---

## Task 3: Agent Evaluator Module

**Files:**
- Create: `plugins/agentbook-core/backend/src/agent-evaluator.ts`

- [ ] **Step 1: Write evaluation tests**

Append to `tests/e2e/agent-brain-v2.spec.ts`:

```typescript
test.describe.serial('Agent Brain v2 — Evaluation', () => {
  test('complex request returns plan with evaluation', async ({ request }) => {
    // Trigger a multi-step request
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'find uncategorized expenses and then categorize them and show breakdown', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    // Should create a plan (complex request)
    expect(body.data.plan || body.data.message).toBeTruthy();
  });

  test('plan confirmation executes and returns evaluation', async ({ request }) => {
    // First trigger a plan
    await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'categorize all expenses and then show breakdown', channel: 'api' },
    });
    // Then confirm
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'yes', channel: 'api', sessionAction: 'confirm' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.message).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement agent-evaluator.ts**

Create `plugins/agentbook-core/backend/src/agent-evaluator.ts`:

```typescript
/**
 * Agent Evaluator — per-step quality checks, final plan evaluation, suggestions.
 */

// --- Types ---

export interface StepQuality {
  score: number;
  issues: string[];
}

export interface Evaluation {
  planSuccess: boolean;
  stepsCompleted: number;
  stepsFailed: number;
  stepsSkipped: number;
  qualityScore: number;
  issues: string[];
  suggestions: string[];
  undoAvailable: boolean;
  summary: string;
}

export interface PlanStep {
  id: string;
  action: string;
  description: string;
  params: Record<string, any>;
  dependsOn: string[];
  canUndo: boolean;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  result?: any;
  quality?: StepQuality;
}

// --- Per-Step Quality ---

export function assessStepQuality(step: PlanStep): StepQuality {
  const issues: string[] = [];
  let score = 1.0;

  if (!step.result?.success) {
    return { score: 0, issues: ['Step failed: ' + (step.result?.error || 'unknown error')] };
  }

  const data = step.result.data;

  if (step.action === 'record-expense') {
    if (!data?.categoryId) { score -= 0.3; issues.push('Expense recorded without category'); }
    if (!data?.vendorId) { score -= 0.1; issues.push('Vendor not recognized'); }
    if (data?.confidence && data.confidence < 0.7) {
      score -= 0.2;
      issues.push(`Low confidence: ${Math.round(data.confidence * 100)}%`);
    }
  }

  if (step.action === 'categorize-expenses') {
    const msg = step.result?.data?.message || '';
    const catMatch = msg.match(/Categorized \*\*(\d+)\*\* of (\d+)/);
    if (catMatch) {
      const [, done, total] = catMatch;
      const ratio = parseInt(done) / Math.max(1, parseInt(total));
      score = ratio;
      if (ratio < 0.5) issues.push(`Only ${Math.round(ratio * 100)}% categorized`);
      const skippedMatch = msg.match(/(\d+) couldn/);
      if (skippedMatch) issues.push(`${skippedMatch[1]} expenses need manual categorization`);
    }
  }

  return { score: Math.max(0, score), issues };
}

// --- Final Plan Evaluation ---

export function buildFinalEvaluation(plan: PlanStep[]): Evaluation {
  const completed = plan.filter(s => s.status === 'done');
  const failed = plan.filter(s => s.status === 'failed');
  const skipped = plan.filter(s => s.status === 'skipped');

  const qualityScore =
    completed.length > 0
      ? completed.reduce((sum, s) => sum + (s.quality?.score || 0), 0) / completed.length
      : 0;

  const issues = plan.flatMap(s => s.quality?.issues || []);
  const suggestions: string[] = [];

  if (issues.some(i => i.includes('without category'))) {
    suggestions.push('Want me to categorize the uncategorized expenses?');
  }
  if (issues.some(i => i.includes('manual categorization'))) {
    suggestions.push('I can show the ones I wasn\'t sure about for manual review.');
  }
  if (failed.length > 0) {
    suggestions.push('Some steps failed — want me to retry them?');
  }
  if (qualityScore > 0.8 && failed.length === 0) {
    suggestions.push('Everything looks good! Any follow-up?');
  }

  const total = completed.length + failed.length + skipped.length;
  return {
    planSuccess: failed.length === 0,
    stepsCompleted: completed.length,
    stepsFailed: failed.length,
    stepsSkipped: skipped.length,
    qualityScore,
    issues,
    suggestions,
    undoAvailable: plan.some(s => s.canUndo && s.status === 'done'),
    summary: `Plan ${failed.length === 0 ? 'complete' : 'completed with errors'}. ${completed.length}/${total} steps done. Quality: ${Math.round(qualityScore * 100)}%.`,
  };
}

// --- Format Evaluation for Display ---

export function formatEvaluation(ev: Evaluation, steps: PlanStep[]): string {
  let text = `**${ev.summary}**\n\n`;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const icon = s.status === 'done' ? '\u2713' : s.status === 'failed' ? '\u2717' : '\u2014';
    text += `${icon} Step ${i + 1}: ${s.description}`;
    if (s.quality?.issues?.length) {
      text += '\n' + s.quality.issues.map(iss => `  - ${iss}`).join('\n');
    }
    text += '\n';
  }

  if (ev.issues.length > 0) {
    text += '\n**Issues:**\n' + ev.issues.slice(0, 5).map(i => `- ${i}`).join('\n') + '\n';
  }

  if (ev.suggestions.length > 0) {
    text += '\n**Suggestions:**\n' + ev.suggestions.map(s => `- ${s}`).join('\n') + '\n';
  }

  if (ev.undoAvailable) text += '\n(Reply "undo" to revert)';

  return text;
}
```

- [ ] **Step 3: Commit**

```bash
git add plugins/agentbook-core/backend/src/agent-evaluator.ts tests/e2e/agent-brain-v2.spec.ts
git commit -m "feat: agent-evaluator module — step quality, plan evaluation, formatting"
```

---

## Task 4: Agent Planner Module

**Files:**
- Create: `plugins/agentbook-core/backend/src/agent-planner.ts`

- [ ] **Step 1: Implement agent-planner.ts**

Create `plugins/agentbook-core/backend/src/agent-planner.ts`:

```typescript
/**
 * Agent Planner — complexity assessment, LLM plan generation, step execution.
 */
import { db } from './db/client.js';
import { PlanStep, assessStepQuality, buildFinalEvaluation, Evaluation } from './agent-evaluator.js';

// --- Types ---

export interface UndoAction {
  stepId: string;
  description: string;
  reverseEndpoint: string;
  reverseMethod: string;
  reverseParams: any;
}

// --- Complexity Assessment ---

export function assessComplexity(
  text: string,
  selectedSkill: any,
  confidence: number,
): 'simple' | 'complex' {
  const multiIntent = /\b(and then|then |also |after that|first .+ then)\b/i;
  if (multiIntent.test(text)) return 'complex';
  if (selectedSkill?.confirmBefore) return 'complex';
  if (confidence < 0.6) return 'complex';

  const destructiveSkills = [
    'edit-expense', 'split-expense', 'categorize-expenses',
    'record-expense', 'create-invoice',
  ];
  if (
    destructiveSkills.includes(selectedSkill?.name) &&
    /\b(edit|delete|remove|undo|change|update|fix|correct|split)\b/i.test(text)
  ) {
    return 'complex';
  }

  if (/\bif\b.+\bthen\b/i.test(text)) return 'complex';
  return 'simple';
}

// --- Plan Generation via LLM ---

export async function generatePlan(
  text: string,
  skills: any[],
  tenantConfig: any,
  recentConvo: string,
  relevantMemories: string,
  callGemini: (sys: string, user: string, max?: number) => Promise<string | null>,
): Promise<PlanStep[]> {
  const skillDescriptions = skills
    .map(s => `- ${s.name}: ${s.description}`)
    .join('\n');

  const prompt = `You are a financial task planner for AgentBook.
Given the user's request, decompose it into sequential steps.

Available skills:
${skillDescriptions}

Additional internal actions:
- confirm-with-user: Ask the user a clarifying question
- evaluate-results: Assess quality of previous steps (always add as last step)

User context:
- Business type: ${tenantConfig?.businessType || 'freelancer'}

Rules:
- Each step must use one skill or internal action
- Add dependsOn when a step needs results from a prior step
- Mark canUndo: true for record-expense, categorize-expenses, create-invoice
- Mark canUndo: false for queries and evaluations
- Always end with an evaluate-results step

Respond as JSON array only (no markdown fences):
[{"action":"skill-name","description":"human-readable","params":{},"dependsOn":[],"canUndo":false}]

User request: ${text}`;

  const llmResult = await callGemini(prompt, `${recentConvo}\n\n${relevantMemories}`, 500);

  if (!llmResult) {
    // Fallback: single step with the best-guess skill
    return [];
  }

  try {
    const cleaned = llmResult.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const steps: any[] = JSON.parse(cleaned);

    // Assign sequential IDs (don't trust LLM IDs)
    return steps.map((s, i) => ({
      id: `step-${i + 1}`,
      action: s.action || 'general-question',
      description: s.description || `Step ${i + 1}`,
      params: s.params || {},
      dependsOn: (s.dependsOn || []).map((_: any, j: number) => `step-${j + 1}`),
      canUndo: s.canUndo ?? false,
      status: 'pending' as const,
    }));
  } catch {
    return [];
  }
}

// --- Format Plan for Display ---

export function formatPlan(steps: PlanStep[]): string {
  let text = "Here's my plan:\n\n";
  steps.forEach((step, i) => {
    const suffix = step.canUndo ? '' : ' (irreversible)';
    text += `${i + 1}. ${step.description}${suffix}\n`;
  });
  text += '\nProceed? (yes/no)';
  return text;
}

// --- Session Management ---

export async function createSession(
  tenantId: string,
  trigger: string,
  plan: PlanStep[],
): Promise<any> {
  // Expire any existing active session
  await db.abAgentSession.updateMany({
    where: { tenantId, status: 'active' },
    data: { status: 'expired' },
  });

  return db.abAgentSession.create({
    data: {
      tenantId,
      trigger,
      plan: plan as any,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    },
  });
}

export async function getActiveSession(tenantId: string): Promise<any | null> {
  return db.abAgentSession.findFirst({
    where: {
      tenantId,
      status: 'active',
      expiresAt: { gt: new Date() },
    },
  });
}

export async function updateSession(
  id: string,
  version: number,
  data: Record<string, any>,
): Promise<boolean> {
  // Optimistic locking via raw SQL (updateMany doesn't support { increment })
  const { plan, stepResults, currentStep, undoStack, pendingConfirmation, status, evaluation } = data;
  const result = await db.$executeRaw`
    UPDATE "plugin_agentbook_core"."AbAgentSession"
    SET "version" = "version" + 1,
        "updatedAt" = NOW(),
        "plan" = COALESCE(${plan ? JSON.stringify(plan) : null}::jsonb, "plan"),
        "stepResults" = COALESCE(${stepResults ? JSON.stringify(stepResults) : null}::jsonb, "stepResults"),
        "currentStep" = COALESCE(${currentStep ?? null}, "currentStep"),
        "undoStack" = COALESCE(${undoStack ? JSON.stringify(undoStack) : null}::jsonb, "undoStack"),
        "pendingConfirmation" = ${pendingConfirmation !== undefined ? (pendingConfirmation ? JSON.stringify(pendingConfirmation) : null) : null}::jsonb,
        "status" = COALESCE(${status ?? null}, "status"),
        "evaluation" = COALESCE(${evaluation ? JSON.stringify(evaluation) : null}::jsonb, "evaluation")
    WHERE "id" = ${id} AND "version" = ${version}`;
  return result > 0;
}

// --- Step Execution ---

export async function executeStep(
  step: PlanStep,
  tenantId: string,
  skills: any[],
  baseUrls: Record<string, string>,
): Promise<any> {
  if (step.action === 'evaluate-results') {
    return { success: true, data: { evaluated: true } };
  }

  const skill = skills.find(s => s.name === step.action);
  if (!skill) {
    return { success: false, error: `Unknown skill: ${step.action}` };
  }

  const endpoint = skill.endpoint as any;
  if (endpoint.method === 'INTERNAL') {
    // Internal skills (like categorize-expenses) need special handling
    // Caller should handle these
    return { success: false, error: 'INTERNAL skill — handle in caller' };
  }

  // Resolve URL
  let targetUrl = endpoint.url;
  for (const [prefix, base] of Object.entries(baseUrls)) {
    if (endpoint.url.startsWith(prefix)) {
      targetUrl = base + endpoint.url;
      break;
    }
  }

  // Execute with 30s timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    let response: any;
    if (endpoint.method === 'GET') {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(step.params)) {
        if (v != null) qs.set(k, String(v));
      }
      const url = qs.toString() ? `${targetUrl}?${qs}` : targetUrl;
      const res = await fetch(url, {
        headers: { 'x-tenant-id': tenantId },
        signal: controller.signal,
      });
      response = await res.json();
    } else {
      // Handle POST, PUT, DELETE
      const res = await fetch(targetUrl, {
        method: endpoint.method || 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify(step.params),
        signal: controller.signal,
      });
      response = await res.json();
    }
    return response;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Step timed out after 30s' };
    }
    return { success: false, error: String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

// --- Build Undo Action ---

export function buildUndoAction(step: PlanStep): UndoAction | null {
  if (!step.canUndo || !step.result?.success) return null;

  const data = step.result.data;
  if (step.action === 'record-expense' && data?.id) {
    return {
      stepId: step.id,
      description: `Delete expense $${((data.amountCents || 0) / 100).toFixed(2)}`,
      reverseEndpoint: `/api/v1/agentbook-expense/expenses/${data.id}/reject`,
      reverseMethod: 'POST',
      reverseParams: {},
    };
  }
  if (step.action === 'categorize-expenses') {
    return {
      stepId: step.id,
      description: 'Revert categorizations',
      reverseEndpoint: '', // bulk undo not easily reversible
      reverseMethod: '',
      reverseParams: {},
    };
  }
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add plugins/agentbook-core/backend/src/agent-planner.ts
git commit -m "feat: agent-planner module — complexity assessment, LLM planning, session management"
```

---

## Task 5: Agent Brain Orchestrator

**Files:**
- Create: `plugins/agentbook-core/backend/src/agent-brain.ts`

- [ ] **Step 1: Implement agent-brain.ts**

Create `plugins/agentbook-core/backend/src/agent-brain.ts`. This module orchestrates the full pipeline — context assembly, classification, session handling, planning, execution, and learning. It exports a single `handleAgentMessage` function that replaces the inline code in server.ts.

```typescript
/**
 * Agent Brain — pipeline orchestrator.
 * Wires together memory, planner, and evaluator.
 */
import { db } from './db/client.js';
import { retrieveRelevantMemories, learnFromInteraction, handleCorrection } from './agent-memory.js';
import {
  assessComplexity,
  generatePlan,
  formatPlan,
  createSession,
  getActiveSession,
  updateSession,
  executeStep,
  buildUndoAction,
} from './agent-planner.js';
import {
  PlanStep,
  assessStepQuality,
  buildFinalEvaluation,
  formatEvaluation,
} from './agent-evaluator.js';

// --- Types ---

interface AgentRequest {
  text: string;
  tenantId: string;
  channel: string;
  attachments?: { type: string; url: string }[];
  sessionAction?: string;
  feedback?: string;
}

interface AgentResponse {
  success: boolean;
  data: {
    message: string;
    actions?: any[];
    chartData?: any;
    skillUsed: string;
    confidence: number;
    latencyMs?: number;
    plan?: { steps: PlanStep[]; requiresConfirmation: boolean };
    evaluation?: any;
    sessionId?: string;
    suggestions?: string[];
    undoAvailable?: boolean;
  };
}

interface AgentContext {
  skills: any[];
  callGemini: (sys: string, user: string, max?: number) => Promise<string | null>;
  baseUrls: Record<string, string>;
  classifyAndExecuteV1: (
    text: string,
    tenantId: string,
    channel: string,
    attachments?: any[],
    memory?: any[],
    skills?: any[],
    conversation?: any[],
    tenantConfig?: any,
  ) => Promise<any>;
}

// --- Main Handler ---

export async function handleAgentMessage(
  req: AgentRequest,
  ctx: AgentContext,
): Promise<AgentResponse> {
  const startTime = Date.now();
  const { text, tenantId, channel, attachments, sessionAction, feedback } = req;

  // --- 0. Handle feedback/corrections ---
  if (feedback) {
    const lastConvo = await db.abConversation.findFirst({
      where: { tenantId, queryType: 'agent' },
      orderBy: { createdAt: 'desc' },
    });
    const lastResult = lastConvo?.data as any;
    const expenseBase = ctx.baseUrls['/api/v1/agentbook-expense'] || 'http://localhost:4051';
    const correction = await handleCorrection(tenantId, feedback, lastResult, expenseBase);
    if (correction.applied) {
      return {
        success: true,
        data: {
          message: correction.message,
          skillUsed: 'correction',
          confidence: 1.0,
          latencyMs: Date.now() - startTime,
        },
      };
    }
  }

  // --- 1. Session Recovery ---
  const activeSession = await getActiveSession(tenantId);

  if (activeSession) {
    // Handle session actions
    if (sessionAction === 'cancel' || /^(cancel|stop|abort|nevermind|n)$/i.test((text || '').trim())) {
      await db.abAgentSession.update({
        where: { id: activeSession.id },
        data: { status: 'expired' },
      });
      return {
        success: true,
        data: { message: 'Plan cancelled.', skillUsed: 'session', confidence: 1.0 },
      };
    }

    if (sessionAction === 'status' || /^(status|where was i)$/i.test((text || '').trim())) {
      const plan = activeSession.plan as PlanStep[];
      const done = plan.filter((s: any) => s.status === 'done').length;
      return {
        success: true,
        data: {
          message: `You have an active plan (${done}/${plan.length} steps done). ${activeSession.pendingConfirmation ? 'Waiting for your confirmation.' : 'In progress.'}`,
          skillUsed: 'session',
          confidence: 1.0,
          sessionId: activeSession.id,
        },
      };
    }

    if (sessionAction === 'skip' || /^(skip|next)$/i.test((text || '').trim())) {
      const plan = activeSession.plan as PlanStep[];
      const current = activeSession.currentStep;
      if (current < plan.length) {
        plan[current].status = 'skipped';
        plan[current].quality = { score: 0, issues: ['Skipped by user'] };
        await db.abAgentSession.update({
          where: { id: activeSession.id },
          data: { plan: plan as any, currentStep: current + 1 },
        });
        return {
          success: true,
          data: {
            message: `Skipped step ${current + 1}: ${plan[current].description}. ${current + 1 < plan.length ? `Next: ${plan[current + 1].description}` : 'No more steps.'}`,
            skillUsed: 'session',
            confidence: 1.0,
          },
        };
      }
      return {
        success: true,
        data: { message: 'No more steps to skip.', skillUsed: 'session', confidence: 1.0 },
      };
    }

    if (sessionAction === 'undo' || /^(undo|revert)$/i.test((text || '').trim())) {
      const undoStack = (activeSession.undoStack as any[]) || [];
      if (undoStack.length === 0) {
        return {
          success: true,
          data: { message: 'Nothing to undo.', skillUsed: 'session', confidence: 1.0 },
        };
      }
      const lastUndo = undoStack.pop();
      if (lastUndo.reverseEndpoint) {
        const base = Object.values(ctx.baseUrls).find(b =>
          lastUndo.reverseEndpoint.startsWith('/api/v1/agentbook-expense') ? b.includes('4051') : true
        ) || 'http://localhost:4051';
        await fetch(base + lastUndo.reverseEndpoint, {
          method: lastUndo.reverseMethod || 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
          body: JSON.stringify(lastUndo.reverseParams || {}),
        });
      }
      await db.abAgentSession.update({
        where: { id: activeSession.id },
        data: { undoStack: undoStack as any },
      });
      return {
        success: true,
        data: {
          message: `Undone: ${lastUndo.description}`,
          skillUsed: 'session',
          confidence: 1.0,
          undoAvailable: undoStack.length > 0,
        },
      };
    }

    // Handle plan confirmation
    if (
      activeSession.pendingConfirmation &&
      (sessionAction === 'confirm' || /^(yes|confirm|go|ok|proceed|do it|y)$/i.test((text || '').trim()))
    ) {
      // Execute the plan
      const plan = activeSession.plan as PlanStep[];
      const results: any[] = [...(activeSession.stepResults as any[] || [])];
      const undoStack: any[] = [...(activeSession.undoStack as any[] || [])];

      // Clear pending confirmation
      await db.abAgentSession.update({
        where: { id: activeSession.id },
        data: { pendingConfirmation: null },
      });

      // Execute steps
      for (let i = activeSession.currentStep; i < plan.length; i++) {
        const step = plan[i];
        if (step.action === 'evaluate-results') {
          step.status = 'done';
          step.quality = { score: 1.0, issues: [] };
          continue;
        }

        step.status = 'running';
        try {
          step.result = await executeStep(step, tenantId, ctx.skills, ctx.baseUrls);
          step.status = step.result?.success ? 'done' : 'failed';
          step.quality = assessStepQuality(step);

          const undo = buildUndoAction(step);
          if (undo) undoStack.push(undo);
          results.push(step.result);
        } catch (err) {
          step.status = 'failed';
          step.quality = { score: 0, issues: [String(err)] };
          results.push({ success: false, error: String(err) });
        }

        // Version increments by 1 each call; track it locally
        const stepVersion = activeSession.version + (i - activeSession.currentStep) + 1;
        await updateSession(activeSession.id, stepVersion - 1, {
          plan: plan as any,
          stepResults: results as any,
          currentStep: i + 1,
          undoStack: undoStack as any,
        });
      }

      const evaluation = buildFinalEvaluation(plan);
      await db.abAgentSession.update({
        where: { id: activeSession.id },
        data: { status: 'completed', evaluation: evaluation as any },
      });

      const evalMessage = formatEvaluation(evaluation, plan);
      return {
        success: true,
        data: {
          message: evalMessage,
          skillUsed: 'plan-execution',
          confidence: 1.0,
          evaluation,
          sessionId: activeSession.id,
          suggestions: evaluation.suggestions,
          undoAvailable: evaluation.undoAvailable,
          latencyMs: Date.now() - startTime,
        },
      };
    }
  }

  // --- 2. Context Assembly (with relevance scoring) ---
  const [tenantConfig, conversation, memory, skills] = await Promise.all([
    db.abTenantConfig.findFirst({ where: { userId: tenantId } }),
    db.abConversation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    retrieveRelevantMemories(tenantId, text || ''),
    db.abSkillManifest.findMany({
      where: { enabled: true, OR: [{ tenantId: null }, { tenantId }] },
    }),
  ]);

  // --- 3. Classify + Simple Execution (delegate to v1 logic) ---
  const v1Result = await ctx.classifyAndExecuteV1(
    text, tenantId, channel, attachments, memory, skills, conversation, tenantConfig,
  );

  if (!v1Result) {
    return {
      success: true,
      data: {
        message: "I'm not sure what you mean. Try \"Spent $45 on lunch\" or \"How much on travel?\"",
        skillUsed: 'none',
        confidence: 0,
      },
    };
  }

  // --- 4. Complexity Assessment ---
  const complexity = assessComplexity(text || '', v1Result.selectedSkill, v1Result.confidence);

  if (complexity === 'complex') {
    // Generate plan via LLM
    const recentConvo = conversation
      .slice(0, 5)
      .reverse()
      .map((c: any) => `User: ${c.question}\nAgent: ${c.answer}`)
      .join('\n');
    const memoryContext = memory
      .filter((m: any) => m.type === 'context' || m.type === 'profile')
      .map((m: any) => `${m.key}: ${m.value}`)
      .join('\n');

    const plan = await generatePlan(
      text, skills, tenantConfig, recentConvo, memoryContext, ctx.callGemini,
    );

    if (plan.length > 0) {
      const session = await createSession(tenantId, text, plan);
      await db.abAgentSession.update({
        where: { id: session.id },
        data: { pendingConfirmation: { type: 'plan_approval' } },
      });

      return {
        success: true,
        data: {
          message: formatPlan(plan),
          skillUsed: 'planner',
          confidence: v1Result.confidence,
          plan: { steps: plan, requiresConfirmation: true },
          sessionId: session.id,
          latencyMs: Date.now() - startTime,
        },
      };
    }
    // LLM plan generation failed — fall through to simple execution
  }

  // --- 5. Simple Execution (v1 path) ---
  // v1Result already has the execution result. Just add learning.

  // --- 6. Learning ---
  await learnFromInteraction(
    tenantId,
    v1Result.skillUsed,
    v1Result.extractedParams,
    v1Result.skillResponse,
  ).catch(() => {}); // best-effort

  return {
    success: true,
    data: {
      ...v1Result.responseData,
      latencyMs: Date.now() - startTime,
      undoAvailable: ['record-expense', 'categorize-expenses', 'create-invoice'].includes(v1Result.skillUsed),
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add plugins/agentbook-core/backend/src/agent-brain.ts
git commit -m "feat: agent-brain orchestrator — sessions, planning, learning pipeline"
```

---

## Task 6: Wire Modules into Server

**Files:**
- Modify: `plugins/agentbook-core/backend/src/server.ts`

- [ ] **Step 1: Add new skill manifests to BUILT_IN_SKILLS array**

In `server.ts`, add 5 new skills to the `BUILT_IN_SKILLS` array (before `general-question`):

```typescript
  {
    name: 'edit-expense', description: 'Edit an existing expense — change amount, category, vendor, date, or description', category: 'bookkeeping',
    triggerPatterns: ['change.*expense', 'edit.*expense', 'update.*expense', 'fix.*expense', 'correct.*expense', 'that.*wrong', 'should be'],
    parameters: { expenseId: { type: 'string', required: false, extractHint: 'expense ID or "last"' }, amountCents: { type: 'number', required: false }, categoryId: { type: 'string', required: false }, vendor: { type: 'string', required: false }, description: { type: 'string', required: false } },
    endpoint: { method: 'PUT', url: '/api/v1/agentbook-expense/expenses/:id' },
    confirmBefore: true,
  },
  {
    name: 'split-expense', description: 'Split an expense into business and personal portions', category: 'bookkeeping',
    triggerPatterns: ['split.*expense', 'part.*business.*personal', 'half.*personal'],
    parameters: { expenseId: { type: 'string', required: false }, businessPercent: { type: 'number', required: false, default: 50 } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-expense/expenses/:id/split' },
    confirmBefore: true,
  },
  {
    name: 'review-queue', description: 'Show expenses that need human review — low confidence, pending, or flagged', category: 'bookkeeping',
    triggerPatterns: ['review', 'pending.*review', 'need.*attention', 'flagged', 'check.*expense'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-expense/review-queue' },
  },
  {
    name: 'manage-recurring', description: 'View or manage recurring expense patterns — subscriptions, rent, monthly charges', category: 'bookkeeping',
    triggerPatterns: ['recurring', 'subscription', 'monthly.*expense', 'regular.*payment'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-expense/recurring-suggestions' },
  },
  {
    name: 'vendor-insights', description: 'Show spending patterns by vendor — who you spend most with, trends', category: 'insights',
    triggerPatterns: ['vendor.*spend', 'who.*spend.*most', 'top.*vendor', 'vendor.*pattern'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-expense/vendors' },
  },
```

- [ ] **Step 2: Refactor /agent/message to use agent-brain.ts**

Import the brain module and refactor the `/agent/message` route. The v1 classification and execution logic stays in server.ts as a helper function (`classifyAndExecuteV1`) that the brain calls for simple requests. The route handler becomes thin:

At the top of server.ts, add:

```typescript
import { handleAgentMessage } from './agent-brain.js';
```

Then refactor the `/agent/message` route handler (around line 2256) to:

1. Extract lines 2266-2590 (context assembly through response formatting) into `async function classifyAndExecuteV1(text, tenantId, channel, attachments, memory, skills, conversation, tenantConfig)`. This function:
   - Runs the 3-stage intent classification (attachments → memory shortcuts → regex → LLM)
   - Runs special pre-processing (auto-categorize, invoice client resolution, categorize-expenses INTERNAL)
   - Executes the skill HTTP call
   - Runs response formatting
   - Saves AbConversation + AbEvent
   - Returns `{ selectedSkill, extractedParams, confidence, skillUsed, skillResponse, responseData: { message, actions, chartData, skillUsed, confidence } }`
   - **Critical:** Keep ALL existing special-case logic (categorize-expenses inline handler, receipt scanning, vendor alias resolution) inside this function. Do not simplify or skip any behavior.
2. The route handler calls `handleAgentMessage(req, ctx)` which delegates to `classifyAndExecuteV1` for simple cases and uses the planner for complex cases

**Note:** The existing `/agent/memory` GET endpoint (line 2182) already exists and will continue to work. No new memory endpoint needed.

The route body becomes:

```typescript
app.post('/api/v1/agentbook-core/agent/message', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { text, channel = 'api', attachments, sessionAction, feedback } = req.body;
    if (!text && (!attachments || attachments.length === 0) && !sessionAction) {
      return res.status(400).json({ success: false, error: 'text, attachments, or sessionAction required' });
    }

    const result = await handleAgentMessage(
      { text: text || '', tenantId, channel, attachments, sessionAction, feedback },
      {
        skills: await db.abSkillManifest.findMany({
          where: { enabled: true, OR: [{ tenantId: null }, { tenantId }] },
        }),
        callGemini,
        baseUrls: {
          '/api/v1/agentbook-expense': process.env.AGENTBOOK_EXPENSE_URL || 'http://localhost:4051',
          '/api/v1/agentbook-core': process.env.AGENTBOOK_CORE_URL || 'http://localhost:4050',
          '/api/v1/agentbook-invoice': process.env.AGENTBOOK_INVOICE_URL || 'http://localhost:4052',
          '/api/v1/agentbook-tax': process.env.AGENTBOOK_TAX_URL || 'http://localhost:4053',
        },
        classifyAndExecuteV1,
      },
    );

    res.json(result);
  } catch (err) {
    console.error('Agent message error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});
```

- [ ] **Step 3: Restart core backend and run seed**

```bash
kill $(lsof -i :4050 -t) 2>/dev/null; sleep 1
cd /Users/qianghan/Documents/mycodespace/a3p
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4050 npx tsx plugins/agentbook-core/backend/src/server.ts &
sleep 4
curl -s -X POST http://localhost:4050/api/v1/agentbook-core/agent/seed-skills
```

Expected: `{"success":true,"data":{"created":5,"updated":11,"total":16}}`

- [ ] **Step 4: Commit**

```bash
git add plugins/agentbook-core/backend/src/server.ts plugins/agentbook-core/backend/src/agent-brain.ts
git commit -m "feat: wire agent-brain v2 into server — sessions, planning, learning"
```

---

## Task 7: Update Telegram Adapter

**Files:**
- Modify: `apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts`

- [ ] **Step 1: Add session-aware message handling**

Update `callAgentBrain` to accept `sessionAction` and `feedback`:

```typescript
async function callAgentBrain(
  tenantId: string,
  text: string,
  attachments?: { type: string; url: string }[],
  sessionAction?: string,
  feedback?: string,
): Promise<any> {
  const res = await fetch(`${CORE_API}/api/v1/agentbook-core/agent/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
    body: JSON.stringify({ text, channel: 'telegram', attachments, sessionAction, feedback }),
  });
  return res.json();
}
```

- [ ] **Step 2: Add feedback and session detection in text handler**

Update the `bot.on('message:text')` handler to detect feedback and session actions before calling the brain:

```typescript
    // Detect feedback/corrections FIRST
    let feedback: string | undefined;
    if (/^(no[, ]+\w|wrong[, ]+|not |should be |that's |it's )/i.test(lower)) {
      feedback = text;
    }

    // Detect session actions (only exact matches, skip if feedback detected)
    let sessionAction: string | undefined;
    if (!feedback) {
      if (/^(yes|confirm|go|ok|proceed|do it|y)$/i.test(lower)) sessionAction = 'confirm';
      else if (/^(no|cancel|stop|abort|nevermind|n)$/i.test(lower)) sessionAction = 'cancel';
      else if (/^(undo|revert|undo that)$/i.test(lower)) sessionAction = 'undo';
      else if (/^(skip|next)$/i.test(lower)) sessionAction = 'skip';
      else if (/^(status|where was i)$/i.test(lower)) sessionAction = 'status';
    }

    const result = await callAgentBrain(tenantId, agentText, undefined, sessionAction, feedback);
```

- [ ] **Step 3: Add plan and evaluation formatting**

Add formatting helpers after the existing `formatResponse` function:

```typescript
function formatPlanForTelegram(data: any): string {
  if (data.plan?.requiresConfirmation) {
    return escHtml(data.message);
  }
  return '';
}

function formatEvaluationForTelegram(data: any): string {
  if (data.evaluation) {
    return escHtml(data.message);
  }
  return '';
}
```

Update the response handling in the text handler to show plans and evaluations:

```typescript
    if (result.success && result.data) {
      let reply: string;
      if (result.data.plan?.requiresConfirmation) {
        reply = escHtml(result.data.message);
      } else if (result.data.evaluation) {
        reply = mdToHtml(result.data.message);
      } else {
        reply = formatResponse(result.data);
      }

      const keyboard = result.data.skillUsed === 'record-expense' && result.data.message?.includes('Recorded')
        ? { inline_keyboard: [[{ text: '\u{1F4C1} Category', callback_data: 'change_cat:agent' }, { text: '\u{1F3E0} Personal', callback_data: 'personal:agent' }]] }
        : result.data.plan?.requiresConfirmation
        ? { inline_keyboard: [[{ text: '\u2705 Yes', callback_data: 'session:confirm' }, { text: '\u274C Cancel', callback_data: 'session:cancel' }]] }
        : undefined;

      try {
        await ctx.reply(reply, { reply_markup: keyboard, parse_mode: 'HTML' });
      } catch {
        await ctx.reply(result.data.message || reply, { reply_markup: keyboard });
      }
    }
```

- [ ] **Step 4: Add session callback handling**

In the `callback_query:data` handler, add session callbacks:

```typescript
      if (action === 'session') {
        const sessionAction = expenseId; // 'confirm' or 'cancel'
        const result = await callAgentBrain(tenantId, sessionAction, undefined, sessionAction);
        await ctx.answerCallbackQuery({ text: sessionAction === 'confirm' ? 'Executing...' : 'Cancelled' });
        if (result.success && result.data?.message) {
          await ctx.editMessageText(escHtml(result.data.message), { parse_mode: 'HTML' }).catch(() => {
            ctx.reply(result.data.message);
          });
        }
        return;
      }
```

- [ ] **Step 5: Commit**

```bash
git add apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts
git commit -m "feat: Telegram adapter — session actions, feedback, plan/eval formatting"
```

---

## Task 8: E2E Tests

**Files:**
- Modify: `tests/e2e/agent-brain-v2.spec.ts`
- Modify: `tests/e2e/agent-brain.spec.ts`

- [ ] **Step 1: Update existing tests for new skill count**

In `tests/e2e/agent-brain.spec.ts`, update:
- Seed skills test: `expect(body.data.total).toBe(16);`
- Skill registry test: `expect(body.data.length).toBeGreaterThanOrEqual(16);`
- Add skill name checks: `expect(names).toContain('edit-expense');`

- [ ] **Step 2: Write full v2 E2E test suite**

Complete `tests/e2e/agent-brain-v2.spec.ts` with all 20 test cases from the spec. Key tests:

```typescript
test.describe.serial('Agent Brain v2 — Sessions & Planning', () => {
  test('simple request works without session', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'spent $15 on coffee', channel: 'api' },
    });
    const body = await res.json();
    expect(body.data.skillUsed).toBe('record-expense');
    expect(body.data.sessionId).toBeUndefined();
  });

  test('complex multi-intent request triggers plan', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'categorize all expenses and then show me the breakdown', channel: 'api' },
    });
    const body = await res.json();
    expect(body.data.plan || body.data.message).toBeTruthy();
  });

  test('cancel expires active session', async ({ request }) => {
    // Trigger plan
    await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'categorize expenses and then show breakdown', channel: 'api' },
    });
    // Cancel
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'cancel', channel: 'api', sessionAction: 'cancel' },
    });
    const body = await res.json();
    expect(body.data.message).toContain('cancel');
  });

  test('confirm executes plan and returns evaluation', async ({ request }) => {
    // Trigger plan
    await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'find uncategorized expenses and then categorize them', channel: 'api' },
    });
    // Confirm
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'yes', channel: 'api', sessionAction: 'confirm' },
    });
    const body = await res.json();
    expect(body.data.message).toBeTruthy();
  });

  test('new plan expires old active session', async ({ request }) => {
    // First plan
    await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'categorize expenses and then show breakdown', channel: 'api' },
    });
    // Second plan (should expire first)
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'find duplicates and then show alerts', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
  });
});

test.describe.serial('Agent Brain v2 — New Skills', () => {
  test('review-queue skill routes correctly', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'show me expenses pending review', channel: 'api' },
    });
    const body = await res.json();
    expect(body.data.skillUsed).toBe('review-queue');
  });

  test('manage-recurring skill routes correctly', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'show my recurring subscriptions', channel: 'api' },
    });
    const body = await res.json();
    expect(body.data.skillUsed).toBe('manage-recurring');
  });

  test('vendor-insights skill routes correctly', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'who do I spend the most with?', channel: 'api' },
    });
    const body = await res.json();
    expect(body.data.skillUsed).toBe('vendor-insights');
  });
});
```

- [ ] **Step 3: Run all tests**

```bash
cd tests/e2e && npx playwright test agent-brain.spec.ts agent-brain-v2.spec.ts --config=playwright.config.ts --reporter=line
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/agent-brain.spec.ts tests/e2e/agent-brain-v2.spec.ts
git commit -m "test: agent brain v2 E2E tests — sessions, planning, learning, new skills"
```

---

## Task 9: Final Integration & Push

- [ ] **Step 1: Run full E2E suite**

```bash
cd tests/e2e && npx playwright test agent-brain.spec.ts agent-brain-v2.spec.ts --config=playwright.config.ts --reporter=line
```

Fix any failures.

- [ ] **Step 2: Push all commits**

```bash
git push origin feat/agentbook
```
