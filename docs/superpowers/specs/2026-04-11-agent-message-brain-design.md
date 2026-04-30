# Agent Message Brain — Design Spec

## Overview

Refactor the monolithic 500-line Telegram webhook into a channel-agnostic agent brain with skill-based architecture, LLM-powered intent classification, and per-user learning. Single endpoint `POST /api/v1/agentbook-core/agent/message` serves all channels.

## Architecture

```
User message (any channel)
  → Channel Adapter (Telegram / Web AskBar / API)
  → POST /agent/message { text, tenantId, channel, attachments? }
  → Agent Pipeline:
      1. Context Assembly — load user memory, recent conversation, tenant config
      2. Intent Classification — user shortcuts → regex fast path → LLM fallback
      3. Skill Resolution — match intent to skill from AbSkillManifest registry
      4. Skill Execution — call the skill's API endpoint with extracted parameters
      5. Response Formatting — return channel-agnostic response
      6. Learning — update user patterns, conversation memory, confidence scores
  → Response { message, actions?, chartData?, skillUsed, confidence }
  → Channel Adapter formats for Telegram HTML / Web markdown / etc.
```

**Location:** The `/agent/message` endpoint lives as an Express route in `plugins/agentbook-core/backend/src/server.ts` (port 4050). It uses the existing `db` Prisma client and `callGemini` helper. The Telegram adapter calls it via HTTP. The web AskBar calls it via the Next.js proxy.

## Data Models

### AbSkillManifest (new, plugin_agentbook_core schema)

Replaces the existing `AbAgentSkillBinding` for the agent brain. `AbAgentSkillBinding` continues to be used for the multi-agent system (bookkeeper/tax/collections/insights agents); `AbSkillManifest` is for the conversational agent brain specifically.

```prisma
model AbSkillManifest {
  id              String   @id @default(uuid())
  tenantId        String?                       // null = global (built-in), non-null = user-created
  name            String                        // unique skill identifier
  description     String                        // human-readable, used by LLM for routing
  category        String                        // bookkeeping | finance | invoicing | insights | planning
  triggerPatterns Json                           // string[] — regex patterns for fast-path matching
  parameters      Json                          // { paramName: { type, required, default?, extractHint } }
  endpoint        Json                          // { method, url, queryParams?: string[] }
  responseTemplate String?                      // mustache-style template for formatting response
  confirmBefore   Boolean  @default(false)      // ask user to confirm before executing
  postActions     Json?                         // actions to run after skill executes
  enabled         Boolean  @default(true)
  source          String   @default("built_in") // built_in | user_created | llm_generated
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([tenantId, name])
  @@index([tenantId, enabled])
  @@schema("plugin_agentbook_core")
}
```

**Endpoint field format:**
- For POST endpoints: `{ method: "POST", url: "/api/v1/agentbook-expense/expenses" }` — parameters go in request body
- For GET endpoints: `{ method: "GET", url: "/api/v1/agentbook-expense/advisor/chart", queryParams: ["startDate", "endDate", "chartType"] }` — `queryParams` lists which extracted parameters become URL query string parameters

### AbUserMemory (new, plugin_agentbook_core schema)

```prisma
model AbUserMemory {
  id          String   @id @default(uuid())
  tenantId    String
  key         String                        // e.g., "vendor_alias:cab", "preference:post_record"
  value       String                        // the learned value
  type        String                        // vendor_alias | category_default | preference | context | reminder | shortcut
  confidence  Float    @default(0.8)
  source      String   @default("learned")  // learned | user_stated | inferred
  usageCount  Int      @default(0)
  lastUsed    DateTime @default(now())
  expiresAt   DateTime?                     // for context/reminders that expire
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([tenantId, key])
  @@index([tenantId, type])
  @@schema("plugin_agentbook_core")
}
```

### AbConversation schema extension

Add two fields to the existing `AbConversation` model:

```prisma
// Add to existing AbConversation:
  channel     String   @default("web")      // web | telegram | api
  skillUsed   String?                       // which skill handled this message
```

No migration needed — these are nullable/defaulted additions. The existing `/ask` endpoint writes `queryType` which continues to work; the agent brain writes `skillUsed` in addition.

## Agent Pipeline (core plugin)

### Request/Response Contract

**Request:**
```typescript
POST /api/v1/agentbook-core/agent/message
{
  text: string,              // the user's message
  tenantId?: string,         // resolved from header if not in body
  channel: "telegram" | "web" | "api",
  attachments?: [{           // for photos/PDFs
    type: "photo" | "pdf" | "document",
    url: string              // permanent blob URL (adapter uploads before calling)
  }]
}
```

**Response:**
```typescript
{
  success: true,
  data: {
    message: string,           // response text (markdown)
    actions?: [{ label: string, type: string, payload?: any }],
    chartData?: { type: string, data: any[] },
    skillUsed: string,         // which skill handled the message
    confidence: number,        // 0-1 classification confidence
    followUp?: string,         // if agent needs more info
    confirmRequest?: {         // if skill has confirmBefore: true
      skillName: string,
      parameters: any,
      message: string          // "Create invoice for Acme $5000. Confirm?"
    }
  }
}
```

### 1. Context Assembly

```typescript
const context = {
  tenant: await db.abTenantConfig.findUnique({ where: { userId: tenantId } }),
  conversation: await db.abConversation.findMany({
    where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 10,
  }),
  memory: await db.abUserMemory.findMany({
    where: { tenantId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { lastUsed: 'desc' }, take: 50,
  }),
  skills: await db.abSkillManifest.findMany({
    where: { enabled: true, OR: [{ tenantId: null }, { tenantId }] },
  }),
};
```

### 2. Intent Classification

Three-stage cascade. **User shortcuts always checked first** (personalized beats generic):

**Stage 1: User memory shortcuts + aliases (<10ms)**
Check `AbUserMemory` entries of type `shortcut` and `vendor_alias`. If user has a shortcut "weekly report" → skill `query-expenses` with preset params, use it immediately.

**Stage 2: Regex fast path (<10ms)**
Check message against each skill's `triggerPatterns`. First match wins. For `record-expense`, also verify the message contains a dollar amount (prevents "show me expenses" from matching "expense" trigger).

**Stage 3: LLM classification (~500ms)**
Send to Gemini with all skill descriptions, recent conversation, and user memory. LLM returns `{ skill, parameters, confidence }` as JSON. If LLM fails or times out, fall back to `general-question` skill.

### 3. Skill Execution

Read the selected skill's manifest.

**For POST endpoints:** Call the URL with extracted parameters in the request body. Add `x-tenant-id` header.

**For GET endpoints:** Map extracted parameters to query string using the `queryParams` field. E.g., `expense-breakdown` with `{ startDate: "2026-01-01", chartType: "bar" }` → `GET /advisor/chart?startDate=2026-01-01&chartType=bar`.

**Special skill logic (handled in the agent, not the manifest):**

- `scan-receipt`: Before calling OCR, upload attachment to blob storage via `POST /receipts/upload-blob`. Pass the permanent URL to OCR.
- `create-invoice`: Before calling invoice creation, resolve client by name via `GET /clients` search. If not found, create client via `POST /clients`. Then create invoice with the resolved `clientId`.
- `record-expense`: Apply user memory vendor aliases (e.g., "cab" → "Uber") before sending to the expense API.

These are hardcoded pre-processing steps in the agent for skills that need multi-step orchestration. The manifest's `endpoint` is the final step.

**confirmBefore flow:** If the skill has `confirmBefore: true`, the agent does NOT execute. Instead it returns a `confirmRequest` in the response. The channel adapter shows a confirm/cancel UI. When the user confirms, the adapter calls `/agent/message` again with `{ text: "confirm", confirmSkill: "skill-name", confirmParams: {...} }`.

### 4. Response Formatting

Skill endpoint returns data. The agent formats it using:
1. The skill's `responseTemplate` if defined (e.g., `"Recorded: {{amountFormatted}} — {{description}}"`)
2. If no template: pass the raw data to Gemini with a prompt to format a natural response
3. If no LLM: return a basic JSON-to-text format

### 5. Learning (post-interaction)

After response is sent:
- Save to `AbConversation` with `channel`, `skillUsed`, `queryType: 'agent'`
- Log to `AbEvent` with `eventType: 'agent.message'`
- If the same vendor is categorized the same way 3+ times → upsert `AbUserMemory` type `category_default`
- If user corrects via callback → upsert `AbUserMemory` with correction, decrement confidence on wrong pattern

### Error Handling

| Error | Behavior |
|-------|----------|
| LLM timeout/failure | Fall back to regex-only classification. If no regex match, use `general-question` with template fallback. Never show LLM errors to user. |
| Skill endpoint non-2xx | Return friendly error: "I couldn't complete that action. Please try again." Log to AbEvent. |
| Parameter extraction failure | If required params missing, return `followUp`: "I need more info — what was the amount?" |
| Unknown intent (no skill match + LLM unsure) | Route to `general-question` skill which sends to `/core/ask` for best-effort answer. |

## Built-in Skill Manifests

Seeded via a `POST /api/v1/agentbook-core/agent/seed-skills` endpoint (idempotent — skips existing). Called during first setup or manually.

| Name | Category | Trigger Patterns | Endpoint | Notes |
|------|----------|-----------------|----------|-------|
| `record-expense` | bookkeeping | `["\\$\\d", "spent ", "paid ", "bought "]` | POST /expenses | Pre-process: resolve vendor aliases |
| `query-expenses` | bookkeeping | `["show.*expense", "list.*expense", "last \\d+ expense", "how much.*spen"]` | POST /advisor/ask | |
| `query-finance` | finance | `["balance", "revenue", "profit", "tax", "client.*owe", "outstanding"]` | POST /core/ask | |
| `scan-receipt` | bookkeeping | (attachment type=photo) | POST /receipts/ocr | Pre-process: upload blob first |
| `scan-document` | bookkeeping | (attachment type=pdf) | POST /receipts/ocr | Pre-process: upload blob first |
| `create-invoice` | invoicing | `["invoice .+ \\$"]` | POST /invoices | Pre-process: resolve client by name |
| `simulate-scenario` | planning | `["what if", "simulate", "scenario"]` | POST /simulate | |
| `proactive-alerts` | insights | `["alert", "notification", "check.?up", "anything.*know"]` | GET /advisor/proactive-alerts | queryParams: [] |
| `expense-breakdown` | insights | `["breakdown", "categor.*chart", "top.*spending"]` | GET /advisor/chart | queryParams: ["startDate","endDate","chartType"] |
| `general-question` | finance | (LLM fallback) | POST /core/ask | Always enabled, lowest priority |

## API Endpoints

### POST /api/v1/agentbook-core/agent/message
The agent brain. Described above.

### GET /api/v1/agentbook-core/agent/skills
List available skills for a tenant. Returns global + tenant-specific enabled skills.

### POST /api/v1/agentbook-core/agent/skills
Create a user-defined skill manifest. Validates required fields.

### POST /api/v1/agentbook-core/agent/seed-skills
Idempotent seeder for the 10 built-in skill manifests.

### GET /api/v1/agentbook-core/agent/memory
List user memory entries for a tenant. Optional filter by type.

### POST /api/v1/agentbook-core/agent/memory
Create or update a user memory entry.

### DELETE /api/v1/agentbook-core/agent/memory/:id
Delete a user memory entry.

## Channel Adapters

### Telegram Adapter (refactored webhook route)

~100 lines. Responsibilities:
1. Receive Telegram update
2. Resolve tenantId from chatId via `CHAT_TO_TENANT` (or DB lookup in production)
3. For photos/PDFs: upload to blob first, then pass attachment URL to agent
4. Call `POST /agent/message` via HTTP to localhost:4050
5. Format response: markdown → HTML, actions → InlineKeyboard, chartData → text bullets
6. Handle `confirmRequest`: show Confirm/Cancel keyboard
7. Handle callback queries: route confirm/reject/personal to agent or directly to expense API

### Web Adapter (AskBar rewired)

AskBar `onAsk()` calls `POST /api/v1/agentbook-core/agent/message` with `channel: 'web'`. Response rendered with existing `AdvisorResponse` component. The existing `/advisor/ask`, `/advisor/insights`, `/advisor/chart` endpoints remain for the proactive dashboard zone (auto-fetched on page load). Only the AskBar user input goes through the agent.

## Backward Compatibility

- All existing API endpoints remain unchanged — skills call them
- Existing `/advisor/ask`, `/core/ask`, `/simulate` still work directly
- Web dashboard's proactive insight cards + chart still fetch from `/advisor/insights` + `/advisor/chart`
- The agent endpoint is purely additive

## Testing

E2E tests in `tests/e2e/agent-brain.spec.ts`:

1. Agent message endpoint exists and responds
2. Seed skills endpoint creates 10 built-in skills
3. Skill registry lists built-in skills
4. Expense recording: "spent $45 on lunch" → expense created, skillUsed = "record-expense"
5. Expense query: "show last 5 expenses" → returns expense list, skillUsed = "query-expenses"
6. Finance query: "what's my balance?" → returns balance, skillUsed = "query-finance"
7. Invoice creation: "invoice Acme $5000 for consulting" → invoice created
8. Simulation: "what if I hire at $5K/mo" → returns projection
9. Proactive alerts: "any alerts?" → returns alerts
10. Unknown message falls back to general-question
11. User memory: create memory, verify it's used in next classification
12. Conversation continuity: ask question, then follow-up that requires context
13. Tenant isolation: different tenants have separate memory
14. Photo attachment: sends scan-receipt skill (mock attachment URL)
15. Error handling: invalid skill returns friendly error message
