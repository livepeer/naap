# Invoice Agent — Conversational Invoicing via Agent Brain

## Overview

Extend the agent brain v2 to support full invoice lifecycle management through Telegram and web. Users can create, review, approve, send, and track invoices conversationally. The agent uses multi-step planning for complex workflows (create → review → approve → send) and learns client/rate patterns over time.

**Reuse:** This builds entirely on the existing agent brain v2 architecture — same session model, same planner, same evaluator, same memory system. No new modules. Only new skill manifests and pre-processing handlers in `classifyAndExecuteV1()`.

## Gap Analysis: Current State vs Needed

### Already Wired to Agent
| Capability | Skill | Status |
|-----------|-------|--------|
| Create invoice | `create-invoice` | Partial — creates draft, resolves client by name, but no line item parsing beyond single amount |

### Invoice Plugin APIs NOT Wired to Agent (29 endpoints exist)

| API | Endpoint | Agent Capability Needed |
|-----|----------|----------------------|
| List invoices | GET `/invoices` | "Show my invoices" / "What's outstanding?" |
| Get invoice detail | GET `/invoices/:id` | "Show invoice INV-2026-0001" |
| Send invoice | POST `/invoices/:id/send` | "Send that invoice to the client" |
| Void invoice | POST `/invoices/:id/void` | "Cancel/void invoice INV-2026-0003" |
| Record payment | POST `/payments` | "Mark invoice paid" / "Got $5000 from Acme" |
| Aging report | GET `/aging-report` | "Who owes me money?" / "Show AR aging" |
| Create estimate | POST `/estimates` | "Create estimate for Acme, $3000 web design" |
| List estimates | GET `/estimates` | "Show my pending estimates" |
| Convert estimate | POST `/estimates/:id/convert` | "Convert that estimate to invoice" |
| Create client | POST `/clients` | "Add new client TechCorp" |
| List clients | GET `/clients` | "Show my clients" |
| Client detail | GET `/clients/:id` | "How much does Acme owe?" |
| Start timer | POST `/timer/start` | "Start timer for TechCorp" |
| Stop timer | POST `/timer/stop` | "Stop timer" |
| Timer status | GET `/timer/status` | "Is my timer running?" |
| Log time | POST `/time-entries` | "Log 2 hours for TechCorp project" |
| Unbilled summary | GET `/unbilled-summary` | "Show unbilled time" |
| Send reminder | POST `/invoices/:id/remind` | "Send reminder for overdue invoices" |
| Recurring invoices | POST `/recurring-invoices` | "Set up monthly invoice for Acme" |
| Generate recurring | POST `/recurring-invoices/generate` | "Generate due recurring invoices" |
| Credit note | POST `/credit-notes` | "Issue $500 credit on INV-2026-0001" |
| Invoice PDF | POST `/invoices/:id/pdf` | "Generate PDF for that invoice" |

### What the Agent Can't Do Today

1. **No invoice queries** — can't ask "what's outstanding?" or "show unpaid invoices"
2. **No send/void** — can't progress invoice lifecycle after creation
3. **No payment recording** — can't mark invoices as paid
4. **No estimate workflow** — can't create, approve, or convert estimates
5. **No time tracking** — can't start/stop timers or log billable hours
6. **No AR insights** — can't show aging, who owes, or overdue amounts
7. **No recurring setup** — can't create or manage recurring invoice schedules
8. **No reminders** — can't send payment reminders
9. **No multi-line invoices** — current `create-invoice` only supports single line item
10. **No invoice reference resolution** — can't resolve "that invoice" or "INV-2026-0001" from context

## Architecture

### Reuse Strategy

The invoice agent reuses 100% of the v2 infrastructure:

| Component | Reuse | New Work |
|-----------|-------|----------|
| Agent brain pipeline | As-is | None |
| Session management | As-is | None |
| Planner (complexity + LLM) | As-is | None |
| Evaluator (quality + suggestions) | Extend | Add invoice-specific quality checks |
| Memory system | As-is | Learn client→rate patterns |
| Telegram adapter | As-is | None (plan/eval formatting already works) |
| `classifyAndExecuteV1` | Extend | Add invoice pre-processing handlers |
| Skill manifests | Add new | 12 new skills |

### Multi-Step Invoice Workflows

These are the key conversational flows the agent enables:

**Flow 1: Create → Review → Send**
```
User: "Invoice Acme $5000 for consulting"
Agent: "Here's my plan:
  1. Create draft invoice for Acme — $5,000 (consulting)
  2. Show invoice for review
  3. Send to client via email
  Proceed? (yes/no)"
User: "yes"
Agent: "Plan complete (3/3 steps done, quality: 100%)
  ✓ Created INV-2026-0005 — $5,000 for Acme
  ✓ Invoice details: 1 line, due Apr 30
  ✓ Sent to acme@corp.com
  (Reply "undo" to void)"
```

**Flow 2: Estimate → Approve → Convert → Send**
```
User: "Create estimate for TechCorp, $3000 web redesign, then convert to invoice and send"
Agent: "Here's my plan:
  1. Create estimate for TechCorp — $3,000 (web redesign)
  2. Auto-approve estimate
  3. Convert estimate to invoice
  4. Send invoice to client
  Proceed?"
```

**Flow 3: Payment Recording**
```
User: "Got $5000 from Acme"
Agent: "Found invoice INV-2026-0005 for Acme ($5,000 outstanding). Recording payment..."
  → Records payment, marks invoice paid, logs journal entry
```

**Flow 4: Overdue Reminder Batch**
```
User: "Send reminders for overdue invoices"
Agent: "Here's my plan:
  1. Find overdue invoices
  2. Send gentle reminder to TechCorp (5 days overdue, $2,000)
  3. Send firm reminder to DesignCo (25 days overdue, $800)
  Proceed?"
```

**Flow 5: Unbilled Time → Invoice**
```
User: "Invoice all unbilled time for TechCorp"
Agent: "Here's my plan:
  1. Get unbilled time for TechCorp (12.5 hours at $150/hr)
  2. Create invoice for $1,875
  3. Mark time entries as billed
  4. Show invoice for review
  Proceed?"
```

## New Skills

### Query Skills (read-only)

```typescript
{
  name: 'query-invoices',
  description: 'List, search, or ask about invoices — outstanding, overdue, by client, by status',
  category: 'invoicing',
  triggerPatterns: ['show.*invoice', 'list.*invoice', 'outstanding', 'unpaid', 'overdue.*invoice', 'invoice.*status'],
  parameters: { status: { type: 'string', required: false }, clientName: { type: 'string', required: false } },
  endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/invoices', queryParams: ['status', 'clientId', 'limit'] },
}
```

```typescript
{
  name: 'aging-report',
  description: 'Show accounts receivable aging — who owes money and how overdue',
  category: 'invoicing',
  triggerPatterns: ['aging', 'who.*owe', 'accounts.*receivable', 'ar report', 'overdue.*client'],
  parameters: {},
  endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/aging-report' },
}
```

```typescript
{
  name: 'query-estimates',
  description: 'List estimates — pending, approved, converted',
  category: 'invoicing',
  triggerPatterns: ['show.*estimate', 'list.*estimate', 'pending.*estimate'],
  parameters: { status: { type: 'string', required: false } },
  endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/estimates', queryParams: ['status', 'clientId'] },
}
```

```typescript
{
  name: 'query-clients',
  description: 'List clients or show client details — billing history, outstanding balance',
  category: 'invoicing',
  triggerPatterns: ['show.*client', 'list.*client', 'client.*detail', 'client.*balance'],
  parameters: {},
  endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/clients' },
}
```

```typescript
{
  name: 'timer-status',
  description: 'Check if a timer is running and how long',
  category: 'invoicing',
  triggerPatterns: ['timer.*status', 'timer.*running', 'is.*timer', 'how long.*timer'],
  parameters: {},
  endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/timer/status' },
}
```

```typescript
{
  name: 'unbilled-summary',
  description: 'Show unbilled time by client — hours logged but not yet invoiced',
  category: 'invoicing',
  triggerPatterns: ['unbilled', 'not.*invoiced', 'billable.*time', 'hours.*not.*billed'],
  parameters: {},
  endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/unbilled-summary' },
}
```

### Action Skills (write operations)

```typescript
{
  name: 'send-invoice',
  description: 'Send a draft or created invoice to the client via email',
  category: 'invoicing',
  triggerPatterns: ['send.*invoice', 'email.*invoice', 'deliver.*invoice'],
  parameters: { invoiceId: { type: 'string', required: false, extractHint: 'invoice ID, number, or "last"' } },
  endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/invoices/:id/send' },
  confirmBefore: true,
}
```

```typescript
{
  name: 'record-payment',
  description: 'Record a payment received for an invoice',
  category: 'invoicing',
  triggerPatterns: ['got.*paid', 'received.*payment', 'record.*payment', 'paid.*\\$', 'got.*\\$.*from'],
  parameters: { invoiceId: { type: 'string', required: false }, amountCents: { type: 'number', required: false }, clientName: { type: 'string', required: false }, method: { type: 'string', required: false, default: 'manual' } },
  endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/payments' },
  confirmBefore: true,
}
```

```typescript
{
  name: 'create-estimate',
  description: 'Create a project estimate for a client',
  category: 'invoicing',
  triggerPatterns: ['estimate.*\\$', 'quote.*\\$', 'proposal.*\\$'],
  parameters: { clientName: { type: 'string', required: true }, amountCents: { type: 'number', required: true }, description: { type: 'string', required: true } },
  endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/estimates' },
}
```

```typescript
{
  name: 'start-timer',
  description: 'Start a time tracking timer for a project or client',
  category: 'invoicing',
  triggerPatterns: ['start.*timer', 'track.*time', 'clock.*in', 'begin.*timer'],
  parameters: { description: { type: 'string', required: false }, clientName: { type: 'string', required: false }, projectName: { type: 'string', required: false } },
  endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/timer/start' },
}
```

```typescript
{
  name: 'stop-timer',
  description: 'Stop the running time tracker',
  category: 'invoicing',
  triggerPatterns: ['stop.*timer', 'clock.*out', 'end.*timer', 'pause.*timer'],
  parameters: {},
  endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/timer/stop' },
}
```

```typescript
{
  name: 'send-reminder',
  description: 'Send payment reminder for overdue invoices',
  category: 'invoicing',
  triggerPatterns: ['remind', 'send.*reminder', 'follow.*up.*invoice', 'chase.*payment', 'nudge'],
  parameters: { invoiceId: { type: 'string', required: false, extractHint: 'invoice ID or "all overdue"' } },
  endpoint: { method: 'INTERNAL', url: '' },
}
```

## Pre-Processing Handlers

Add to `classifyAndExecuteV1()` in server.ts, alongside existing `create-invoice` and `categorize-expenses` handlers:

### send-invoice: Resolve invoice reference

```typescript
if (selectedSkill.name === 'send-invoice') {
  // Resolve "last", "that invoice", or INV-YYYY-NNNN
  let invoiceId = extractedParams.invoiceId;
  if (!invoiceId || invoiceId === 'last') {
    // Find most recent draft invoice
    const invoices = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices?status=draft&limit=1`, { headers: H });
    const data = await invoices.json();
    invoiceId = data.data?.[0]?.id;
  } else if (invoiceId.startsWith('INV-')) {
    // Look up by invoice number
    const invoices = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices`, { headers: H });
    const data = await invoices.json();
    const match = data.data?.find((i: any) => i.number === invoiceId);
    invoiceId = match?.id;
  }
  if (invoiceId) {
    targetUrl = targetUrl.replace(':id', invoiceId);
    extractedParams = {}; // send endpoint takes no body
  }
}
```

### record-payment: Resolve client → invoice → amount

```typescript
if (selectedSkill.name === 'record-payment') {
  // If client name given but no invoiceId, find their outstanding invoice
  if (extractedParams.clientName && !extractedParams.invoiceId) {
    const clients = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/clients`, { headers: H });
    const clientData = await clients.json();
    const client = clientData.data?.find((c: any) => c.name.toLowerCase().includes(extractedParams.clientName.toLowerCase()));
    if (client) {
      const invoices = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices?clientId=${client.id}&status=sent`, { headers: H });
      const invData = await invoices.json();
      const outstanding = invData.data?.[0];
      if (outstanding) {
        extractedParams.invoiceId = outstanding.id;
        if (!extractedParams.amountCents) {
          // Default to full amount
          const paidSoFar = outstanding.payments?.reduce((s: number, p: any) => s + p.amountCents, 0) || 0;
          extractedParams.amountCents = outstanding.amountCents - paidSoFar;
        }
      }
    }
    delete extractedParams.clientName; // payments endpoint doesn't accept clientName
  }
}
```

### create-estimate: Resolve client

```typescript
if (selectedSkill.name === 'create-estimate' && extractedParams.clientName) {
  // Same client resolution as create-invoice
  const client = await resolveOrCreateClient(invoiceBase, tenantId, extractedParams.clientName);
  if (client) {
    extractedParams.clientId = client.id;
    delete extractedParams.clientName;
  }
}
```

### start-timer: Resolve client/project

```typescript
if (selectedSkill.name === 'start-timer') {
  if (extractedParams.clientName) {
    const client = await resolveOrCreateClient(invoiceBase, tenantId, extractedParams.clientName);
    if (client) {
      extractedParams.clientId = client.id;
      delete extractedParams.clientName;
    }
  }
  if (extractedParams.projectName) {
    const projects = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/projects`, { headers: H });
    const projData = await projects.json();
    const project = projData.data?.find((p: any) => p.name.toLowerCase().includes(extractedParams.projectName.toLowerCase()));
    if (project) {
      extractedParams.projectId = project.id;
      delete extractedParams.projectName;
    }
  }
}
```

### send-reminder: INTERNAL handler (batch overdue)

```typescript
if (selectedSkill.name === 'send-reminder') {
  // If specific invoice, send reminder for it
  // If "all overdue", find overdue invoices and send reminders for each
  if (!extractedParams.invoiceId || extractedParams.invoiceId === 'all') {
    const invoices = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices?status=overdue`, { headers: H });
    const data = await invoices.json();
    const overdue = data.data || [];
    let sent = 0;
    const results: string[] = [];
    for (const inv of overdue.slice(0, 10)) {
      const res = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices/${inv.id}/remind`, { method: 'POST', headers: H });
      const r = await res.json();
      if (r.success) {
        sent++;
        results.push(`${inv.number} — ${inv.client?.name} ($${(inv.amountCents / 100).toFixed(2)})`);
      }
    }
    return earlyReturn({ message: `Sent ${sent} payment reminders:\n${results.join('\n')}`, skillUsed: 'send-reminder' });
  }
}
```

### query-invoices: Resolve client name to clientId

```typescript
if (selectedSkill.name === 'query-invoices' && extractedParams.clientName) {
  const client = await resolveClient(invoiceBase, tenantId, extractedParams.clientName);
  if (client) {
    extractedParams.clientId = client.id;
    delete extractedParams.clientName;
  }
}
```

## Shared Helper: resolveOrCreateClient

Extract the existing client resolution from `create-invoice` handler into a reusable function:

```typescript
async function resolveOrCreateClient(invoiceBase: string, tenantId: string, clientName: string): Promise<any> {
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
  const clientsRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/clients`, { headers: H });
  const clientsData = await clientsRes.json();
  let client = (clientsData.data || []).find((c: any) => c.name.toLowerCase().includes(clientName.toLowerCase()));
  if (!client) {
    const createRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/clients`, {
      method: 'POST', headers: H, body: JSON.stringify({ name: clientName }),
    });
    client = ((await createRes.json()) as any).data;
  }
  return client;
}

async function resolveClient(invoiceBase: string, tenantId: string, clientName: string): Promise<any> {
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
  const clientsRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/clients`, { headers: H });
  const clientsData = await clientsRes.json();
  return (clientsData.data || []).find((c: any) => c.name.toLowerCase().includes(clientName.toLowerCase())) || null;
}
```

## Evaluator Extensions

Add invoice-specific quality checks to `assessStepQuality` in `agent-evaluator.ts`:

```typescript
if (step.action === 'create-invoice' || step.action === 'create-estimate') {
  if (!data?.number && !data?.id) { score -= 0.5; issues.push('Invoice/estimate not created'); }
  if (!data?.clientId) { score -= 0.2; issues.push('No client resolved'); }
}

if (step.action === 'send-invoice') {
  if (!data?.emailSent) { score -= 0.3; issues.push('Email not sent (client may lack email address)'); }
}

if (step.action === 'record-payment') {
  if (data?.amountCents === 0) { score -= 0.5; issues.push('Zero payment recorded'); }
}
```

## Memory & Learning

The existing memory system learns invoice patterns automatically:

| Pattern | Memory Key | Learned When |
|---------|-----------|-------------|
| Client hourly rate | `client_rate:acme` | After 3+ invoices at same rate |
| Client payment terms | `client_terms:acme` | After 3+ invoices with same terms |
| Common line descriptions | `invoice_desc:consulting` | After 3+ uses of same description |

Implementation: Add to `learnFromInteraction()` in `agent-memory.ts`:

```typescript
if (skillUsed === 'create-invoice' && result?.success && result.data?.clientId) {
  const lines = result.data.lines || [];
  if (lines.length > 0) {
    const rate = lines[0].rateCents;
    const key = `client_rate:${result.data.clientId}`;
    // Same upsert pattern as vendor_category
  }
}
```

## Response Formatting

Add invoice-specific response formatting in `classifyAndExecuteV1()`:

```typescript
// Invoice detail
if (data?.number && data?.amountCents !== undefined && data?.status) {
  message = `**${data.number}** — $${(data.amountCents / 100).toFixed(2)}`;
  message += `\nClient: ${data.client?.name || 'Unknown'}`;
  message += `\nStatus: ${data.status}`;
  message += `\nDue: ${data.dueDate ? new Date(data.dueDate).toLocaleDateString() : 'N/A'}`;
  if (data.lines?.length) {
    message += '\n\nLine items:';
    data.lines.forEach((l: any) => {
      message += `\n- ${l.description}: ${l.quantity}x $${(l.rateCents / 100).toFixed(2)} = $${(l.amountCents / 100).toFixed(2)}`;
    });
  }
}

// Invoice list
if (Array.isArray(data) && data[0]?.number) {
  message = data.slice(0, 10).map((inv: any) => {
    const status = inv.status === 'paid' ? '\u2705' : inv.status === 'overdue' ? '\u{1F534}' : '\u{1F7E1}';
    return `${status} ${inv.number} — $${(inv.amountCents / 100).toFixed(2)} (${inv.client?.name || 'Unknown'}) [${inv.status}]`;
  }).join('\n');
  if (data.length > 10) message += `\n...and ${data.length - 10} more.`;
}

// Aging report
if (data?.buckets) {
  message = '**Accounts Receivable Aging**\n';
  for (const bucket of data.buckets) {
    if (bucket.totalCents > 0) {
      message += `\n**${bucket.label}**: $${(bucket.totalCents / 100).toFixed(2)} (${bucket.invoices.length} invoices)`;
    }
  }
  message += `\n\n**Total Outstanding:** $${(data.totalOutstandingCents / 100).toFixed(2)}`;
}

// Timer status
if (data?.running !== undefined) {
  message = data.running
    ? `Timer running: ${data.entry?.description || 'untitled'} (${data.elapsedMinutes} min)`
    : 'No timer running.';
}
```

## Backward Compatibility

- All existing 16 skills continue to work unchanged
- `create-invoice` skill gets enhanced pre-processing (multi-line support) but same endpoint
- No changes to agent-brain.ts, agent-planner.ts, or agent-memory.ts modules
- New skills are additive — seeded via `POST /agent/seed-skills`
- Telegram adapter needs no changes (plan/eval formatting already handles invoice flows)

## Testing

E2E tests in `tests/e2e/agent-invoice.spec.ts`:

1. query-invoices: "show my invoices" → returns invoice list
2. query-invoices with status: "show unpaid invoices" → filters by status
3. create-invoice: "invoice Acme $5000 for consulting" → creates draft
4. send-invoice: "send that invoice" → marks as sent
5. record-payment: "got $5000 from Acme" → records payment, marks paid
6. aging-report: "who owes me money?" → returns aging buckets
7. create-estimate: "estimate TechCorp $3000 web design" → creates estimate
8. query-estimates: "show pending estimates" → returns list
9. start-timer: "start timer for TechCorp" → timer starts
10. stop-timer: "stop timer" → timer stops with duration
11. timer-status: "is my timer running?" → returns status
12. unbilled-summary: "show unbilled time" → returns summary
13. send-reminder: "send reminders for overdue invoices" → batch send
14. query-clients: "show my clients" → returns client list
15. Multi-step: "invoice Acme $5000 and send it" → plan with 2 steps

## Implementation Phases

**Phase 1: Query Skills (read-only, low risk)**
- Add 6 query skill manifests (query-invoices, aging-report, query-estimates, query-clients, timer-status, unbilled-summary)
- Add response formatting for invoice lists, aging, timer
- Add to seed, test routing

**Phase 2: Action Skills + Pre-processing**
- Add 6 action skill manifests (send-invoice, record-payment, create-estimate, start-timer, stop-timer, send-reminder)
- Extract `resolveOrCreateClient` helper
- Add pre-processing handlers for each action skill
- Add send-reminder INTERNAL handler

**Phase 3: Evaluator + Memory + Tests**
- Add invoice-specific quality checks to evaluator
- Add client rate/terms learning to memory
- Write 15 E2E tests
- Verify all 28 existing tests still pass
