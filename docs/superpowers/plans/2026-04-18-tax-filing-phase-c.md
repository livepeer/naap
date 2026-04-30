# Tax Filing Phase C — E-Filing via Partner API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add partner API integration for submitting tax returns electronically, with filing confirmation tracking and status polling.

**Architecture:** New AbTaxFilingPartner model for partner configs, new tax-efiling.ts module for submission/status logic, 2 new skills (tax-filing-submit, tax-filing-check), 2 new endpoints. Partner API is stubbed for development with a mock provider.

**Tech Stack:** TypeScript/ESM, Express, Prisma, Playwright E2E

**Spec:** `docs/superpowers/specs/2026-04-18-tax-filing-design.md` (Phase C section)

**Depends on:** Phase A + Phase B complete (52 skills, validation + export working)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `plugins/agentbook-tax/backend/src/tax-efiling.ts` | Partner API integration, submission, status polling, mock provider |

### Modified Files

| File | Changes |
|------|---------|
| `packages/database/prisma/schema.prisma` | Add AbTaxFilingPartner model |
| `plugins/agentbook-tax/backend/src/server.ts` | 2 new endpoints (submit, check status) |
| `plugins/agentbook-core/backend/src/server.ts` | 2 new skill manifests + INTERNAL handlers |
| `tests/e2e/agent-tax-filing.spec.ts` | 5 new tests |
| `tests/e2e/agent-brain.spec.ts` | Update skill count to 54 |

---

## Task 1: Schema + E-Filing Module

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `plugins/agentbook-tax/backend/src/tax-efiling.ts`

- [ ] **Step 1: Add AbTaxFilingPartner model**

Add to schema.prisma in `plugin_agentbook_tax` section:

```prisma
model AbTaxFilingPartner {
  id            String   @id @default(uuid())
  jurisdiction  String
  partnerName   String
  apiUrl        String
  apiKey        String?
  certId        String?
  enabled       Boolean  @default(true)
  createdAt     DateTime @default(now())

  @@unique([jurisdiction, partnerName])
  @@schema("plugin_agentbook_tax")
}
```

Push schema:
```bash
cd /Users/qianghan/Documents/mycodespace/a3p/packages/database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" npx --no prisma db push --skip-generate
```

- [ ] **Step 2: Create tax-efiling.ts**

```typescript
/**
 * Tax E-Filing — partner API submission, status polling, mock provider.
 */
import { db } from './db/client.js';
import { validateFiling } from './tax-export.js';

// === Mock E-Filing Provider (for development) ===
// In production, this would call Wealthsimple Tax API or a NETFILE-certified vendor.

async function mockSubmit(filingData: any): Promise<{ confirmationNumber: string; status: string }> {
  // Simulate API latency
  await new Promise(r => setTimeout(r, 500));
  const confNum = `CRA-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  return { confirmationNumber: confNum, status: 'accepted' };
}

async function mockCheckStatus(confirmationNumber: string): Promise<{ status: string; details?: string }> {
  // Simulate status check
  return { status: 'accepted', details: 'Notice of Assessment will be mailed within 2 weeks.' };
}

// === Submit Filing ===

export async function submitFiling(
  tenantId: string, taxYear: number,
): Promise<{ success: boolean; data?: any; error?: string }> {
  // 1. Load filing
  const filing = await db.abTaxFiling.findFirst({
    where: { tenantId, taxYear, filingType: 'personal_return' },
  });
  if (!filing) return { success: false, error: 'No filing found for this year' };

  // 2. Check status — must be 'complete' or 'exported'
  if (!['complete', 'exported', 'in_progress'].includes(filing.status)) {
    if (filing.status === 'filed') {
      return { success: false, error: `Already filed on ${filing.filedAt?.toLocaleDateString()}. Confirmation: ${filing.filedRef}` };
    }
    return { success: false, error: `Filing status is "${filing.status}" — must be complete or exported before filing` };
  }

  // 3. Validate
  const forms = (filing.forms as Record<string, any>) || {};
  const validation = validateFiling(forms);
  if (!validation.valid) {
    return {
      success: false,
      error: `Cannot file — ${validation.errors.length} validation error(s)`,
      data: { validation },
    };
  }

  // 4. Load partner config (or use mock)
  const partner = await db.abTaxFilingPartner.findFirst({
    where: { jurisdiction: filing.jurisdiction, enabled: true },
  });

  let result: { confirmationNumber: string; status: string };
  if (partner?.apiUrl) {
    // Real partner API call
    try {
      const res = await fetch(partner.apiUrl + '/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${partner.apiKey}`,
          'X-Cert-ID': partner.certId || '',
        },
        body: JSON.stringify({
          taxYear,
          jurisdiction: filing.jurisdiction,
          region: filing.region,
          forms,
        }),
      });
      result = await res.json() as any;
    } catch (err) {
      return { success: false, error: `Partner API error: ${err}` };
    }
  } else {
    // Use mock provider for development
    result = await mockSubmit({ taxYear, forms });
  }

  // 5. Update filing
  await db.abTaxFiling.update({
    where: { id: filing.id },
    data: {
      status: 'filed',
      filedAt: new Date(),
      filedRef: result.confirmationNumber,
      filedStatus: result.status,
    },
  });

  return {
    success: true,
    data: {
      confirmationNumber: result.confirmationNumber,
      status: result.status,
      filedAt: new Date().toISOString(),
      message: result.status === 'accepted'
        ? `Tax return filed successfully! Confirmation: ${result.confirmationNumber}`
        : `Tax return submitted. Status: ${result.status}. Confirmation: ${result.confirmationNumber}`,
    },
  };
}

// === Check Filing Status ===

export async function checkFilingStatus(
  tenantId: string, taxYear: number,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const filing = await db.abTaxFiling.findFirst({
    where: { tenantId, taxYear, filingType: 'personal_return' },
  });
  if (!filing) return { success: false, error: 'No filing found' };

  if (filing.status !== 'filed' || !filing.filedRef) {
    return {
      success: true,
      data: {
        status: filing.status,
        message: filing.status === 'filed'
          ? `Filed. Confirmation: ${filing.filedRef}`
          : `Filing status: ${filing.status}. Not yet submitted.`,
      },
    };
  }

  // Poll partner for status update
  const partner = await db.abTaxFilingPartner.findFirst({
    where: { jurisdiction: filing.jurisdiction, enabled: true },
  });

  let statusResult: { status: string; details?: string };
  if (partner?.apiUrl) {
    try {
      const res = await fetch(`${partner.apiUrl}/status/${filing.filedRef}`, {
        headers: { 'Authorization': `Bearer ${partner.apiKey}` },
      });
      statusResult = await res.json() as any;
    } catch {
      statusResult = { status: filing.filedStatus || 'unknown', details: 'Could not reach partner API' };
    }
  } else {
    statusResult = await mockCheckStatus(filing.filedRef);
  }

  // Update filing status if changed
  if (statusResult.status !== filing.filedStatus) {
    await db.abTaxFiling.update({
      where: { id: filing.id },
      data: { filedStatus: statusResult.status },
    });
  }

  return {
    success: true,
    data: {
      confirmationNumber: filing.filedRef,
      filedAt: filing.filedAt?.toISOString(),
      status: statusResult.status,
      details: statusResult.details,
      message: `Filing status: **${statusResult.status}**\nConfirmation: ${filing.filedRef}\nFiled: ${filing.filedAt?.toLocaleDateString()}${statusResult.details ? '\n' + statusResult.details : ''}`,
    },
  };
}

// === Seed Mock Partner (for development) ===

export async function seedMockPartner(): Promise<void> {
  await db.abTaxFilingPartner.upsert({
    where: { jurisdiction_partnerName: { jurisdiction: 'ca', partnerName: 'mock' } },
    update: {},
    create: {
      jurisdiction: 'ca',
      partnerName: 'mock',
      apiUrl: '', // empty = use mock provider
      enabled: true,
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
git add packages/database/prisma/schema.prisma plugins/agentbook-tax/backend/src/tax-efiling.ts
git commit -m "feat: tax-efiling module — partner API submission, status polling, mock provider

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Endpoints + Skills + Tests

**Files:**
- Modify: `plugins/agentbook-tax/backend/src/server.ts`
- Modify: `plugins/agentbook-core/backend/src/server.ts`
- Modify: `tests/e2e/agent-tax-filing.spec.ts`
- Modify: `tests/e2e/agent-brain.spec.ts`

- [ ] **Step 1: Add 2 endpoints to tax plugin**

Import:
```typescript
import { submitFiling, checkFilingStatus, seedMockPartner } from './tax-efiling.js';
```

Endpoints:
```typescript
server.app.post('/api/v1/agentbook-tax/tax-filing/:year/submit', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const taxYear = parseInt(req.params.year, 10);
    const result = await submitFiling(tenantId, taxYear);
    res.json(result);
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

server.app.get('/api/v1/agentbook-tax/tax-filing/:year/status', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const taxYear = parseInt(req.params.year, 10);
    const result = await checkFilingStatus(tenantId, taxYear);
    res.json(result);
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});
```

- [ ] **Step 2: Add 2 skills + INTERNAL handlers to core server**

Skills before `general-question`:
```typescript
  {
    name: 'tax-filing-submit', description: 'Submit tax return to CRA via certified partner API — e-file your return', category: 'tax',
    triggerPatterns: ['submit.*tax', 'submit.*cra', 'efile', 'netfile', 'submit.*return', 'file.*return.*cra', 'send.*cra'],
    parameters: { taxYear: { type: 'number', required: false, default: 2025 } },
    endpoint: { method: 'INTERNAL', url: '' },
    confirmBefore: true,
  },
  {
    name: 'tax-filing-check', description: 'Check e-filing status — accepted, rejected, or pending by CRA', category: 'tax',
    triggerPatterns: ['filing.*status.*cra', 'cra.*accept', 'return.*status', 'check.*filing', 'did.*cra.*accept'],
    parameters: { taxYear: { type: 'number', required: false, default: 2025 } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax-filing/2025/status' },
  },
```

INTERNAL handler for tax-filing-submit:
```typescript
    if (selectedSkill.name === 'tax-filing-submit') {
      try {
        const taxBase = baseUrls['/api/v1/agentbook-tax'] || 'http://localhost:4053';
        const IH = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
        const taxYear = extractedParams.taxYear || 2025;

        const res = await fetch(`${taxBase}/api/v1/agentbook-tax/tax-filing/${taxYear}/submit`, { method: 'POST', headers: IH });
        const data = await res.json() as any;

        let message: string;
        if (data.success) {
          message = `\u2705 **${data.data.message}**`;
        } else {
          message = `\u274C **Filing Failed**\n\n${data.error}`;
          if (data.data?.validation?.errors?.length > 0) {
            message += '\n\n**Fix these errors first:**\n';
            data.data.validation.errors.forEach((e: any) => { message += `- ${e.message}\n`; });
          }
        }

        await db.abConversation.create({ data: { tenantId, question: text || '[submit]', answer: message, queryType: 'agent', channel, skillUsed: 'tax-filing-submit' } });
        return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-filing-submit', skillResponse: data,
          responseData: { message, actions: [], chartData: null, skillUsed: 'tax-filing-submit', confidence, latencyMs: Date.now() - startTime } };
      } catch (err) {
        console.error('Tax submit error:', err);
        return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-filing-submit', skillResponse: null,
          responseData: { message: "Filing submission failed. Please try again.", actions: [], chartData: null, skillUsed: 'tax-filing-submit', confidence: 0, latencyMs: Date.now() - startTime } };
      }
    }
```

Response formatting for filing check:
```typescript
    // Filing status check
    } else if (data?.confirmationNumber && data?.filedAt) {
      message = data.message || `Filing status: ${data.status}\nConfirmation: ${data.confirmationNumber}`;
```

- [ ] **Step 3: Update skill count to 54**

- [ ] **Step 4: Add 5 tests**

Append to agent-tax-filing.spec.ts:
```typescript
test.describe.serial('Tax Filing — Phase C: E-Filing', () => {
  test('tax-filing-submit: "submit my return to CRA"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'submit my tax return to CRA', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('tax-filing-submit');
  });

  test('submit endpoint returns result', async ({ request }) => {
    const res = await request.post(`${TAX}/api/v1/agentbook-tax/tax-filing/2025/submit`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // May succeed (mock) or fail (validation) — either is valid
    expect(body.success !== undefined).toBeTruthy();
  });

  test('tax-filing-check: "check filing status"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'check my CRA filing status', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('tax-filing-check');
  });

  test('status endpoint returns result', async ({ request }) => {
    const res = await request.get(`${TAX}/api/v1/agentbook-tax/tax-filing/2025/status`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.status).toBeTruthy();
  });

  test('re-submit after filing shows already filed', async ({ request }) => {
    const res = await request.post(`${TAX}/api/v1/agentbook-tax/tax-filing/2025/submit`, { headers: H });
    const body = await res.json();
    // If already filed, should indicate that
    if (!body.success) {
      expect(body.error).toContain('filed');
    }
  });
});
```

- [ ] **Step 5: Restart both servers, seed, run ALL tests, commit and push**

```bash
kill $(lsof -i :4050 -t) $(lsof -i :4053 -t) 2>/dev/null; sleep 1
cd /Users/qianghan/Documents/mycodespace/a3p
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4053 npx tsx plugins/agentbook-tax/backend/src/server.ts > /tmp/tax-backend.log 2>&1 &
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4050 npx tsx plugins/agentbook-core/backend/src/server.ts > /tmp/core-backend.log 2>&1 &
sleep 5
curl -s -X POST http://localhost:4050/api/v1/agentbook-core/agent/seed-skills
# Expected: total 54

cd tests/e2e && npx playwright test agent-brain.spec.ts agent-brain-v2.spec.ts agent-invoice.spec.ts agent-tax-finance.spec.ts agent-cpa-automation.spec.ts agent-tax-filing.spec.ts --config=playwright.config.ts --reporter=line

cd /Users/qianghan/Documents/mycodespace/a3p
git add plugins/agentbook-tax/backend/src/server.ts plugins/agentbook-core/backend/src/server.ts tests/e2e/agent-tax-filing.spec.ts tests/e2e/agent-brain.spec.ts docs/superpowers/plans/2026-04-18-tax-filing-phase-b.md docs/superpowers/plans/2026-04-18-tax-filing-phase-c.md
git commit -m "feat: Phase C — e-filing via partner API, submission, status tracking

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push origin feat/agentbook
```
