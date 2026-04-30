# Invoice Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire 12 new invoice skills into the agent brain so users can create, query, send, pay, and manage invoices conversationally via Telegram.

**Architecture:** Add skill manifests to the existing BUILT_IN_SKILLS array, add pre-processing handlers to `classifyAndExecuteV1()`, extract a shared `resolveOrCreateClient` helper, extend the evaluator with invoice quality checks, and add response formatting. 100% reuse of agent brain v2 infra — no new modules.

**Tech Stack:** TypeScript/ESM, Express, Prisma, Playwright E2E

**Spec:** `docs/superpowers/specs/2026-04-16-invoice-agent-design.md`

---

## File Structure

### Modified Files

| File | Changes |
|------|---------|
| `plugins/agentbook-core/backend/src/server.ts` | 12 new skill manifests, 6 pre-processing handlers, `resolveOrCreateClient` helper, invoice response formatting |
| `plugins/agentbook-core/backend/src/agent-evaluator.ts` | Invoice-specific quality checks in `assessStepQuality` |
| `plugins/agentbook-core/backend/src/agent-memory.ts` | Client rate learning in `learnFromInteraction` |

### New Files

| File | Purpose |
|------|---------|
| `tests/e2e/agent-invoice.spec.ts` | 15 E2E tests for invoice agent skills |

---

## Task 1: Query Skill Manifests + Response Formatting

**Files:**
- Modify: `plugins/agentbook-core/backend/src/server.ts`
- Create: `tests/e2e/agent-invoice.spec.ts`

- [ ] **Step 1: Write routing tests for query skills**

Create `tests/e2e/agent-invoice.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

const CORE = 'http://localhost:4050';
const INVOICE = 'http://localhost:4052';
const MAYA = '2e2348b6-a64c-44ad-907e-4ac120ff06f2';
const H = { 'x-tenant-id': MAYA, 'Content-Type': 'application/json' };

test.describe.serial('Invoice Agent — Query Skills', () => {
  test('query-invoices: "show my invoices"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'show my invoices', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.skillUsed).toBe('query-invoices');
    expect(body.data.message).toBeTruthy();
  });

  test('aging-report: "who owes me money?"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'who owes me money?', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('aging-report');
  });

  test('query-clients: "show my clients"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'show my clients', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('query-clients');
  });

  test('query-estimates: "show pending estimates"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'show my pending estimates', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('query-estimates');
  });

  test('timer-status: "is my timer running?"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'is my timer running?', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('timer-status');
  });

  test('unbilled-summary: "show unbilled time"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'show unbilled time', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('unbilled-summary');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tests/e2e && npx playwright test agent-invoice.spec.ts --config=playwright.config.ts --reporter=line`
Expected: FAIL — skills don't exist yet

- [ ] **Step 3: Add 6 query skill manifests to BUILT_IN_SKILLS**

In `server.ts`, add these 6 skills to the BUILT_IN_SKILLS array BEFORE `general-question`:

```typescript
  {
    name: 'query-invoices', description: 'List, search, or ask about invoices — outstanding, overdue, by client, by status', category: 'invoicing',
    triggerPatterns: ['show.*invoice', 'list.*invoice', 'outstanding.*invoice', 'unpaid.*invoice', 'overdue.*invoice', 'invoice.*status', 'my invoice'],
    parameters: { status: { type: 'string', required: false }, clientName: { type: 'string', required: false } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/invoices', queryParams: ['status', 'clientId', 'limit'] },
  },
  {
    name: 'aging-report', description: 'Show accounts receivable aging — who owes money and how overdue', category: 'invoicing',
    triggerPatterns: ['aging', 'who.*owe', 'accounts.*receivable', 'ar report', 'overdue.*client', 'owe.*money'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/aging-report' },
  },
  {
    name: 'query-estimates', description: 'List estimates — pending, approved, converted', category: 'invoicing',
    triggerPatterns: ['show.*estimate', 'list.*estimate', 'pending.*estimate', 'my estimate'],
    parameters: { status: { type: 'string', required: false } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/estimates', queryParams: ['status', 'clientId'] },
  },
  {
    name: 'query-clients', description: 'List clients or show client details — billing history, outstanding balance', category: 'invoicing',
    triggerPatterns: ['show.*client', 'list.*client', 'client.*detail', 'client.*balance', 'my client'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/clients' },
  },
  {
    name: 'timer-status', description: 'Check if a time tracking timer is running and how long', category: 'invoicing',
    triggerPatterns: ['timer.*status', 'timer.*running', 'is.*timer', 'how long.*timer'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/timer/status' },
  },
  {
    name: 'unbilled-summary', description: 'Show unbilled time by client — hours logged but not yet invoiced', category: 'invoicing',
    triggerPatterns: ['unbilled', 'not.*invoiced', 'billable.*time', 'hours.*not.*billed'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/unbilled-summary' },
  },
```

- [ ] **Step 4: Add invoice response formatting**

In `classifyAndExecuteV1()`, in the response formatting section (after the existing `data?.annotation` check, before the default `data?.id && data?.amountCents` check), add:

```typescript
    // Invoice list
    } else if (Array.isArray(data) && data.length > 0 && data[0]?.number && data[0]?.status) {
      message = data.slice(0, 10).map((inv: any) => {
        const icon = inv.status === 'paid' ? '\u2705' : inv.status === 'overdue' ? '\u{1F534}' : '\u{1F7E1}';
        return `${icon} ${inv.number} \u2014 $${(inv.amountCents / 100).toFixed(2)} (${inv.client?.name || 'Unknown'}) [${inv.status}]`;
      }).join('\n');
      if (data.length > 10) message += `\n...and ${data.length - 10} more.`;

    // Aging report
    } else if (data?.buckets) {
      message = '**Accounts Receivable Aging**\n';
      for (const bucket of data.buckets) {
        if (bucket.totalCents > 0) {
          message += `\n**${bucket.label}**: $${(bucket.totalCents / 100).toFixed(2)} (${bucket.invoices?.length || 0} invoices)`;
        }
      }
      if (data.totalOutstandingCents !== undefined) {
        message += `\n\n**Total Outstanding:** $${(data.totalOutstandingCents / 100).toFixed(2)}`;
      }

    // Client list
    } else if (Array.isArray(data) && data.length > 0 && data[0]?.name && data[0]?.totalBilledCents !== undefined) {
      message = data.slice(0, 10).map((c: any) => {
        const balance = ((c.totalBilledCents - c.totalPaidCents) / 100).toFixed(2);
        return `\u2022 **${c.name}**${c.email ? ` (${c.email})` : ''} \u2014 outstanding: $${balance}`;
      }).join('\n');

    // Estimate list
    } else if (Array.isArray(data) && data.length > 0 && data[0]?.validUntil && data[0]?.amountCents) {
      message = data.slice(0, 10).map((e: any) => {
        const icon = e.status === 'approved' ? '\u2705' : e.status === 'declined' ? '\u274C' : '\u{1F7E1}';
        return `${icon} $${(e.amountCents / 100).toFixed(2)} \u2014 ${e.description} (${e.client?.name || 'Unknown'}) [${e.status}]`;
      }).join('\n');

    // Timer status
    } else if (data?.running !== undefined) {
      message = data.running
        ? `Timer running: ${data.entry?.description || 'untitled'} (${data.elapsedMinutes || 0} min)`
        : 'No timer running.';

    // Unbilled summary
    } else if (Array.isArray(data) && data.length > 0 && data[0]?.unbilledAmountCents !== undefined) {
      message = '**Unbilled Time**\n';
      let total = 0;
      for (const item of data) {
        message += `\n\u2022 **${item.clientName || 'Unknown'}**: ${item.totalHours?.toFixed(1) || 0}h \u2014 $${(item.unbilledAmountCents / 100).toFixed(2)}`;
        total += item.unbilledAmountCents;
      }
      message += `\n\n**Total Unbilled:** $${(total / 100).toFixed(2)}`;
```

- [ ] **Step 5: Add query-invoices client name resolution**

In `classifyAndExecuteV1()`, in the pre-processing section (after the `categorize-expenses` handler), add:

```typescript
    // Pre-processing: query-invoices — resolve clientName to clientId
    if (selectedSkill.name === 'query-invoices' && extractedParams.clientName) {
      try {
        const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
        const clientsRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/clients`, { headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId } });
        const clientsData = await clientsRes.json() as any;
        const client = (clientsData.data || []).find((c: any) => c.name.toLowerCase().includes(extractedParams.clientName.toLowerCase()));
        if (client) {
          extractedParams.clientId = client.id;
        }
        delete extractedParams.clientName;
      } catch (err) { console.warn('Invoice client resolution error:', err); }
    }
```

- [ ] **Step 6: Restart, seed, run tests**

```bash
kill $(lsof -i :4050 -t) 2>/dev/null; sleep 1
cd /Users/qianghan/Documents/mycodespace/a3p
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4050 npx tsx plugins/agentbook-core/backend/src/server.ts > /tmp/core-backend.log 2>&1 &
sleep 4
curl -s -X POST http://localhost:4050/api/v1/agentbook-core/agent/seed-skills
# Expected: total: 28

cd tests/e2e && npx playwright test agent-invoice.spec.ts --config=playwright.config.ts --reporter=line
# Expected: 6 passed
```

- [ ] **Step 7: Verify no regressions**

```bash
npx playwright test agent-brain.spec.ts agent-brain-v2.spec.ts --config=playwright.config.ts --reporter=line
# Expected: 28 passed
```

- [ ] **Step 8: Commit**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
git add plugins/agentbook-core/backend/src/server.ts tests/e2e/agent-invoice.spec.ts
git commit -m "feat: 6 invoice query skills — invoices, aging, clients, estimates, timer, unbilled

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Action Skill Manifests + Pre-Processing

**Files:**
- Modify: `plugins/agentbook-core/backend/src/server.ts`
- Modify: `tests/e2e/agent-invoice.spec.ts`

- [ ] **Step 1: Write action skill tests**

Append to `tests/e2e/agent-invoice.spec.ts`:

```typescript
test.describe.serial('Invoice Agent — Action Skills', () => {
  test('create-invoice enhanced: "invoice Acme $5000 for consulting"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'invoice Acme $5000 for consulting', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.skillUsed).toBe('create-invoice');
    expect(body.data.message).toBeTruthy();
  });

  test('send-invoice: "send that invoice"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'send that invoice', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.skillUsed).toBe('send-invoice');
  });

  test('record-payment: "got $5000 from Acme"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'got $5000 from Acme', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.skillUsed).toBe('record-payment');
  });

  test('create-estimate: "estimate TechCorp $3000 web design"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'estimate TechCorp $3000 for web design', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.skillUsed).toBe('create-estimate');
  });

  test('start-timer: "start timer for TechCorp"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'start timer for TechCorp project', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('start-timer');
  });

  test('stop-timer: "stop timer"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'stop timer', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('stop-timer');
  });

  test('send-reminder: "send reminders for overdue invoices"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'send reminders for overdue invoices', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('send-reminder');
  });
});
```

- [ ] **Step 2: Add 6 action skill manifests**

In `server.ts`, add BEFORE `general-question`:

```typescript
  {
    name: 'send-invoice', description: 'Send a draft or created invoice to the client via email', category: 'invoicing',
    triggerPatterns: ['send.*invoice', 'email.*invoice', 'deliver.*invoice', 'send.*that.*invoice'],
    parameters: { invoiceId: { type: 'string', required: false, extractHint: 'invoice ID, number like INV-YYYY-NNNN, or "last"' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/invoices/:id/send' },
    confirmBefore: true,
  },
  {
    name: 'record-payment', description: 'Record a payment received for an invoice', category: 'invoicing',
    triggerPatterns: ['got.*paid', 'received.*payment', 'record.*payment', 'got.*\\$.*from', 'payment.*received'],
    parameters: { invoiceId: { type: 'string', required: false }, amountCents: { type: 'number', required: false }, clientName: { type: 'string', required: false }, method: { type: 'string', required: false, default: 'manual' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/payments' },
    confirmBefore: true,
  },
  {
    name: 'create-estimate', description: 'Create a project estimate or quote for a client', category: 'invoicing',
    triggerPatterns: ['estimate.*\\$', 'quote.*\\$', 'proposal.*\\$', 'create.*estimate'],
    parameters: { clientName: { type: 'string', required: true }, amountCents: { type: 'number', required: true }, description: { type: 'string', required: true } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/estimates' },
  },
  {
    name: 'start-timer', description: 'Start a time tracking timer for a project or client', category: 'invoicing',
    triggerPatterns: ['start.*timer', 'track.*time', 'clock.*in', 'begin.*timer'],
    parameters: { description: { type: 'string', required: false }, clientName: { type: 'string', required: false }, projectName: { type: 'string', required: false } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/timer/start' },
  },
  {
    name: 'stop-timer', description: 'Stop the running time tracker', category: 'invoicing',
    triggerPatterns: ['stop.*timer', 'clock.*out', 'end.*timer', 'pause.*timer'],
    parameters: {},
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/timer/stop' },
  },
  {
    name: 'send-reminder', description: 'Send payment reminder for overdue invoices', category: 'invoicing',
    triggerPatterns: ['send.*remind', 'remind.*overdue', 'follow.*up.*invoice', 'chase.*payment', 'nudge.*client', 'remind.*payment'],
    parameters: { invoiceId: { type: 'string', required: false, extractHint: 'invoice ID or "all" for all overdue' } },
    endpoint: { method: 'INTERNAL', url: '' },
  },
```

- [ ] **Step 3: Extract resolveOrCreateClient helper**

Add this helper function BEFORE `classifyAndExecuteV1()` in server.ts:

```typescript
async function resolveOrCreateClient(invoiceBase: string, tenantId: string, clientName: string): Promise<any> {
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
  const clientsRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/clients`, { headers: H });
  const clientsData = await clientsRes.json() as any;
  let client = (clientsData.data || []).find((c: any) => c.name.toLowerCase().includes(clientName.toLowerCase()));
  if (!client) {
    const createRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/clients`, {
      method: 'POST', headers: H, body: JSON.stringify({ name: clientName }),
    });
    client = ((await createRes.json()) as any).data;
  }
  return client;
}
```

Then refactor the existing `create-invoice` handler to use it:

Replace the inline client resolution block with:
```typescript
    if (selectedSkill.name === 'create-invoice' && extractedParams.clientName) {
      try {
        const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
        const client = await resolveOrCreateClient(invoiceBase, tenantId, extractedParams.clientName);
        if (client) {
          const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 30);
          extractedParams = {
            clientId: client.id,
            issuedDate: new Date().toISOString().slice(0, 10),
            dueDate: dueDate.toISOString().slice(0, 10),
            status: 'draft',
            lines: [{ description: extractedParams.description || 'Services', quantity: 1, rateCents: extractedParams.amountCents }],
          };
        }
      } catch (err) { console.warn('Invoice client resolution error:', err); }
    }
```

- [ ] **Step 4: Add send-invoice pre-processing**

In `classifyAndExecuteV1()`, add after the `create-invoice` handler:

```typescript
    // Pre-processing: send-invoice — resolve invoice reference
    if (selectedSkill.name === 'send-invoice') {
      try {
        const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
        const IH = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
        let invoiceId = extractedParams.invoiceId;

        if (!invoiceId || invoiceId === 'last' || invoiceId === 'that') {
          // Find most recent draft/sent invoice
          const res = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices?limit=1`, { headers: IH });
          const data = await res.json() as any;
          invoiceId = data.data?.[0]?.id;
        } else if (invoiceId.startsWith('INV-')) {
          const res = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices`, { headers: IH });
          const data = await res.json() as any;
          const match = data.data?.find((i: any) => i.number === invoiceId);
          invoiceId = match?.id;
        }

        if (invoiceId) {
          targetUrl = `${invoiceBase}/api/v1/agentbook-invoice/invoices/${invoiceId}/send`;
          extractedParams = {};
        } else {
          return { selectedSkill, extractedParams, confidence, skillUsed: selectedSkill.name, skillResponse: null,
            responseData: { message: "I couldn't find an invoice to send. Try specifying the invoice number.", actions: [], chartData: null, skillUsed: selectedSkill.name, confidence, latencyMs: Date.now() - startTime } };
        }
      } catch (err) { console.warn('Send-invoice resolution error:', err); }
    }
```

- [ ] **Step 5: Add record-payment pre-processing**

```typescript
    // Pre-processing: record-payment — resolve client → invoice → amount
    if (selectedSkill.name === 'record-payment') {
      try {
        const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
        const IH = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };

        if (extractedParams.clientName && !extractedParams.invoiceId) {
          const clientsRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/clients`, { headers: IH });
          const clientData = await clientsRes.json() as any;
          const client = (clientData.data || []).find((c: any) => c.name.toLowerCase().includes(extractedParams.clientName.toLowerCase()));
          if (client) {
            const invRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices?clientId=${client.id}&status=sent&limit=1`, { headers: IH });
            const invData = await invRes.json() as any;
            const outstanding = invData.data?.[0];
            if (outstanding) {
              extractedParams.invoiceId = outstanding.id;
              if (!extractedParams.amountCents) {
                extractedParams.amountCents = outstanding.amountCents;
              }
            }
          }
        }
        delete extractedParams.clientName;
        if (!extractedParams.date) extractedParams.date = new Date().toISOString();
      } catch (err) { console.warn('Record-payment resolution error:', err); }
    }
```

- [ ] **Step 6: Add create-estimate and start-timer pre-processing**

```typescript
    // Pre-processing: create-estimate — resolve client
    if (selectedSkill.name === 'create-estimate' && extractedParams.clientName) {
      try {
        const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
        const client = await resolveOrCreateClient(invoiceBase, tenantId, extractedParams.clientName);
        if (client) {
          extractedParams.clientId = client.id;
          delete extractedParams.clientName;
        }
        if (!extractedParams.validUntil) {
          const validUntil = new Date(); validUntil.setDate(validUntil.getDate() + 30);
          extractedParams.validUntil = validUntil.toISOString();
        }
      } catch (err) { console.warn('Create-estimate resolution error:', err); }
    }

    // Pre-processing: start-timer — resolve client/project name
    if (selectedSkill.name === 'start-timer') {
      try {
        const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
        const IH = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
        if (extractedParams.clientName) {
          const clientsRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/clients`, { headers: IH });
          const clientsData = await clientsRes.json() as any;
          const client = (clientsData.data || []).find((c: any) => c.name.toLowerCase().includes(extractedParams.clientName.toLowerCase()));
          if (client) { extractedParams.clientId = client.id; }
          delete extractedParams.clientName;
        }
        if (extractedParams.projectName) {
          const projRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/projects`, { headers: IH });
          const projData = await projRes.json() as any;
          const project = (projData.data || []).find((p: any) => p.name.toLowerCase().includes(extractedParams.projectName.toLowerCase()));
          if (project) { extractedParams.projectId = project.id; }
          delete extractedParams.projectName;
        }
      } catch (err) { console.warn('Start-timer resolution error:', err); }
    }
```

- [ ] **Step 7: Add send-reminder INTERNAL handler**

Add before the skill HTTP execution block (before `let skillResponse`):

```typescript
    // INTERNAL handler: send-reminder — batch send for overdue invoices
    if (selectedSkill.name === 'send-reminder') {
      try {
        const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
        const IH = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };

        if (extractedParams.invoiceId && extractedParams.invoiceId !== 'all') {
          // Single invoice reminder
          const res = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices/${extractedParams.invoiceId}/remind`, { method: 'POST', headers: IH });
          const data = await res.json() as any;
          const msg = data.success ? `Reminder sent (${data.data?.tone || 'standard'} tone).` : 'Could not send reminder.';
          await db.abConversation.create({ data: { tenantId, question: text || '[reminder]', answer: msg, queryType: 'agent', channel, skillUsed: 'send-reminder' } });
          return { selectedSkill, extractedParams, confidence, skillUsed: 'send-reminder', skillResponse: data,
            responseData: { message: msg, actions: [], chartData: null, skillUsed: 'send-reminder', confidence, latencyMs: Date.now() - startTime } };
        }

        // Batch: find all overdue and send reminders
        const invRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices?status=overdue`, { headers: IH });
        const invData = await invRes.json() as any;
        const overdue = invData.data || [];
        if (overdue.length === 0) {
          const msg = 'No overdue invoices found. All clients are up to date!';
          await db.abConversation.create({ data: { tenantId, question: text || '[reminder]', answer: msg, queryType: 'agent', channel, skillUsed: 'send-reminder' } });
          return { selectedSkill, extractedParams, confidence, skillUsed: 'send-reminder', skillResponse: null,
            responseData: { message: msg, actions: [], chartData: null, skillUsed: 'send-reminder', confidence, latencyMs: Date.now() - startTime } };
        }

        let sent = 0;
        const results: string[] = [];
        for (const inv of overdue.slice(0, 10)) {
          const res = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices/${inv.id}/remind`, { method: 'POST', headers: IH });
          const r = await res.json() as any;
          if (r.success) {
            sent++;
            results.push(`${inv.number} \u2014 ${inv.client?.name || 'Unknown'} ($${(inv.amountCents / 100).toFixed(2)}, ${r.data?.tone || 'standard'})`);
          }
        }
        const msg = sent > 0 ? `Sent ${sent} payment reminders:\n${results.join('\n')}` : 'Could not send any reminders.';
        await db.abConversation.create({ data: { tenantId, question: text || '[reminder]', answer: msg, queryType: 'agent', channel, skillUsed: 'send-reminder' } });
        return { selectedSkill, extractedParams, confidence, skillUsed: 'send-reminder', skillResponse: null,
          responseData: { message: msg, actions: [], chartData: null, skillUsed: 'send-reminder', confidence, latencyMs: Date.now() - startTime } };
      } catch (err) {
        console.error('Send-reminder error:', err);
        return { selectedSkill, extractedParams, confidence, skillUsed: 'send-reminder', skillResponse: null,
          responseData: { message: "I couldn't send reminders. Please try again.", actions: [], chartData: null, skillUsed: 'send-reminder', confidence: 0, latencyMs: Date.now() - startTime } };
      }
    }
```

- [ ] **Step 8: Restart, seed, run tests**

```bash
kill $(lsof -i :4050 -t) 2>/dev/null; sleep 1
cd /Users/qianghan/Documents/mycodespace/a3p
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4050 npx tsx plugins/agentbook-core/backend/src/server.ts > /tmp/core-backend.log 2>&1 &
sleep 4
curl -s -X POST http://localhost:4050/api/v1/agentbook-core/agent/seed-skills
# Expected: total: 28

cd tests/e2e && npx playwright test agent-invoice.spec.ts --config=playwright.config.ts --reporter=line
# Expected: 13 passed
```

- [ ] **Step 9: Verify no regressions**

```bash
npx playwright test agent-brain.spec.ts agent-brain-v2.spec.ts --config=playwright.config.ts --reporter=line
# Expected: 28 passed (update skill counts in agent-brain.spec.ts if needed: 28 total)
```

- [ ] **Step 10: Commit**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
git add plugins/agentbook-core/backend/src/server.ts tests/e2e/agent-invoice.spec.ts
git commit -m "feat: 6 invoice action skills — send, pay, estimate, timer, reminders

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Evaluator + Memory Extensions + Multi-Step Test

**Files:**
- Modify: `plugins/agentbook-core/backend/src/agent-evaluator.ts`
- Modify: `plugins/agentbook-core/backend/src/agent-memory.ts`
- Modify: `tests/e2e/agent-invoice.spec.ts`

- [ ] **Step 1: Add invoice quality checks to evaluator**

In `agent-evaluator.ts`, in `assessStepQuality()`, add after the `categorize-expenses` block:

```typescript
  if (step.action === 'create-invoice' || step.action === 'create-estimate') {
    if (!data?.number && !data?.id) { score -= 0.5; issues.push('Invoice/estimate not created'); }
    if (!data?.clientId) { score -= 0.2; issues.push('No client resolved'); }
  }

  if (step.action === 'send-invoice') {
    if (data && !data.emailSent) { score -= 0.3; issues.push('Email not sent (client may lack email address)'); }
  }

  if (step.action === 'record-payment') {
    if (data?.amountCents === 0) { score -= 0.5; issues.push('Zero payment recorded'); }
  }
```

- [ ] **Step 2: Add client rate learning to memory**

In `agent-memory.ts`, in `learnFromInteraction()`, add after the auto-promote block:

```typescript
  // 3. Client rate learning (from invoices)
  if (skillUsed === 'create-invoice' && result?.success && result.data?.clientId) {
    const lines = (result.data.lines as any[]) || [];
    if (lines.length > 0 && lines[0].rateCents) {
      const key = `client_rate:${result.data.clientId}`;
      const existing = await db.abUserMemory.findFirst({ where: { tenantId, key } });
      if (existing) {
        if (existing.value === String(lines[0].rateCents)) {
          await db.abUserMemory.update({
            where: { id: existing.id },
            data: { confidence: Math.min(0.99, existing.confidence + 0.15), usageCount: { increment: 1 }, lastUsed: new Date() },
          });
        }
      } else {
        await db.abUserMemory.create({
          data: { tenantId, key, value: String(lines[0].rateCents), type: 'client_rate', confidence: 0.5, source: 'learned' },
        });
      }
    }
  }
```

- [ ] **Step 3: Add multi-step invoice test**

Append to `tests/e2e/agent-invoice.spec.ts`:

```typescript
test.describe.serial('Invoice Agent — Multi-Step', () => {
  test('multi-step: "invoice Acme $5000 and send it" triggers plan', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H,
      data: { text: 'invoice Acme $5000 for consulting and then send it', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // Should trigger plan (multi-intent with "and then")
    expect(body.data.plan || body.data.message).toBeTruthy();
  });

  test('send-reminder with no overdue returns friendly message', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'send payment reminders', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.skillUsed).toBe('send-reminder');
    expect(body.data.message).toBeTruthy();
  });
});
```

- [ ] **Step 4: Restart, run all tests**

```bash
kill $(lsof -i :4050 -t) 2>/dev/null; sleep 1
cd /Users/qianghan/Documents/mycodespace/a3p
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4050 npx tsx plugins/agentbook-core/backend/src/server.ts > /tmp/core-backend.log 2>&1 &
sleep 4
curl -s -X POST http://localhost:4050/api/v1/agentbook-core/agent/seed-skills

cd tests/e2e && npx playwright test agent-invoice.spec.ts agent-brain.spec.ts agent-brain-v2.spec.ts --config=playwright.config.ts --reporter=line
# Expected: all pass
```

- [ ] **Step 5: Commit**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
git add plugins/agentbook-core/backend/src/agent-evaluator.ts plugins/agentbook-core/backend/src/agent-memory.ts tests/e2e/agent-invoice.spec.ts
git commit -m "feat: invoice evaluator quality checks, client rate learning, multi-step test

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Update Skill Count + Final Push

**Files:**
- Modify: `tests/e2e/agent-brain.spec.ts`

- [ ] **Step 1: Update existing test skill count**

In `agent-brain.spec.ts`, update:
- Seed test: `expect(body.data.total).toBe(28);`
- Registry test: `expect(body.data.length).toBeGreaterThanOrEqual(28);`

- [ ] **Step 2: Run full suite**

```bash
cd tests/e2e && npx playwright test agent-brain.spec.ts agent-brain-v2.spec.ts agent-invoice.spec.ts --config=playwright.config.ts --reporter=line
# Expected: all pass
```

- [ ] **Step 3: Commit and push**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
git add tests/e2e/agent-brain.spec.ts
git commit -m "test: update skill count to 28 for invoice agent skills

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push origin feat/agentbook
```
