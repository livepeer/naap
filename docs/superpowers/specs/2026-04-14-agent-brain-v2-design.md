# Agent Brain v2 — Adaptive Multi-Step Agent with Learning

## Overview

Redesign the agent brain from a single-shot skill router into an adaptive, planning-capable agent with confidence-based learning, session state, and post-execution evaluation. The agent serves freelancers via Telegram, managing expenses, cash flow, invoicing, and financial projections.

**Core loop:** Plan transparently → Execute step by step → Verify completion → Assess quality → Surface what needs human judgment → Suggest next steps.

**Key principles:**
- Transparency: always show the plan before executing
- Trust through learning: confidence-based pattern updates, not blind overrides
- Memory at three timescales: session (hours), working knowledge (weeks-months), profile (permanent)
- Graceful degradation: if LLM fails, fall back to regex; if regex fails, ask the user

## Architecture

```
User message (Telegram / Web / API)
  → Channel Adapter (thin — upload blobs, format output)
  → POST /agent/message { text, tenantId, channel, attachments?, sessionAction? }
  → Agent Pipeline:
      1. Session Recovery — resume active session if exists
      2. Context Assembly — session + memory (relevance-scored) + conversation + tenant config
      3. Intent Classification — user shortcuts → regex → LLM (unchanged 3-stage cascade)
      4. Complexity Assessment — simple (1 step) vs complex (multi-step)
         ├─ Simple: execute skill directly (same as v1)
         └─ Complex: enter planning mode
              a. LLM decomposes into step array
              b. Present plan to user, wait for confirm
              c. Execute steps sequentially (respecting dependencies)
              d. After each step: verify success, log result
              e. After all steps: evaluate quality, surface issues
      5. Learning — update confidence scores, vendor patterns, memory decay
      6. Response — format per channel, include suggestions
  → Response { message, plan?, evaluation?, actions?, skillUsed, confidence }
  → Channel Adapter formats for Telegram HTML / Web markdown
```

**Location:** The agent brain logic lives in `plugins/agentbook-core/backend/src/`. The current `/agent/message` endpoint in `server.ts` is already ~400 lines. To keep files focused, extract the brain into separate modules:
- `agent-brain.ts` — pipeline orchestrator (context assembly, classification, routing)
- `agent-planner.ts` — plan generation, complexity assessment, step execution
- `agent-memory.ts` — relevance scoring, confidence learning, decay
- `agent-evaluator.ts` — per-step and final evaluation

The `/agent/message` route in `server.ts` becomes a thin entry point calling these modules. No new microservices.

## Data Models

### AbAgentSession (new, plugin_agentbook_core schema)

Tracks multi-step plans in progress. One active session per tenant at a time.

```prisma
model AbAgentSession {
  id                  String   @id @default(uuid())
  tenantId            String
  status              String   @default("active")    // active | paused | completed | failed | expired
  trigger             String                          // the original user message that started the session
  plan                Json                            // PlanStep[] — the full plan
  currentStep         Int      @default(0)            // index into plan array
  stepResults         Json     @default("[]")         // results from completed steps
  pendingConfirmation Json?                           // what we're waiting for user to confirm
  undoStack           Json     @default("[]")         // reversible actions [{skillName, endpoint, params, reverseEndpoint, reverseParams}]
  evaluation          Json?                           // final evaluation after plan completes
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  expiresAt           DateTime                        // auto-expire after 24h inactivity

  @@index([tenantId, status])                          // query active sessions efficiently
  @@index([tenantId])
  @@schema("plugin_agentbook_core")
}
```

**One active session enforcement:** Enforced in application code, not via DB constraint. When creating a new active session, the code first marks any existing active session as `expired`. This allows completed/failed/expired sessions to accumulate as history.

**Concurrency guard:** Use optimistic locking via a `version` column. When resuming execution, read the session with its version, then update with `WHERE id = ? AND version = ?`. If the update affects 0 rows, another process already advanced the session — abort and re-read.

Add to the model:
```prisma
  version             Int      @default(0)             // optimistic locking for concurrent execution
```

### AbUserMemory (enhanced)

Add three fields to the existing model:

```prisma
model AbUserMemory {
  // ... existing fields ...
  decayRate      Float     @default(0.1)    // confidence lost per month of disuse
  lastVerified   DateTime?                  // when user last confirmed this is correct
  contradictions Int       @default(0)      // times a newer pattern conflicted

  // ... existing indexes ...
}
```

No migration needed — all new fields are nullable or have defaults.

### AbConversation (enhanced)

Add two fields to the existing model:

```prisma
model AbConversation {
  // ... existing fields ...
  sessionId   String?                      // link to AbAgentSession if part of a plan
  feedback    String?                      // user correction or rating on this response
}
```

## Session Lifecycle

### Creating a Session

When the complexity assessment determines a request needs multi-step planning:

1. Expire any existing active session for this tenant
2. Create new `AbAgentSession` with `status: 'active'`, `expiresAt: now + 24h`
3. LLM generates the plan (see Planning section)
4. Store plan in session, set `pendingConfirmation` to the plan itself
5. Return plan to user for confirmation

### Resuming a Session

On every `/agent/message` call, before classification:

1. Check for active session: `WHERE tenantId = ? AND status = 'active' AND expiresAt > now()`
2. If found and `pendingConfirmation` is set:
   - If user says "yes/confirm/go/ok" → proceed with execution
   - If user says "no/cancel/stop" → mark session `expired`, process message normally
   - If user says something else → treat as a new message (pause session)
3. If found and executing (no pending confirmation):
   - Continue from `currentStep`
4. If not found → process as normal (no active session)

### Session Expiry

- Sessions expire after 24h of inactivity (no message from user)
- On expiry: set `status: 'expired'`
- A background check on each `/agent/message` call handles cleanup (no cron needed)

### User Commands for Sessions

Recognized in the intent classification stage (before regex/LLM):
- "cancel" / "stop" / "abort" → expire active session
- "undo" / "revert" → pop last item from undoStack, execute reverse action
- "status" / "where was I" → show current session state
- "skip" → skip current step, move to next

## Planning

### Complexity Assessment

After intent classification, before execution:

```typescript
function assessComplexity(text: string, selectedSkill: any, confidence: number): 'simple' | 'complex' {
  // Complex if:
  // 1. Message contains multiple intents (AND, then, also, after that)
  // 2. Skill has confirmBefore: true
  // 3. Confidence is below 0.6 (uncertain — plan for transparency)
  // 4. Message references editing/deleting existing data
  // 5. Message is conditional ("if X then Y")

  const multiIntent = /\b(and then|then |also |after that|first .+ then|if .+ then)\b/i;
  if (multiIntent.test(text)) return 'complex';
  if (selectedSkill?.confirmBefore) return 'complex';
  if (confidence < 0.6) return 'complex';
  // Only flag destructive words as complex if the matched skill is a write operation
  const destructiveSkills = ['edit-expense', 'split-expense', 'categorize-expenses', 'record-expense', 'create-invoice'];
  if (destructiveSkills.includes(selectedSkill?.name) && /\b(edit|delete|remove|undo|change|update|fix|correct|split)\b/i.test(text)) return 'complex';
  if (/\bif\b.+\bthen\b/i.test(text)) return 'complex';

  return 'simple';
}
```

### Plan Generation

For complex requests, call LLM to decompose into steps:

```typescript
const planPrompt = `You are a financial task planner for AgentBook.
Given the user's request, decompose it into sequential steps.

Available skills (actions the agent can perform):
${skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}

Additional internal actions:
- confirm-with-user: Ask the user a clarifying question
- evaluate-results: Assess quality of previous steps

User context:
- Business type: ${tenant.businessType}
- Recent conversation: ${recentConvo}
- Active memories: ${relevantMemories}

Respond as JSON array:
[
  {
    "action": "skill-name or internal-action",
    "description": "human-readable description of this step",
    "params": { ... },
    "dependsOn": [],
    "canUndo": true/false
  }
]

Always end with an evaluate-results step.
User request: ${text}`;
```

### Plan Presentation

Format the plan for the user before execution:

```
Here's my plan:

1. Find all uncategorized expenses from last month
2. Auto-categorize by vendor and description keywords
3. Show category breakdown chart
4. Evaluate results and flag uncertain categorizations

Steps 1-3 can be undone. Proceed? (yes/no)
```

### PlanStep Type

```typescript
interface PlanStep {
  id: string;                    // uuid
  action: string;                // skill name or internal action
  description: string;           // human-readable
  params: Record<string, any>;   // extracted parameters
  dependsOn: string[];           // step IDs that must complete first
  canUndo: boolean;              // whether this is reversible
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  result?: any;                  // response from skill execution
  quality?: {                    // post-step quality assessment
    score: number;               // 0-1
    issues: string[];            // what went wrong or was uncertain
  };
}
```

## Execution Engine

### Step-by-Step Execution

When user confirms a plan:

```typescript
async function executePlan(session: AbAgentSession, tenantId: string): Promise<Evaluation> {
  const plan: PlanStep[] = session.plan;
  const results: any[] = [...session.stepResults];

  for (let i = session.currentStep; i < plan.length; i++) {
    const step = plan[i];

    // Check dependencies
    if (step.dependsOn?.length) {
      const unmet = step.dependsOn.filter(depId => {
        const dep = plan.find(s => s.id === depId);
        return dep?.status !== 'done';
      });
      if (unmet.length > 0) {
        step.status = 'skipped';
        step.quality = { score: 0, issues: ['Dependencies not met'] };
        continue;
      }
    }

    // Execute
    step.status = 'running';
    await updateSession(session.id, { currentStep: i, plan });

    try {
      if (step.action === 'evaluate-results') {
        step.result = evaluateResults(plan, results);
      } else if (step.action === 'confirm-with-user') {
        // Pause execution, ask user
        await updateSession(session.id, {
          pendingConfirmation: { stepId: step.id, question: step.params.question },
        });
        return { partial: true, pausedAt: i };
      } else {
        // Execute skill (reuse existing skill execution logic)
        step.result = await executeSkill(step.action, step.params, tenantId);
      }

      step.status = 'done';

      // Assess step quality
      step.quality = assessStepQuality(step);

      // Push to undo stack if reversible
      if (step.canUndo && step.result?.success) {
        session.undoStack.push(buildUndoAction(step));
      }

      results.push(step.result);
    } catch (err) {
      step.status = 'failed';
      step.quality = { score: 0, issues: [String(err)] };

      // Don't abort — continue with remaining steps that don't depend on this one
      results.push({ success: false, error: String(err) });
    }

    await updateSession(session.id, { plan, stepResults: results, currentStep: i + 1 });
  }

  // Final evaluation
  const evaluation = buildFinalEvaluation(plan, results);
  await updateSession(session.id, { status: 'completed', evaluation });

  return evaluation;
}
```

### Undo Support

Each reversible step pushes an undo entry:

```typescript
interface UndoAction {
  stepId: string;
  description: string;           // "Delete expense $45 at Starbucks"
  reverseEndpoint: string;       // e.g., DELETE /expenses/:id
  reverseMethod: string;         // DELETE, PUT, POST
  reverseParams: any;
  createdAt: Date;
}
```

Undo actions for common skills:
- `record-expense` → DELETE `/expenses/:id` (or PUT with `status: 'rejected'`)
- `categorize` → PUT `/expenses/:id` with `categoryId: null`
- `create-invoice` → DELETE `/invoices/:id` (draft only)
- `edit-expense` → PUT `/expenses/:id` with original values

When user says "undo": pop last `UndoAction`, execute it, remove from stack.

## Evaluation Engine

### Per-Step Quality Assessment

After each step completes:

```typescript
function assessStepQuality(step: PlanStep): { score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 1.0;

  // Check HTTP success
  if (!step.result?.success) {
    return { score: 0, issues: ['Step failed: ' + (step.result?.error || 'unknown error')] };
  }

  const data = step.result.data;

  // Skill-specific quality checks
  if (step.action === 'record-expense') {
    if (!data.categoryId) { score -= 0.3; issues.push('Expense recorded without category'); }
    if (!data.vendorId) { score -= 0.1; issues.push('Vendor not recognized'); }
    if (data.confidence && data.confidence < 0.7) { score -= 0.2; issues.push(`Low confidence: ${Math.round(data.confidence * 100)}%`); }
  }

  if (step.action === 'categorize-expenses') {
    const total = data.total || 1;
    const categorized = data.categorized || 0;
    const ratio = categorized / total;
    score = ratio;
    if (ratio < 0.5) issues.push(`Only ${Math.round(ratio * 100)}% categorized`);
    if (data.skipped > 0) issues.push(`${data.skipped} expenses need manual categorization`);
  }

  return { score: Math.max(0, score), issues };
}
```

### Final Plan Evaluation

After all steps complete:

```typescript
interface Evaluation {
  planSuccess: boolean;              // did all non-skipped steps succeed?
  stepsCompleted: number;
  stepsFailed: number;
  stepsSkipped: number;
  qualityScore: number;              // weighted average of step scores
  issues: string[];                  // aggregated issues
  suggestions: string[];             // what to do next
  undoAvailable: boolean;            // any actions reversible?
  summary: string;                   // human-readable summary
}

function buildFinalEvaluation(plan: PlanStep[], results: any[]): Evaluation {
  const completed = plan.filter(s => s.status === 'done');
  const failed = plan.filter(s => s.status === 'failed');
  const skipped = plan.filter(s => s.status === 'skipped');

  const qualityScore = completed.length > 0
    ? completed.reduce((sum, s) => sum + (s.quality?.score || 0), 0) / completed.length
    : 0;

  const issues = plan.flatMap(s => s.quality?.issues || []);
  const suggestions: string[] = [];

  // Generate suggestions based on issues
  if (issues.some(i => i.includes('without category'))) {
    suggestions.push('Want me to categorize the uncategorized expenses?');
  }
  if (issues.some(i => i.includes('manual categorization'))) {
    suggestions.push('I can show you the ones I wasn\'t sure about for manual review.');
  }
  if (failed.length > 0) {
    suggestions.push('Some steps failed — want me to retry them?');
  }
  if (qualityScore > 0.8 && failed.length === 0) {
    suggestions.push('Everything looks good! Any follow-up questions?');
  }

  return {
    planSuccess: failed.length === 0,
    stepsCompleted: completed.length,
    stepsFailed: failed.length,
    stepsSkipped: skipped.length,
    qualityScore,
    issues,
    suggestions,
    undoAvailable: plan.some(s => s.canUndo && s.status === 'done'),
    summary: `Plan ${failed.length === 0 ? 'completed' : 'completed with errors'}. ${completed.length}/${plan.length} steps done. Quality: ${Math.round(qualityScore * 100)}%.`,
  };
}
```

### Evaluation Response Format

Telegram output after plan execution:

```
Plan complete (3/3 steps done, quality: 85%)

Step 1: Found 24 uncategorized expenses
Step 2: Categorized 18 expenses
  - 3 had low confidence (Meals vs Travel ambiguous)
  - 6 couldn't be auto-categorized
Step 3: Breakdown generated

Issues:
- 6 expenses need manual categorization
- 3 categorizations were uncertain

Suggestions:
- Want me to show the uncertain ones for review?
- I can list the 6 uncategorizable expenses.

(Reply "undo" to revert all categorizations)
```

## Memory & Learning System

### Three Memory Layers

**Layer 1: Session Context (AbAgentSession)**
- Active plan, step progress, pending confirmations, undo stack
- Lifespan: current conversation (expires after 24h inactivity)
- Retrieved: on every message, before classification

**Layer 2: Working Knowledge (AbUserMemory)**
- Vendor aliases, category defaults, shortcuts, preferences
- Lifespan: weeks to months, confidence-decayed
- Retrieved: top 50 by relevance score (see Retrieval section)
- Updated: after corrections, skill executions, pattern detection

**Layer 3: User Profile (AbTenantConfig + AbUserMemory type=profile)**
- Business type, jurisdiction, currency, communication style
- Lifespan: permanent until explicitly changed
- Retrieved: always loaded (part of tenant config)
- Updated: rare, user-initiated

### Relevance-Scored Memory Retrieval

Replace the current "last 50 by lastUsed" with relevance scoring:

```typescript
async function retrieveRelevantMemories(tenantId: string, text: string, limit = 50): Promise<AbUserMemory[]> {
  // 1. Load all non-expired memories
  const all = await db.abUserMemory.findMany({
    where: { tenantId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
  });

  // 2. Apply monthly decay (lazy — update confidence on read)
  const now = new Date();
  for (const mem of all) {
    const monthsSinceUse = (now.getTime() - mem.lastUsed.getTime()) / (30 * 24 * 60 * 60 * 1000);
    if (monthsSinceUse > 1) {
      const decayedConfidence = Math.max(0.1, mem.confidence - (mem.decayRate * Math.floor(monthsSinceUse)));
      if (decayedConfidence !== mem.confidence) {
        mem.confidence = decayedConfidence;
        // Batch update in background (don't block request)
        db.abUserMemory.update({ where: { id: mem.id }, data: { confidence: decayedConfidence } }).catch(() => {});
      }
    }
  }

  // 3. Score by relevance to current message
  const lower = text.toLowerCase();
  const scored = all.map(mem => {
    let relevance = mem.confidence; // base: confidence score

    // Boost if memory key appears in message
    const keyClean = mem.key.replace(/^(shortcut|vendor_alias|preference):/, '');
    if (lower.includes(keyClean.toLowerCase())) relevance += 0.5;

    // Boost if memory value appears in message
    if (lower.includes(mem.value.toLowerCase())) relevance += 0.3;

    // Boost by type priority for this context
    if (mem.type === 'shortcut') relevance += 0.2;        // shortcuts always relevant
    if (mem.type === 'vendor_alias') relevance += 0.1;     // vendor context useful
    if (mem.type === 'profile') relevance += 0.3;          // profile always relevant

    // Boost recent usage
    const daysSinceUse = (now.getTime() - mem.lastUsed.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSinceUse < 7) relevance += 0.1;

    return { ...mem, relevance };
  });

  // 4. Sort by relevance, take top N
  scored.sort((a, b) => b.relevance - a.relevance);
  return scored.slice(0, limit);
}
```

### Confidence-Based Learning

After each agent interaction, update memory based on outcomes:

```typescript
async function learnFromInteraction(
  tenantId: string,
  skillUsed: string,
  params: any,
  result: any,
  userFeedback?: string,
): Promise<void> {
  // 1. Vendor → Category pattern learning
  if (skillUsed === 'record-expense' && result?.success && result.data?.vendorId && result.data?.categoryId) {
    const vendor = result.data.vendorName || params.vendor;
    if (vendor) {
      const key = `vendor_category:${vendor.toLowerCase()}`;
      const existing = await db.abUserMemory.findFirst({ where: { tenantId, key } });

      if (existing) {
        const existingValue = existing.value;
        if (existingValue === result.data.categoryId) {
          // Same category again — increase confidence
          const newConf = Math.min(0.99, existing.confidence + 0.15);
          await db.abUserMemory.update({
            where: { id: existing.id },
            data: { confidence: newConf, usageCount: { increment: 1 }, lastUsed: new Date() },
          });
        } else {
          // Different category — contradiction
          const newConf = Math.max(0.1, existing.confidence - 0.2);
          await db.abUserMemory.update({
            where: { id: existing.id },
            data: { confidence: newConf, contradictions: { increment: 1 } },
          });
          // Create competing pattern keyed by category ID to track multiple candidates
          const competingKey = `vendor_category:${vendor.toLowerCase()}:${result.data.categoryId}`;
          await db.abUserMemory.upsert({
            where: { tenantId_key: { tenantId, key: competingKey } },
            update: { confidence: 0.5, lastUsed: new Date(), usageCount: { increment: 1 } },
            create: { tenantId, key: competingKey, value: result.data.categoryId, type: 'vendor_category', confidence: 0.5, source: 'learned' },
          });
        }
      } else {
        // First time seeing this vendor → create with 0.5 confidence
        await db.abUserMemory.create({
          data: { tenantId, key, value: result.data.categoryId, type: 'vendor_category', confidence: 0.5, source: 'learned' },
        });
      }
    }
  }

  // 2. User correction learning
  if (userFeedback) {
    // Parse correction: "no, that's Travel" → extract category
    const correctionMatch = userFeedback.match(/(?:no|wrong|not|should be|it's|that's)\s+(\w[\w\s&]*)/i);
    if (correctionMatch) {
      const correctedCategory = correctionMatch[1].trim();
      // Find the category account
      const account = await db.abAccount.findFirst({
        where: { tenantId, accountType: 'expense', name: { contains: correctedCategory, mode: 'insensitive' } },
      });
      if (account && result?.data?.id) {
        // Apply correction to expense
        await fetch(`${expenseBase}/api/v1/agentbook-expense/expenses/${result.data.id}/categorize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
          body: JSON.stringify({ categoryId: account.id, source: 'user_corrected' }),
        });
        // Update memory with correction
        // ... (same confidence update logic as above, but boosted since user-stated)
      }
    }
  }

  // 3. Auto-promote high-frequency patterns
  const highFreqPatterns = await db.abUserMemory.findMany({
    where: { tenantId, type: 'vendor_category', usageCount: { gte: 3 }, confidence: { lt: 0.95 } },
  });
  for (const pattern of highFreqPatterns) {
    await db.abUserMemory.update({
      where: { id: pattern.id },
      data: { confidence: 0.95, source: 'auto_promoted' },
    });
  }
}
```

### Memory Types (expanded)

| Type | Key Format | Value | Created By | Decay |
|------|-----------|-------|-----------|-------|
| `shortcut` | `shortcut:weekly report` | `{ skill, params }` | User | 0.1/month |
| `vendor_alias` | `vendor_alias:cab` | `Uber` | User or learned | 0.1/month |
| `vendor_category` | `vendor_category:starbucks` | `category-account-id` | Learned from usage | 0.1/month |
| `category_default` | `category_default:software` | `category-account-id` | Learned from 3+ uses | 0.05/month |
| `preference` | `preference:detail_level` | `brief` or `detailed` | Inferred or user-stated | Never |
| `context` | `context:project_name` | `TechCorp redesign` | User | 0.15/month |
| `profile` | `profile:communication_style` | `brief` | Inferred | Never |
| `correction` | `correction:expense-id` | `{ from, to, reason }` | User correction | 0.2/month |

## New Skills

### edit-expense

```typescript
{
  name: 'edit-expense',
  description: 'Edit an existing expense — change amount, category, vendor, date, or description',
  category: 'bookkeeping',
  triggerPatterns: ['change.*expense', 'edit.*expense', 'update.*expense', 'fix.*expense', 'correct.*expense', 'that.*wrong', 'should be'],
  parameters: {
    expenseId: { type: 'string', required: false, extractHint: 'expense ID or "last"' },
    amountCents: { type: 'number', required: false },
    categoryId: { type: 'string', required: false },
    vendor: { type: 'string', required: false },
    description: { type: 'string', required: false },
    date: { type: 'date', required: false },
  },
  endpoint: { method: 'PUT', url: '/api/v1/agentbook-expense/expenses/:id' },
  confirmBefore: true,
}
```

**Special handling:** If `expenseId` is "last" or not provided, look up the most recent expense for this tenant. If the user says "that should be Travel", resolve "that" from the last conversation entry's skill result.

### split-expense

```typescript
{
  name: 'split-expense',
  description: 'Split an expense into business and personal portions',
  category: 'bookkeeping',
  triggerPatterns: ['split.*expense', 'part.*business.*personal', 'half.*personal'],
  parameters: {
    expenseId: { type: 'string', required: false },
    businessPercent: { type: 'number', required: false, default: 50 },
  },
  endpoint: { method: 'POST', url: '/api/v1/agentbook-expense/expenses/:id/split' },
  confirmBefore: true,
}
```

### review-queue

```typescript
{
  name: 'review-queue',
  description: 'Show expenses that need human review — low confidence, pending, or flagged',
  category: 'bookkeeping',
  triggerPatterns: ['review', 'pending.*review', 'need.*attention', 'flagged', 'check.*expense'],
  parameters: {},
  endpoint: { method: 'GET', url: '/api/v1/agentbook-expense/review-queue' },
}
```

### manage-recurring

```typescript
{
  name: 'manage-recurring',
  description: 'View or manage recurring expense patterns — Netflix, rent, subscriptions',
  category: 'bookkeeping',
  triggerPatterns: ['recurring', 'subscription', 'monthly.*expense', 'regular.*payment'],
  parameters: {},
  endpoint: { method: 'GET', url: '/api/v1/agentbook-expense/recurring-suggestions' },
}
```

### vendor-insights

```typescript
{
  name: 'vendor-insights',
  description: 'Show spending patterns by vendor — who you spend most with, trends',
  category: 'insights',
  triggerPatterns: ['vendor.*spend', 'who.*spend.*most', 'top.*vendor', 'vendor.*pattern'],
  parameters: {},
  endpoint: { method: 'GET', url: '/api/v1/agentbook-expense/vendors' },
}
```

## Request/Response Contract (v2)

### Request

```typescript
POST /api/v1/agentbook-core/agent/message
{
  text: string,
  tenantId?: string,            // resolved from header if not in body
  channel: "telegram" | "web" | "api",
  attachments?: [{ type: "photo" | "pdf" | "document", url: string }],

  // Session actions (new in v2)
  sessionAction?: "confirm" | "cancel" | "undo" | "skip" | "status",
  feedback?: string,            // user correction on previous response
}
```

### Response

```typescript
{
  success: true,
  data: {
    message: string,
    actions?: [{ label: string, type: string, payload?: any }],
    chartData?: { type: string, data: any[] },
    skillUsed: string,
    confidence: number,

    // New in v2
    plan?: {                          // present when a plan was generated
      steps: PlanStep[],
      requiresConfirmation: boolean,
    },
    evaluation?: Evaluation,          // present after plan execution
    sessionId?: string,               // active session ID
    suggestions?: string[],           // what to do next
    followUp?: string,                // if agent needs more info
    undoAvailable?: boolean,          // can user undo last action?
  }
}
```

## Telegram Adapter Changes

### Session-Aware Message Handling

The adapter needs to pass `sessionAction` when user responds to a plan:

```typescript
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  const lower = text.toLowerCase().trim();

  // Detect feedback/corrections FIRST (takes precedence over session cancel)
  // "no, that should be Travel" is a correction, not a cancel
  let feedback: string | undefined;
  if (/^(no[, ]+\w|wrong[, ]+|not |should be |that's |it's )/i.test(lower)) {
    feedback = text;
  }

  // Detect session actions (only exact single-word/phrase matches)
  // Feedback takes precedence — if feedback is set, skip session action detection
  let sessionAction: string | undefined;
  if (!feedback) {
    if (/^(yes|confirm|go|ok|proceed|do it|y)$/i.test(lower)) sessionAction = 'confirm';
    else if (/^(no|cancel|stop|abort|nevermind|n)$/i.test(lower)) sessionAction = 'cancel';
    else if (/^(undo|revert|undo that)$/i.test(lower)) sessionAction = 'undo';
    else if (/^(skip|next)$/i.test(lower)) sessionAction = 'skip';
    else if (/^(status|where was i)$/i.test(lower)) sessionAction = 'status';
  }

  const result = await callAgentBrain(tenantId, text, undefined, sessionAction, feedback);
  // ... format response
});
```

### Plan Presentation

When response includes `plan`:

```typescript
if (result.data.plan?.requiresConfirmation) {
  let planText = "Here's my plan:\n\n";
  result.data.plan.steps.forEach((step, i) => {
    const icon = step.canUndo ? '' : ' (irreversible)';
    planText += `${i + 1}. ${step.description}${icon}\n`;
  });
  planText += '\nProceed? (yes/no)';
  await ctx.reply(planText, { parse_mode: 'HTML' });
}
```

### Evaluation Presentation

When response includes `evaluation`:

```typescript
if (result.data.evaluation) {
  const ev = result.data.evaluation;
  let evalText = `<b>Plan ${ev.planSuccess ? 'complete' : 'completed with errors'}</b>\n`;
  evalText += `${ev.stepsCompleted}/${ev.stepsCompleted + ev.stepsFailed + ev.stepsSkipped} steps done`;
  evalText += ` | Quality: ${Math.round(ev.qualityScore * 100)}%\n\n`;

  if (ev.issues.length > 0) {
    evalText += '<b>Issues:</b>\n';
    ev.issues.slice(0, 5).forEach(i => evalText += `- ${escHtml(i)}\n`);
  }

  if (ev.suggestions.length > 0) {
    evalText += '\n<b>Suggestions:</b>\n';
    ev.suggestions.forEach(s => evalText += `- ${escHtml(s)}\n`);
  }

  if (ev.undoAvailable) evalText += '\n(Reply "undo" to revert)';

  await ctx.reply(evalText, { parse_mode: 'HTML' });
}
```

## Error Handling

| Error | Behavior |
|-------|----------|
| LLM planning failure | Fall back to single-step execution of best-guess skill |
| Step execution failure | Mark step failed, continue with non-dependent steps, report in evaluation |
| Session expired mid-plan | On next message, notify user: "Your previous plan expired. Start fresh?" |
| Undo failure | Report error, keep undo stack intact for retry |
| Memory write failure | Log error, don't block response (memory is best-effort) |
| Confidence too low for any skill | Ask clarifying question instead of guessing |
| Step execution timeout (>30s) | Abort step via AbortController, mark failed, continue |
| Telegram message too long (>4096 chars) | Split into multiple messages, send sequentially |
| LLM plan has invalid step IDs | System assigns sequential IDs (step-1, step-2) post-generation |

## Backward Compatibility

- All v1 behavior preserved for simple single-skill requests
- `sessionAction` and `feedback` are optional — omitting them gives v1 behavior
- Existing skills continue to work unchanged
- New skills are additive
- Response format is backward compatible (new fields are optional)
- Memory decay is lazy (applied on read, not a breaking migration)

## Testing

E2E tests in `tests/e2e/agent-brain-v2.spec.ts`:

1. Simple request still works (no session created)
2. Complex request triggers plan generation
3. Plan presentation includes step descriptions
4. "confirm" executes the plan
5. "cancel" expires the session
6. Step-by-step execution updates session state
7. Failed step doesn't abort remaining independent steps
8. Evaluation includes quality scores and suggestions
9. "undo" reverses last action
10. Session expires after 24h
11. Memory confidence increases on repeated same-category vendor
12. Memory confidence decreases on contradiction
13. Memory decays over time (mock clock)
14. Relevance scoring prioritizes message-related memories
15. User correction updates memory and re-categorizes expense
16. edit-expense skill resolves "last" to most recent expense
17. split-expense creates two sub-expenses
18. review-queue returns pending items
19. Multi-intent message ("record $45 lunch and show breakdown") creates 2-step plan
20. Concurrent sessions: new plan expires old active session

## Implementation Phases

**Phase 1: Foundation (sessions + planning)**
- AbAgentSession model + migration
- Session lifecycle (create, resume, expire)
- Complexity assessment
- Plan generation via LLM
- Plan presentation + confirm/cancel
- Step-by-step execution engine

**Phase 2: Evaluation + Undo**
- Per-step quality assessment
- Final evaluation builder
- Undo stack + reverse actions
- Telegram evaluation formatting

**Phase 3: Memory & Learning**
- AbUserMemory schema additions
- Relevance-scored retrieval
- Confidence-based learning (vendor→category)
- User correction handling
- Monthly decay (lazy on read)
- Auto-promotion of high-frequency patterns

**Phase 4: New Skills**
- edit-expense (with "last" resolution)
- split-expense
- review-queue
- manage-recurring
- vendor-insights

**Phase 5: Telegram UX Polish**
- Session-aware message handling
- Plan/evaluation formatting
- Inline keyboard for plan confirm/cancel
- Callback routing through agent brain
