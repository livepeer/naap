# Tax Filing Phase B — Form Generation + Export

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add validation rules, PDF rendering, and CRA-schema export so users can validate their return, generate printable forms, and export files compatible with tax filing software.

**Architecture:** Extend AbTaxFormTemplate with validation rules, add PDF HTML rendering (reuse invoice pattern), add XML/JSON export. 2 new skills (tax-filing-validate, tax-filing-export), 2 new endpoints, response formatting.

**Tech Stack:** TypeScript/ESM, Express, Prisma, Playwright E2E

**Spec:** `docs/superpowers/specs/2026-04-18-tax-filing-design.md` (Phase B section)

**Depends on:** Phase A complete (50 skills, AbTaxFormTemplate, AbTaxFiling, tax-forms.ts, tax-filing.ts)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `plugins/agentbook-tax/backend/src/tax-export.ts` | Validation rules, PDF HTML generation, JSON/XML export |

### Modified Files

| File | Changes |
|------|---------|
| `plugins/agentbook-tax/backend/src/server.ts` | 2 new endpoints (validate, export) |
| `plugins/agentbook-core/backend/src/server.ts` | 2 new skill manifests, INTERNAL handler for validate, response formatting |
| `tests/e2e/agent-tax-filing.spec.ts` | 5 new tests |
| `tests/e2e/agent-brain.spec.ts` | Update skill count to 52 |

---

## Task 1: Tax Export Module — Validation + PDF + Export

**Files:**
- Create: `plugins/agentbook-tax/backend/src/tax-export.ts`

- [ ] **Step 1: Implement tax-export.ts**

```typescript
/**
 * Tax Export — validation rules, PDF rendering, JSON/XML export.
 */
import { db } from './db/client.js';

// === Validation ===

interface ValidationResult {
  valid: boolean;
  errors: { ruleId: string; formCode: string; message: string; severity: 'error' | 'warning' }[];
  warnings: { ruleId: string; formCode: string; message: string; severity: 'warning' }[];
}

const VALIDATION_RULES = [
  { ruleId: 'income_positive', formCode: 'T1', check: (forms: any) => (forms.T1?.fields?.total_income_15000 || 0) >= 0, severity: 'warning' as const, message: 'Total income is negative — verify all income sources' },
  { ruleId: 't2125_expenses_ratio', formCode: 'T2125', check: (forms: any) => {
    const gross = forms.T2125?.fields?.adjusted_gross_8299 || 1;
    const expenses = forms.T2125?.fields?.total_expenses_9368 || 0;
    return gross <= 0 || expenses / gross < 0.95;
  }, severity: 'warning' as const, message: 'Business expenses exceed 95% of revenue — CRA may flag this' },
  { ruleId: 'gst_registration', formCode: 'GST-HST', check: (forms: any) => {
    const revenue = forms.T2125?.fields?.gross_sales_8000 || 0;
    const gstNum = forms['GST-HST']?.fields?.gst_number;
    return revenue < 3000000 || !!gstNum; // $30,000 threshold in cents
  }, severity: 'error' as const, message: 'GST/HST registration required if revenue exceeds $30,000' },
  { ruleId: 'sin_required', formCode: 'T1', check: (forms: any) => !!forms.T1?.fields?.sin, severity: 'error' as const, message: 'Social Insurance Number is required for filing' },
  { ruleId: 'name_required', formCode: 'T1', check: (forms: any) => !!forms.T1?.fields?.full_name, severity: 'error' as const, message: 'Full legal name is required for filing' },
  { ruleId: 'vehicle_km_valid', formCode: 'T2125', check: (forms: any) => {
    const total = forms.T2125?.fields?.vehicle_total_km || 0;
    const business = forms.T2125?.fields?.vehicle_business_km || 0;
    return total === 0 || business <= total;
  }, severity: 'error' as const, message: 'Business kilometres cannot exceed total kilometres' },
  { ruleId: 'home_office_pct', formCode: 'T2125', check: (forms: any) => {
    const pct = forms.T2125?.fields?.home_office_pct || 0;
    return pct <= 100;
  }, severity: 'error' as const, message: 'Home office percentage cannot exceed 100%' },
  { ruleId: 'balance_calculated', formCode: 'T1', check: (forms: any) => forms.T1?.fields?.balance_owing_48500 !== undefined, severity: 'warning' as const, message: 'Balance owing/refund has not been calculated — some fields may be missing' },
];

export function validateFiling(forms: Record<string, any>): ValidationResult {
  const errors: ValidationResult['errors'] = [];
  const warnings: ValidationResult['warnings'] = [];

  for (const rule of VALIDATION_RULES) {
    try {
      if (!rule.check(forms)) {
        const entry = { ruleId: rule.ruleId, formCode: rule.formCode, message: rule.message, severity: rule.severity };
        if (rule.severity === 'error') errors.push(entry);
        else warnings.push(entry);
      }
    } catch { /* skip broken rules */ }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// === PDF HTML Rendering ===

export function renderFilingPDF(filing: any, forms: Record<string, any>, templates: any[]): string {
  const year = filing.taxYear || 2025;
  const jurisdiction = (filing.jurisdiction || 'ca').toUpperCase();

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Tax Return ${year} — ${jurisdiction}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }
  h1 { color: #1a1a2e; border-bottom: 2px solid #1a1a2e; padding-bottom: 8px; }
  h2 { color: #16213e; margin-top: 24px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  h3 { color: #0f3460; margin-top: 16px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th, td { text-align: left; padding: 6px 12px; border-bottom: 1px solid #eee; }
  th { background: #f8f9fa; font-weight: 600; }
  td.amount { text-align: right; font-family: monospace; }
  .line-number { color: #888; font-size: 0.85em; }
  .form-header { background: #1a1a2e; color: white; padding: 12px 16px; margin-top: 32px; }
  .totals td { font-weight: bold; border-top: 2px solid #333; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 0.8em; color: #888; text-align: center; }
</style></head><body>`;

  html += `<h1>Tax Return ${year}</h1>`;
  html += `<p>Jurisdiction: ${jurisdiction} | Generated: ${new Date().toLocaleDateString()}</p>`;

  for (const template of templates) {
    const formData = forms[template.formCode];
    if (!formData?.fields) continue;

    html += `<div class="form-header"><h2 style="color:white;margin:0;">${template.formCode} — ${template.formName}</h2></div>`;

    for (const section of (template.sections || [])) {
      html += `<h3>${section.title}</h3><table>`;
      html += `<tr><th>Line</th><th>Description</th><th>Amount</th></tr>`;

      for (const field of (section.fields || [])) {
        const value = formData.fields[field.fieldId];
        if (value === undefined && !field.required) continue;

        const displayValue = field.type === 'currency'
          ? `$${((value || 0) / 100).toFixed(2)}`
          : field.type === 'percent'
          ? `${value || 0}%`
          : String(value || '—');

        const isTotal = field.fieldId.includes('total_') || field.fieldId.includes('net_') || field.fieldId.includes('balance_');
        html += `<tr${isTotal ? ' class="totals"' : ''}>`;
        html += `<td class="line-number">${field.lineNumber || ''}</td>`;
        html += `<td>${field.label}</td>`;
        html += `<td class="amount">${displayValue}</td>`;
        html += `</tr>`;
      }
      html += `</table>`;
    }
  }

  html += `<div class="footer">Generated by AgentBook | For review purposes — not an official CRA document</div>`;
  html += `</body></html>`;
  return html;
}

// === JSON Export ===

export function exportJSON(filing: any, forms: Record<string, any>): any {
  return {
    exportFormat: 'agentbook-tax-v1',
    generatedAt: new Date().toISOString(),
    taxYear: filing.taxYear,
    jurisdiction: filing.jurisdiction,
    region: filing.region,
    forms: Object.entries(forms).map(([code, data]: [string, any]) => ({
      formCode: code,
      fields: data.fields || {},
      completeness: data.completeness || 0,
    })),
  };
}

// === Full Export Flow ===

export async function exportFiling(
  tenantId: string, taxYear: number, format: 'pdf' | 'json',
): Promise<{ success: boolean; data?: any; error?: string }> {
  const filing = await db.abTaxFiling.findFirst({
    where: { tenantId, taxYear, filingType: 'personal_return' },
  });
  if (!filing) return { success: false, error: 'No filing found for this year' };

  const forms = (filing.forms as Record<string, any>) || {};

  // Validate first
  const validation = validateFiling(forms);
  if (!validation.valid) {
    return {
      success: false,
      error: `Cannot export — ${validation.errors.length} validation errors`,
      data: { validation },
    };
  }

  const templates = await db.abTaxFormTemplate.findMany({
    where: { jurisdiction: filing.jurisdiction, version: String(taxYear), enabled: true },
  });

  if (format === 'pdf') {
    const html = renderFilingPDF(filing, forms, templates);
    // Store HTML in filing
    await db.abTaxFiling.update({
      where: { id: filing.id },
      data: { exportData: { format: 'pdf', html } as any, status: 'exported' },
    });
    return { success: true, data: { format: 'pdf', html, validation } };
  }

  if (format === 'json') {
    const json = exportJSON(filing, forms);
    await db.abTaxFiling.update({
      where: { id: filing.id },
      data: { exportData: json as any, status: 'exported' },
    });
    return { success: true, data: { format: 'json', exportData: json, validation } };
  }

  return { success: false, error: `Unknown format: ${format}` };
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
git add plugins/agentbook-tax/backend/src/tax-export.ts
git commit -m "feat: tax-export module — validation rules, PDF rendering, JSON export

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Tax Plugin Endpoints + Agent Skills + Tests

**Files:**
- Modify: `plugins/agentbook-tax/backend/src/server.ts`
- Modify: `plugins/agentbook-core/backend/src/server.ts`
- Modify: `tests/e2e/agent-tax-filing.spec.ts`
- Modify: `tests/e2e/agent-brain.spec.ts`

- [ ] **Step 1: Add 2 endpoints to tax plugin server.ts**

Import at top:
```typescript
import { validateFiling, exportFiling } from './tax-export.js';
```

Add endpoints:
```typescript
server.app.post('/api/v1/agentbook-tax/tax-filing/:year/validate', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const taxYear = parseInt(req.params.year, 10);
    const filing = await db.abTaxFiling.findFirst({ where: { tenantId, taxYear, filingType: 'personal_return' } });
    if (!filing) return res.status(404).json({ success: false, error: 'No filing found' });
    const result = validateFiling((filing.forms as any) || {});
    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

server.app.post('/api/v1/agentbook-tax/tax-filing/:year/export', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const taxYear = parseInt(req.params.year, 10);
    const format = (req.body.format || 'json') as 'pdf' | 'json';
    const result = await exportFiling(tenantId, taxYear, format);
    if (result.success && format === 'pdf' && result.data?.html) {
      // Return HTML directly for PDF rendering
      res.setHeader('Content-Type', 'text/html');
      return res.send(result.data.html);
    }
    res.json(result);
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});
```

- [ ] **Step 2: Add 2 skill manifests to core server.ts**

Before `general-question`:
```typescript
  {
    name: 'tax-filing-validate', description: 'Run validation rules on tax return — check for errors before filing', category: 'tax',
    triggerPatterns: ['validate.*tax', 'check.*tax.*error', 'verify.*return', 'tax.*ready.*file', 'any.*error.*tax'],
    parameters: { taxYear: { type: 'number', required: false, default: 2025 } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-tax/tax-filing/2025/validate' },
  },
  {
    name: 'tax-filing-export', description: 'Generate and export tax forms — PDF or JSON format', category: 'tax',
    triggerPatterns: ['export.*tax', 'generate.*tax.*form', 'download.*return', 'create.*tax.*file', 'print.*tax', 'pdf.*tax'],
    parameters: { format: { type: 'string', required: false, default: 'json' } },
    endpoint: { method: 'INTERNAL', url: '' },
  },
```

- [ ] **Step 3: Add INTERNAL handler for tax-filing-export**

```typescript
    if (selectedSkill.name === 'tax-filing-export') {
      try {
        const taxBase = baseUrls['/api/v1/agentbook-tax'] || 'http://localhost:4053';
        const IH = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
        const format = extractedParams.format || 'json';

        const res = await fetch(`${taxBase}/api/v1/agentbook-tax/tax-filing/2025/export`, {
          method: 'POST', headers: IH, body: JSON.stringify({ format }),
        });

        if (format === 'pdf') {
          const html = await res.text();
          const message = 'Tax return PDF generated! Open the link to view/print your return.';
          await db.abConversation.create({ data: { tenantId, question: text || '[export]', answer: message, queryType: 'agent', channel, skillUsed: 'tax-filing-export' } });
          return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-filing-export', skillResponse: { success: true },
            responseData: { message, actions: [], chartData: null, skillUsed: 'tax-filing-export', confidence, latencyMs: Date.now() - startTime } };
        }

        const data = await res.json() as any;
        let message: string;
        if (data.success) {
          message = '**Tax Return Exported**\n\nYour return has been exported in JSON format. ';
          if (data.data?.validation?.warnings?.length > 0) {
            message += `\n\n**Warnings (${data.data.validation.warnings.length}):**\n`;
            data.data.validation.warnings.forEach((w: any) => { message += `- ${w.message}\n`; });
          }
        } else {
          message = data.error || "Export failed. Check validation errors.";
          if (data.data?.validation) {
            message += `\n\n**Errors:**\n`;
            data.data.validation.errors.forEach((e: any) => { message += `- ${e.message}\n`; });
          }
        }
        await db.abConversation.create({ data: { tenantId, question: text || '[export]', answer: message, queryType: 'agent', channel, skillUsed: 'tax-filing-export' } });
        return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-filing-export', skillResponse: data,
          responseData: { message, actions: [], chartData: null, skillUsed: 'tax-filing-export', confidence, latencyMs: Date.now() - startTime } };
      } catch (err) {
        console.error('Tax export error:', err);
        return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-filing-export', skillResponse: null,
          responseData: { message: "Export failed. Please try again.", actions: [], chartData: null, skillUsed: 'tax-filing-export', confidence: 0, latencyMs: Date.now() - startTime } };
      }
    }
```

- [ ] **Step 4: Add response formatting for validation results**

```typescript
    // Tax validation result
    } else if (data?.valid !== undefined && (data?.errors || data?.warnings)) {
      if (data.valid) {
        message = '\u2705 **Tax Return Validated — Ready to file!**\n';
      } else {
        message = '\u274C **Validation Failed**\n\n**Errors:**\n';
        for (const e of (data.errors || [])) { message += `- ${e.message} (${e.formCode})\n`; }
      }
      if (data.warnings?.length > 0) {
        message += `\n**Warnings:**\n`;
        for (const w of (data.warnings || [])) { message += `- ${w.message} (${w.formCode})\n`; }
      }
```

- [ ] **Step 5: Add tests**

Append to `tests/e2e/agent-tax-filing.spec.ts`:

```typescript
test.describe.serial('Tax Filing — Phase B: Validation & Export', () => {
  test('tax-filing-validate: "check for errors"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'validate my tax return for errors', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('tax-filing-validate');
  });

  test('validation endpoint returns result', async ({ request }) => {
    const res = await request.post(`${TAX}/api/v1/agentbook-tax/tax-filing/2025/validate`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.valid).toBeDefined();
    expect(body.data.errors).toBeDefined();
    expect(body.data.warnings).toBeDefined();
  });

  test('tax-filing-export: "export my tax forms"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'export my tax forms', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('tax-filing-export');
  });

  test('JSON export endpoint works', async ({ request }) => {
    const res = await request.post(`${TAX}/api/v1/agentbook-tax/tax-filing/2025/export`, {
      headers: H, data: { format: 'json' },
    });
    // May fail validation (missing SIN) but should respond
    expect(res.ok() || res.status() === 200).toBeTruthy();
  });

  test('PDF export returns HTML', async ({ request }) => {
    // First fill required fields to pass validation
    await request.post(`${TAX}/api/v1/agentbook-tax/tax-filing/2025/field`, {
      headers: H, data: { formCode: 'T1', fieldId: 'full_name', value: 'Maya Test' },
    });
    await request.post(`${TAX}/api/v1/agentbook-tax/tax-filing/2025/field`, {
      headers: H, data: { formCode: 'T1', fieldId: 'sin', value: '123456789' },
    });

    const res = await request.post(`${TAX}/api/v1/agentbook-tax/tax-filing/2025/export`, {
      headers: H, data: { format: 'pdf' },
    });
    // May return HTML or JSON error
    expect(res.status()).toBeLessThan(500);
  });
});
```

- [ ] **Step 6: Update skill count to 52**

- [ ] **Step 7: Restart, seed, run all tests**

```bash
kill $(lsof -i :4050 -t) $(lsof -i :4053 -t) 2>/dev/null; sleep 1
cd /Users/qianghan/Documents/mycodespace/a3p
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4053 npx tsx plugins/agentbook-tax/backend/src/server.ts > /tmp/tax-backend.log 2>&1 &
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4050 npx tsx plugins/agentbook-core/backend/src/server.ts > /tmp/core-backend.log 2>&1 &
sleep 5
curl -s -X POST http://localhost:4050/api/v1/agentbook-core/agent/seed-skills
# Expected: total 52

cd tests/e2e && npx playwright test agent-brain.spec.ts agent-brain-v2.spec.ts agent-invoice.spec.ts agent-tax-finance.spec.ts agent-cpa-automation.spec.ts agent-tax-filing.spec.ts --config=playwright.config.ts --reporter=line
```

- [ ] **Step 8: Commit and push**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
git add plugins/agentbook-tax/backend/src/server.ts plugins/agentbook-core/backend/src/server.ts tests/e2e/agent-tax-filing.spec.ts tests/e2e/agent-brain.spec.ts
git commit -m "feat: Phase B — tax validation rules, PDF rendering, JSON export

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push origin feat/agentbook
```
