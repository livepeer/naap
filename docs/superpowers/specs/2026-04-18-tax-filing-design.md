# Tax Filing System — Skill-Based, Multi-Jurisdiction, Phased

## Overview

A conversational tax filing system where users complete their tax returns via Telegram. The agent walks users through each form, auto-populates fields from AgentBook data, accepts document uploads (T4, T5, RRSP, TFSA slips, bank statements) for OCR extraction, identifies missing fields, validates cross-field rules, generates export-ready files, and ultimately e-files via partner APIs.

**Key principle:** Tax forms are DATA, not CODE. Adding a new country = inserting form template records + seeding skill manifests. No code changes per jurisdiction.

**Phases:**
- **Phase A:** Filing Prep Assistant — completeness checking, field collection, document upload/OCR
- **Phase B:** Form Generation + Export — structured data export, PDF rendering, validation
- **Phase C:** E-Filing — partner API integration, submission, confirmation tracking

Each phase is independently useful. Together they achieve full e-filing.

## Architecture

```
User via Telegram:
  "I want to file my 2025 taxes"
  → Agent brain → tax-filing-start skill
  → Load jurisdiction (CA) from AbTenantConfig
  → Load all AbTaxFormTemplate for CA 2025
  → Create AbTaxFiling session (draft)
  → Auto-populate fields from AgentBook data (revenue, expenses, invoices)
  → Create multi-step plan:
      1. Auto-populate from books
      2. Review T2125 (business income)
      3. Review GST/HST
      4. Collect tax slips (T4, T5, RRSP, TFSA)
      5. Review T1 personal return
      6. Calculate Schedule 1
      7. Evaluate completeness
  → Walk user through missing fields via conversation
  → Accept document uploads (photos/PDFs of tax slips) → OCR extraction
  → Completeness report with quality score

User via Telegram:
  [sends photo of T4 slip]
  → Agent brain → tax-slip-scan skill
  → OCR extracts: employer, employment income, tax deducted, CPP, EI
  → Auto-fills T1 fields (lines 10100, 22215, etc.)
  → "Got it — employment income $45,000, tax deducted $8,200. Correct?"

User via Telegram:
  "export my tax forms"
  → Agent brain → tax-filing-export skill (Phase B)
  → Generate CRA-schema XML / .tax file
  → Return download link

User via Telegram:
  "submit to CRA"
  → Agent brain → tax-filing-submit skill (Phase C)
  → Transmit via partner API (Wealthsimple Tax / certified NETFILE vendor)
  → "Filed! CRA confirmation #: 12345678. NOA expected in 2 weeks."
```

## Data Models

### AbTaxFormTemplate (new, plugin_agentbook_tax schema)

Defines form structure as data. Each record is one tax form for one jurisdiction/year.

```prisma
model AbTaxFormTemplate {
  id            String   @id @default(uuid())
  jurisdiction  String                          // ca | us | uk
  formCode      String                          // T2125 | T1 | GST-HST | ScheduleC | 1040
  formName      String                          // "Statement of Business or Professional Activities"
  version       String                          // "2025" — tax year
  category      String                          // business_income | personal_return | sales_tax | federal_calc
  sections      Json                            // FormSection[] — see below
  validationRules Json   @default("[]")         // CrossFieldValidation[] — Phase B
  exportSchema  Json?                           // CRA XML / IRS field mapping — Phase B
  dependencies  Json     @default("[]")         // form codes this form depends on (e.g., T1 depends on T2125)
  enabled       Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([jurisdiction, formCode, version])
  @@index([jurisdiction, version])
  @@schema("plugin_agentbook_tax")
}
```

**FormSection JSON structure:**
```typescript
interface FormSection {
  sectionId: string;            // "business_income", "vehicle_expenses"
  title: string;                // "Part 3 — Business Income"
  lineRange?: string;           // "8000-8299"
  fields: FormField[];
}

interface FormField {
  fieldId: string;              // "gross_sales_8000"
  label: string;                // "Gross sales, commissions, or fees"
  lineNumber: string;           // "8000" — CRA line number
  type: "currency" | "number" | "text" | "date" | "boolean" | "percent";
  required: boolean;
  source: "auto" | "manual" | "slip" | "calculated";
  // For source="auto": query to pull data from AgentBook
  sourceQuery?: string;         // "revenue_total" | "expense_category:meals" | etc.
  // For source="calculated": formula referencing other fields
  formula?: string;             // "gross_sales_8000 - cost_of_goods_8500"
  // For source="slip": which slip type provides this field
  slipType?: string;            // "T4" | "T5" | "RRSP" | "TFSA"
  slipField?: string;           // "employment_income" | "interest_income"
  // Validation
  min?: number;
  max?: number;
  dependsOn?: string;           // field ID that must be filled first
  helpText?: string;            // guidance for the user
}
```

**Source types explained:**
- `auto`: Field auto-populated from AgentBook books (journal entries, expenses, invoices, revenue)
- `manual`: Agent must ask the user (e.g., "Do you have a home office?")
- `slip`: Field populated from uploaded tax slip (T4, T5, RRSP receipt, etc.) via OCR
- `calculated`: Computed from other fields (e.g., net income = gross - expenses)

### AbTaxFiling (new, plugin_agentbook_tax schema)

Filing session state — one per tenant per tax year.

```prisma
model AbTaxFiling {
  id            String   @id @default(uuid())
  tenantId      String
  taxYear       Int                              // 2025
  jurisdiction  String                           // ca | us
  region        String   @default("")            // ON | BC | CA | NY
  status        String   @default("draft")       // draft | in_progress | review | complete | exported | filed
  forms         Json                             // { "T2125": { fields: {...}, completeness: 0.85, status: "in_progress" }, ... }
  missingFields Json     @default("[]")          // [{ formCode, fieldId, label, source }]
  slips         Json     @default("[]")          // uploaded tax slips: [{ type: "T4", data: {...}, imageUrl, confidence }]
  exportData    Json?                            // Phase B: structured form data for export
  exportUrl     String?                          // Phase B: download URL for generated file
  filedAt       DateTime?                        // Phase C: when submitted
  filedRef      String?                          // Phase C: CRA confirmation number
  filedStatus   String?                          // Phase C: accepted | rejected | pending
  notes         Json     @default("[]")          // user/agent notes during filing
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([tenantId, taxYear])
  @@index([tenantId])
  @@schema("plugin_agentbook_tax")
}
```

### AbTaxSlip (new, plugin_agentbook_tax schema)

Uploaded tax documents (T4, T5, RRSP, TFSA, bank statements).

```prisma
model AbTaxSlip {
  id            String   @id @default(uuid())
  tenantId      String
  taxYear       Int
  slipType      String                           // T4 | T5 | T3 | RRSP | TFSA | T4A | T5007 | bank_statement
  issuer        String?                          // employer name, bank name
  imageUrl      String?                          // uploaded document URL
  extractedData Json                             // OCR-extracted fields
  confidence    Float    @default(0)
  status        String   @default("pending")     // pending | confirmed | rejected
  filingId      String?                          // link to AbTaxFiling
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([tenantId, taxYear])
  @@index([tenantId, slipType])
  @@schema("plugin_agentbook_tax")
}
```

## Skills

### Core Filing Skills (jurisdiction-agnostic)

```typescript
// Filing lifecycle
{ name: 'tax-filing-start', description: 'Start tax filing — create filing session, auto-populate from books, identify missing fields' }
{ name: 'tax-filing-status', description: 'Check tax filing progress — completeness by form, what is missing' }
{ name: 'tax-filing-field', description: 'Answer a tax filing question — provide a value for a missing field' }

// Document collection
{ name: 'tax-slip-scan', description: 'Scan/upload a tax slip (T4, T5, RRSP, TFSA, bank statement) — OCR extract and auto-fill' }
{ name: 'tax-slip-list', description: 'Show uploaded tax slips and their status' }

// Phase B
{ name: 'tax-filing-export', description: 'Generate and export tax forms — PDF, XML, or .tax file format' }
{ name: 'tax-filing-validate', description: 'Run validation rules on completed forms — check for errors before filing' }

// Phase C
{ name: 'tax-filing-submit', description: 'Submit tax return to CRA/IRS via certified partner API' }
{ name: 'tax-filing-check', description: 'Check e-filing status — accepted, rejected, pending' }
```

### Per-Form Review Skills (seeded per jurisdiction)

These are skill manifests with `tenantId: null` (global) and jurisdiction-specific trigger patterns:

**Canada:**
```typescript
{ name: 'ca-t2125-review', description: 'Review T2125 Statement of Business Income — revenue, expenses, vehicle, home office' }
{ name: 'ca-t1-review', description: 'Review T1 General personal income tax return — income sources, deductions, credits' }
{ name: 'ca-gst-hst-review', description: 'Review GST/HST return — collected tax, input tax credits, net tax' }
{ name: 'ca-schedule-1-review', description: 'Review Schedule 1 federal tax calculation — auto-calculated from T1' }
```

**US (future — added by seeding, no code change):**
```typescript
{ name: 'us-schedule-c-review', description: 'Review Schedule C profit/loss from business' }
{ name: 'us-form-1040-review', description: 'Review Form 1040 individual income tax return' }
{ name: 'us-form-1040-es-review', description: 'Review Form 1040-ES estimated tax payments' }
```

### Trigger Patterns

| Skill | Patterns |
|-------|----------|
| `tax-filing-start` | `start.*tax.*fil`, `file.*tax`, `begin.*return`, `prepare.*tax` |
| `tax-filing-status` | `tax.*filing.*status`, `filing.*progress`, `what.*missing.*tax`, `tax.*complete` |
| `tax-slip-scan` | (attachment type=photo/pdf when filing is active) + `upload.*slip`, `scan.*t4`, `scan.*t5` |
| `tax-slip-list` | `show.*slip`, `list.*slip`, `uploaded.*document`, `tax.*document` |
| `ca-t2125-review` | `review.*t2125`, `business.*income.*form`, `t2125` |
| `ca-t1-review` | `review.*t1`, `personal.*return`, `t1.*general` |
| `ca-gst-hst-review` | `review.*gst`, `review.*hst`, `sales.*tax.*return`, `gst.*hst` |
| `tax-filing-export` | `export.*tax`, `generate.*form`, `download.*return`, `create.*tax.*file` |
| `tax-filing-validate` | `validate.*tax`, `check.*error`, `verify.*return` |
| `tax-filing-submit` | `submit.*cra`, `efile`, `netfile`, `submit.*return`, `file.*return` |
| `tax-filing-check` | `filing.*status`, `cra.*accept`, `return.*status` |

## Document Upload & OCR Flow

### Supported Tax Slips (Canada)

| Slip | Fields Extracted | Auto-fills |
|------|-----------------|------------|
| **T4** | Employer, employment income (14), tax deducted (22), CPP (16), EI (18) | T1 lines 10100, 22215, 30800 |
| **T5** | Payer, interest income (13), dividends (24), capital gains (18) | T1 lines 12100, 12000 |
| **T3** | Trust income, capital gains | T1 line 12600 |
| **T4A** | Pension, annuities, other income | T1 lines 11500, 13000 |
| **RRSP** | Contribution amount, receipt number | T1 line 20800, Schedule 7 |
| **TFSA** | Contribution amount (no tax impact but tracked) | Filing notes |
| **T5007** | Social assistance, workers' comp | T1 line 14500 |
| **Bank statement** | Interest earned, fees paid | T1 line 12100, expense deductions |

### OCR Processing

When a user sends a photo/PDF during an active tax filing session:

1. Telegram adapter uploads to blob storage (existing flow)
2. Agent brain detects active filing session + attachment → routes to `tax-slip-scan`
3. `tax-slip-scan` pre-processing:
   a. Call OCR endpoint with the image (reuse existing `/receipts/ocr` or new `/tax-slips/ocr`)
   b. LLM classifies slip type from extracted text (T4 vs T5 vs RRSP etc.)
   c. Extract structured fields based on slip type
   d. Create `AbTaxSlip` record with extracted data
   e. Auto-fill corresponding fields in `AbTaxFiling.forms`
   f. Return confirmation: "Got it — T4 from RBC: employment income $52,000, tax deducted $9,100. Correct?"
4. User confirms or corrects
5. Slip status updated to `confirmed`

### Telegram UX for Document Collection

```
Agent: "Step 4: Tax Slips Collection
  I need your tax documents for 2025. Please send photos or PDFs of:
  
  Required:
  - T4 (employment income) — from each employer
  - T5 (investment income) — from banks/brokerages
  
  If applicable:
  - RRSP contribution receipts
  - TFSA contribution receipts
  - T4A (pension/other income)
  - T3 (trust income)
  
  Send them one at a time. Type 'done' when finished."

User: [sends photo of T4]
Agent: "T4 from Royal Bank of Canada:
  - Employment income: $52,000
  - Income tax deducted: $9,100
  - CPP contributions: $3,867
  - EI premiums: $1,049
  
  Correct? (yes/edit)"

User: "yes"
Agent: "T4 saved. T1 fields updated. Send next slip or type 'done'."

User: [sends RRSP receipt photo]
Agent: "RRSP contribution receipt:
  - Issuer: Wealthsimple
  - Contribution: $6,500
  - Receipt #: RS-2025-12345
  
  Correct?"

User: "yes"  
Agent: "RRSP recorded. Deduction of $6,500 applied to T1 line 20800.
  Send next slip or type 'done'."

User: "done"
Agent: "All slips received. Your filing is now 94% complete.
  Missing: home office expenses (T2125 Part 7).
  Want to fill that in now?"
```

## Auto-Population Logic

### Source Queries

The `sourceQuery` field in `FormField` maps to AgentBook data:

| Query Key | Data Source | Example |
|-----------|-----------|---------|
| `revenue_total` | SUM of revenue journal entries for tax year | T2125 line 8000 |
| `revenue_by_client` | Revenue grouped by client | T2125 breakdown |
| `expense_category:{code}` | SUM of expenses for account code | T2125 line 8810 (travel) |
| `expense_total` | Total business expenses | T2125 line 9368 |
| `gst_collected` | SUM of AbSalesTaxCollected WHERE taxType=GST/HST | GST/HST line 101 |
| `gst_itc` | SUM of input tax credits | GST/HST line 106 |
| `invoice_total` | Total invoiced amount | Revenue verification |
| `vehicle_expenses` | Expenses in Car & Truck category | T2125 Part 5 |
| `home_office_expenses` | Rent, utilities, insurance (proportional) | T2125 Part 7 |
| `cpp_contributions` | From T4 slips | T1 line 30800 |
| `employment_income` | From T4 slips | T1 line 10100 |
| `interest_income` | From T5 slips | T1 line 12100 |
| `rrsp_contributions` | From RRSP slips | T1 line 20800 |

### Auto-Population Process

```typescript
async function autoPopulateForm(
  tenantId: string, taxYear: number,
  template: AbTaxFormTemplate, slips: AbTaxSlip[],
): Promise<{ fields: Record<string, any>; completeness: number }> {
  const fields: Record<string, any> = {};
  let filled = 0;
  let total = 0;

  for (const section of template.sections) {
    for (const field of section.fields) {
      total++;
      
      if (field.source === 'auto' && field.sourceQuery) {
        const value = await resolveSourceQuery(tenantId, taxYear, field.sourceQuery);
        if (value !== null) { fields[field.fieldId] = value; filled++; }
      }
      
      if (field.source === 'slip' && field.slipType) {
        // Aggregate across ALL matching slips (e.g., multiple T4s from different employers)
        const matchingSlips = slips.filter(s => s.slipType === field.slipType && s.status === 'confirmed');
        if (matchingSlips.length > 0 && field.slipField) {
          if (field.type === 'currency' || field.type === 'number') {
            // SUM across all slips for numeric fields
            const total = matchingSlips.reduce((sum, s) => sum + (Number(s.extractedData[field.slipField]) || 0), 0);
            if (total > 0) { fields[field.fieldId] = total; filled++; }
          } else {
            // For text fields, use the first slip's value
            const val = matchingSlips[0].extractedData[field.slipField];
            if (val) { fields[field.fieldId] = val; filled++; }
          }
        }
      }
      
      if (field.source === 'calculated' && field.formula) {
        const value = evaluateFormula(field.formula, fields);
        if (value !== null) { fields[field.fieldId] = value; filled++; }
      }
    }
  }

  return { fields, completeness: total > 0 ? filled / total : 0 };
}
```

### resolveSourceQuery Implementation

Maps query keys to Prisma queries against the tenant's books. All amounts in cents.

```typescript
async function resolveSourceQuery(tenantId: string, taxYear: number, query: string): Promise<number | string | null> {
  const yearStart = new Date(taxYear, 0, 1);   // Jan 1
  const yearEnd = new Date(taxYear, 11, 31);    // Dec 31

  // Revenue total — sum of credit lines on revenue accounts (code 4xxx)
  if (query === 'revenue_total') {
    const result = await db.abJournalLine.aggregate({
      _sum: { creditCents: true },
      where: { entry: { tenantId, date: { gte: yearStart, lte: yearEnd } }, account: { code: { startsWith: '4' } } },
    });
    return result._sum.creditCents || 0;
  }

  // Expense by category — sum of debit lines on specific expense account
  if (query.startsWith('expense_category:')) {
    const accountCode = query.split(':')[1];
    const result = await db.abJournalLine.aggregate({
      _sum: { debitCents: true },
      where: { entry: { tenantId, date: { gte: yearStart, lte: yearEnd } }, account: { code: accountCode } },
    });
    return result._sum.debitCents || 0;
  }

  // GST/HST collected — from AbSalesTaxCollected
  if (query === 'gst_collected') {
    const result = await db.abSalesTaxCollected.aggregate({
      _sum: { amountCents: true },
      where: { tenantId, taxType: { in: ['GST', 'HST'] }, createdAt: { gte: yearStart, lte: yearEnd } },
    });
    return result._sum.amountCents || 0;
  }

  // GST/HST ITCs — estimated from business expense tax amounts
  // Uses 13% of total deductible expenses as ITC estimate (simplified)
  // TODO: Phase B should track actual ITCs per expense via AbExpense.taxAmountCents
  if (query === 'gst_itc') {
    const expenses = await db.abJournalLine.aggregate({
      _sum: { debitCents: true },
      where: { entry: { tenantId, date: { gte: yearStart, lte: yearEnd } }, account: { code: { startsWith: '5' }, accountType: 'expense' } },
    });
    const totalExpenses = expenses._sum.debitCents || 0;
    return Math.round(totalExpenses * 13 / 113); // Extract HST portion from tax-inclusive expenses
  }

  // Tenant config fields
  if (query === 'tenant_business_name') {
    const config = await db.abTenantConfig.findFirst({ where: { userId: tenantId } });
    return config?.businessType || 'Freelance Business';
  }
  if (query === 'tenant_region') {
    const config = await db.abTenantConfig.findFirst({ where: { userId: tenantId } });
    return config?.region || 'ON';
  }
  if (query === 'fiscal_year_start') return `${taxYear}-01-01`;
  if (query === 'fiscal_year_end') return `${taxYear}-12-31`;
  if (query === 'fiscal_year_range') return `${taxYear}-01-01 to ${taxYear}-12-31`;
  if (query === 'ca_basic_personal_2025') return 1609500; // $16,095 for 2025

  return null;
}
```

### evaluateFormula Grammar

Formulas support arithmetic, built-in functions, and cross-form references.

**Grammar:**
```
formula     = expression
expression  = term (('+' | '-') term)*
term        = factor (('*' | '/') factor)*
factor      = NUMBER | FIELD_REF | FUNCTION_CALL | '(' expression ')'
FIELD_REF   = fieldId | formCode '.' fieldId
FUNCTION_CALL = FUNC_NAME '(' args ')'
args        = expression (',' expression)*
FUNC_NAME   = 'SUM' | 'MAX' | 'MIN' | 'PROGRESSIVE_TAX' | 'PROVINCIAL_TAX'
```

**Built-in functions:**

| Function | Args | Description |
|----------|------|-------------|
| `SUM(a, b, c, ...)` | N field references | Sum all values (treats null as 0) |
| `MAX(a, b)` | 2 expressions | Return larger value |
| `MIN(a, b)` | 2 expressions | Return smaller value |
| `PROGRESSIVE_TAX(income, bracket_key)` | income + bracket ID | Apply progressive tax brackets |
| `PROVINCIAL_TAX(income, province_code)` | income + province | Look up provincial brackets and calculate |

**Cross-form references:** `T2125.net_income_9369` resolves to the value of `net_income_9369` in the T2125 form within the same `AbTaxFiling.forms` JSON.

**Resolution order:** Forms are processed in dependency order. T2125 first (no deps), then GST/HST (no deps), then T1 (depends on T2125), then Schedule 1 (depends on T1). Circular dependency between T1 and Schedule 1 is resolved by a **two-pass approach**: first pass calculates T1 up to `taxable_income_26000`, then Schedule 1 calculates federal tax, then T1 second pass fills `federal_tax_40400` from Schedule 1.

**Implementation:** A simple recursive-descent parser (~100 lines). Field references resolve against a `fields` map that includes all forms' fields in the current filing. Division by zero returns 0.

### SIN Encryption

SIN and other sensitive fields (marked with a `sensitive: true` flag in the form template) are encrypted before storage:

- **Algorithm:** AES-256-GCM
- **Key:** Derived from `TAX_ENCRYPTION_KEY` environment variable via PBKDF2
- **Storage:** Encrypted value stored as `{ iv, ciphertext, tag }` JSON in the `AbTaxFiling.forms` field
- **Decryption:** Only when generating export data or displaying to the user
- **Access:** Only the filing owner (tenantId match) can trigger decryption

```typescript
// In FormField, add optional flag:
sensitive?: boolean; // true for SIN, bank account numbers
```

### Filing Type Support

To support multiple filings per year (personal return vs quarterly GST/HST):

Change `AbTaxFiling` unique constraint:
```prisma
  filingType    String   @default("personal_return")  // personal_return | sales_tax_q1 | sales_tax_q2 | ...
  @@unique([tenantId, taxYear, filingType])            // allows multiple filings per year
```

### Meals 50% Deduction

The T2125 meals field (`meals_8523`) sourceQuery is updated to apply the 50% CRA rule:

```typescript
// In resolveSourceQuery:
if (query === 'expense_category:6400:meals_50pct') {
  const result = await db.abJournalLine.aggregate({
    _sum: { debitCents: true },
    where: { entry: { tenantId, date: { gte: yearStart, lte: yearEnd } }, account: { code: '6400' } },
  });
  return Math.round((result._sum.debitCents || 0) * 0.5); // CRA 50% rule
}
```

The T2125 template field is updated: `"sourceQuery": "expense_category:6400:meals_50pct"`.

### CPP Self-Employment Calculation

Replace the oversimplified formula with a proper Schedule 8 reference:

```typescript
// The CPP self-employment calculation is non-trivial:
// 1. Basic exemption: $3,500
// 2. Maximum pensionable earnings: $71,300 (2025)
// 3. Rate: 11.90% (both employee + employer portions)
// 4. CPP2 additional: on earnings between $71,300 and $79,400 at 8%
// This is implemented as a built-in function in evaluateFormula:

if (query === 'SCHEDULE8_CPP') {
  // Actual Schedule 8 calculation
  const netSEIncome = fields['T2125.net_income_9369'] || 0;
  const basicExemption = 350000; // $3,500 in cents
  const maxPensionable = 7130000; // $71,300
  const rate = 0.1190;
  const pensionable = Math.min(maxPensionable, Math.max(0, netSEIncome)) - basicExemption;
  return Math.max(0, Math.round(pensionable * rate));
}
```

T1 field updated: `"formula": "SCHEDULE8_CPP(T2125.net_income_9369)"`.

## Canadian Form Templates (2025)

### T2125 — Statement of Business or Professional Activities

```json
{
  "jurisdiction": "ca",
  "formCode": "T2125",
  "formName": "Statement of Business or Professional Activities",
  "version": "2025",
  "category": "business_income",
  "sections": [
    {
      "sectionId": "identification",
      "title": "Part 1 — Identification",
      "fields": [
        { "fieldId": "business_name", "label": "Name of business", "lineNumber": "", "type": "text", "required": true, "source": "auto", "sourceQuery": "tenant_business_name" },
        { "fieldId": "fiscal_period_start", "label": "Fiscal period start", "lineNumber": "", "type": "date", "required": true, "source": "auto", "sourceQuery": "fiscal_year_start" },
        { "fieldId": "fiscal_period_end", "label": "Fiscal period end", "lineNumber": "", "type": "date", "required": true, "source": "auto", "sourceQuery": "fiscal_year_end" },
        { "fieldId": "industry_code", "label": "Industry code (NAICS)", "lineNumber": "", "type": "text", "required": true, "source": "manual", "helpText": "6-digit NAICS code. Consultants: 541611, Software: 541511" }
      ]
    },
    {
      "sectionId": "income",
      "title": "Part 3 — Gross Business or Professional Income",
      "fields": [
        { "fieldId": "gross_sales_8000", "label": "Gross sales, commissions, or fees", "lineNumber": "8000", "type": "currency", "required": true, "source": "auto", "sourceQuery": "revenue_total" },
        { "fieldId": "gst_hst_collected_8000a", "label": "GST/HST collected (included in line 8000)", "lineNumber": "8000a", "type": "currency", "required": false, "source": "auto", "sourceQuery": "gst_collected" },
        { "fieldId": "adjusted_gross_8299", "label": "Adjusted gross income", "lineNumber": "8299", "type": "currency", "required": true, "source": "calculated", "formula": "gross_sales_8000 - gst_hst_collected_8000a" }
      ]
    },
    {
      "sectionId": "expenses",
      "title": "Part 4 — Net Income (Loss)",
      "fields": [
        { "fieldId": "advertising_8520", "label": "Advertising", "lineNumber": "8520", "type": "currency", "required": false, "source": "auto", "sourceQuery": "expense_category:5000" },
        { "fieldId": "meals_8523", "label": "Meals and entertainment (50% deductible)", "lineNumber": "8523", "type": "currency", "required": false, "source": "auto", "sourceQuery": "expense_category:6400:meals_50pct" },
        { "fieldId": "insurance_8690", "label": "Insurance", "lineNumber": "8690", "type": "currency", "required": false, "source": "auto", "sourceQuery": "expense_category:5400" },
        { "fieldId": "office_8810", "label": "Office expenses", "lineNumber": "8810", "type": "currency", "required": false, "source": "auto", "sourceQuery": "expense_category:5800" },
        { "fieldId": "supplies_8811", "label": "Supplies", "lineNumber": "8811", "type": "currency", "required": false, "source": "auto", "sourceQuery": "expense_category:6100" },
        { "fieldId": "legal_8860", "label": "Legal, accounting, and professional fees", "lineNumber": "8860", "type": "currency", "required": false, "source": "auto", "sourceQuery": "expense_category:5700" },
        { "fieldId": "travel_8910", "label": "Travel", "lineNumber": "8910", "type": "currency", "required": false, "source": "auto", "sourceQuery": "expense_category:6300" },
        { "fieldId": "phone_utilities_8920", "label": "Telephone and utilities", "lineNumber": "8920", "type": "currency", "required": false, "source": "auto", "sourceQuery": "expense_category:6500" },
        { "fieldId": "other_expenses_9270", "label": "Other expenses (software, subscriptions)", "lineNumber": "9270", "type": "currency", "required": false, "source": "auto", "sourceQuery": "expense_category:6600" },
        { "fieldId": "total_expenses_9368", "label": "Total expenses", "lineNumber": "9368", "type": "currency", "required": true, "source": "calculated", "formula": "SUM(advertising_8520,meals_8523,insurance_8690,office_8810,supplies_8811,legal_8860,travel_8910,phone_utilities_8920,other_expenses_9270)" },
        { "fieldId": "net_income_9369", "label": "Net income (loss)", "lineNumber": "9369", "type": "currency", "required": true, "source": "calculated", "formula": "adjusted_gross_8299 - total_expenses_9368" }
      ]
    },
    {
      "sectionId": "vehicle",
      "title": "Part 5 — Motor Vehicle Expenses",
      "fields": [
        { "fieldId": "vehicle_total_km", "label": "Total kilometres driven", "lineNumber": "", "type": "number", "required": false, "source": "manual", "helpText": "Total km driven in the tax year (personal + business)" },
        { "fieldId": "vehicle_business_km", "label": "Business kilometres", "lineNumber": "", "type": "number", "required": false, "source": "manual" },
        { "fieldId": "vehicle_expenses_total", "label": "Total vehicle expenses", "lineNumber": "", "type": "currency", "required": false, "source": "auto", "sourceQuery": "expense_category:5100" },
        { "fieldId": "vehicle_business_portion", "label": "Business portion of vehicle expenses", "lineNumber": "9281", "type": "currency", "required": false, "source": "calculated", "formula": "vehicle_expenses_total * (vehicle_business_km / vehicle_total_km)" }
      ]
    },
    {
      "sectionId": "home_office",
      "title": "Part 7 — Business-use-of-home Expenses",
      "fields": [
        { "fieldId": "home_office_pct", "label": "Business-use percentage of home", "lineNumber": "", "type": "percent", "required": false, "source": "manual", "helpText": "Square footage of office / total home square footage" },
        { "fieldId": "home_rent", "label": "Rent", "lineNumber": "", "type": "currency", "required": false, "source": "auto", "sourceQuery": "expense_category:5900" },
        { "fieldId": "home_utilities", "label": "Utilities (heat, electricity, water)", "lineNumber": "", "type": "currency", "required": false, "source": "manual" },
        { "fieldId": "home_insurance", "label": "Home insurance", "lineNumber": "", "type": "currency", "required": false, "source": "manual" },
        { "fieldId": "home_office_deduction", "label": "Business-use-of-home deduction", "lineNumber": "9945", "type": "currency", "required": false, "source": "calculated", "formula": "(home_rent + home_utilities + home_insurance) * (home_office_pct / 100)" }
      ]
    }
  ]
}
```

### T1 General — Personal Income Tax Return

```json
{
  "jurisdiction": "ca",
  "formCode": "T1",
  "formName": "T1 General Income Tax and Benefit Return",
  "version": "2025",
  "category": "personal_return",
  "dependencies": ["T2125"],
  "sections": [
    {
      "sectionId": "identification",
      "title": "Identification",
      "fields": [
        { "fieldId": "full_name", "label": "Full legal name", "lineNumber": "", "type": "text", "required": true, "source": "manual" },
        { "fieldId": "sin", "label": "Social Insurance Number", "lineNumber": "", "type": "text", "required": true, "source": "manual", "helpText": "9-digit SIN. Stored encrypted." },
        { "fieldId": "date_of_birth", "label": "Date of birth", "lineNumber": "", "type": "date", "required": true, "source": "manual" },
        { "fieldId": "marital_status", "label": "Marital status on Dec 31", "lineNumber": "", "type": "text", "required": true, "source": "manual", "helpText": "single, married, common-law, separated, divorced, widowed" },
        { "fieldId": "province_territory", "label": "Province/territory of residence on Dec 31", "lineNumber": "", "type": "text", "required": true, "source": "auto", "sourceQuery": "tenant_region" }
      ]
    },
    {
      "sectionId": "total_income",
      "title": "Total Income",
      "fields": [
        { "fieldId": "employment_income_10100", "label": "Employment income (T4 box 14)", "lineNumber": "10100", "type": "currency", "required": false, "source": "slip", "slipType": "T4", "slipField": "employment_income" },
        { "fieldId": "self_employment_income_13500", "label": "Self-employment income (from T2125)", "lineNumber": "13500", "type": "currency", "required": false, "source": "calculated", "formula": "T2125.net_income_9369" },
        { "fieldId": "interest_income_12100", "label": "Interest and other investment income", "lineNumber": "12100", "type": "currency", "required": false, "source": "slip", "slipType": "T5", "slipField": "interest_income" },
        { "fieldId": "dividend_income_12000", "label": "Taxable dividends", "lineNumber": "12000", "type": "currency", "required": false, "source": "slip", "slipType": "T5", "slipField": "dividends" },
        { "fieldId": "capital_gains_12700", "label": "Taxable capital gains", "lineNumber": "12700", "type": "currency", "required": false, "source": "slip", "slipType": "T3", "slipField": "capital_gains" },
        { "fieldId": "total_income_15000", "label": "Total income", "lineNumber": "15000", "type": "currency", "required": true, "source": "calculated", "formula": "SUM(employment_income_10100,self_employment_income_13500,interest_income_12100,dividend_income_12000,capital_gains_12700)" }
      ]
    },
    {
      "sectionId": "deductions",
      "title": "Deductions",
      "fields": [
        { "fieldId": "rrsp_20800", "label": "RRSP deduction", "lineNumber": "20800", "type": "currency", "required": false, "source": "slip", "slipType": "RRSP", "slipField": "contribution_amount" },
        { "fieldId": "cpp_self_22200", "label": "CPP contributions on self-employment (Schedule 8)", "lineNumber": "22200", "type": "currency", "required": false, "source": "calculated", "formula": "SCHEDULE8_CPP(T2125.net_income_9369)" },
        { "fieldId": "cpp_employee_22215", "label": "CPP contributions (from T4 box 16)", "lineNumber": "22215", "type": "currency", "required": false, "source": "slip", "slipType": "T4", "slipField": "cpp_contributions" },
        { "fieldId": "total_deductions_23300", "label": "Total deductions", "lineNumber": "23300", "type": "currency", "required": true, "source": "calculated", "formula": "SUM(rrsp_20800,cpp_self_22200,cpp_employee_22215)" },
        { "fieldId": "net_income_23600", "label": "Net income", "lineNumber": "23600", "type": "currency", "required": true, "source": "calculated", "formula": "total_income_15000 - total_deductions_23300" },
        { "fieldId": "taxable_income_26000", "label": "Taxable income", "lineNumber": "26000", "type": "currency", "required": true, "source": "calculated", "formula": "net_income_23600" }
      ]
    },
    {
      "sectionId": "tax_calculation",
      "title": "Tax Calculation (from Schedule 1)",
      "fields": [
        { "fieldId": "federal_tax_40400", "label": "Federal tax (from Schedule 1)", "lineNumber": "40400", "type": "currency", "required": true, "source": "calculated", "formula": "Schedule1.federal_tax" },
        { "fieldId": "provincial_tax_42800", "label": "Provincial tax", "lineNumber": "42800", "type": "currency", "required": true, "source": "calculated", "formula": "PROVINCIAL_TAX(taxable_income_26000, province_territory)" },
        { "fieldId": "total_tax_43500", "label": "Total payable", "lineNumber": "43500", "type": "currency", "required": true, "source": "calculated", "formula": "federal_tax_40400 + provincial_tax_42800 + cpp_self_22200" },
        { "fieldId": "tax_deducted_43700", "label": "Total income tax deducted (from T4s)", "lineNumber": "43700", "type": "currency", "required": false, "source": "slip", "slipType": "T4", "slipField": "tax_deducted" },
        { "fieldId": "balance_owing_48500", "label": "Balance owing (refund)", "lineNumber": "48500", "type": "currency", "required": true, "source": "calculated", "formula": "total_tax_43500 - tax_deducted_43700" }
      ]
    }
  ]
}
```

### GST/HST Return

```json
{
  "jurisdiction": "ca",
  "formCode": "GST-HST",
  "formName": "GST/HST Return for Registrants",
  "version": "2025",
  "category": "sales_tax",
  "sections": [
    {
      "sectionId": "sales_tax",
      "title": "GST/HST Calculation",
      "fields": [
        { "fieldId": "total_sales_101", "label": "Total revenue (line 101)", "lineNumber": "101", "type": "currency", "required": true, "source": "auto", "sourceQuery": "revenue_total" },
        { "fieldId": "gst_hst_collected_105", "label": "GST/HST collected or collectible", "lineNumber": "105", "type": "currency", "required": true, "source": "auto", "sourceQuery": "gst_collected" },
        { "fieldId": "itc_106", "label": "Input tax credits (ITCs)", "lineNumber": "106", "type": "currency", "required": true, "source": "auto", "sourceQuery": "gst_itc" },
        { "fieldId": "net_tax_109", "label": "Net tax (refund)", "lineNumber": "109", "type": "currency", "required": true, "source": "calculated", "formula": "gst_hst_collected_105 - itc_106" },
        { "fieldId": "gst_number", "label": "GST/HST registration number", "lineNumber": "", "type": "text", "required": true, "source": "manual" },
        { "fieldId": "reporting_period", "label": "Reporting period", "lineNumber": "", "type": "text", "required": true, "source": "auto", "sourceQuery": "fiscal_year_range" }
      ]
    }
  ]
}
```

### Schedule 1 — Federal Tax Calculation

```json
{
  "jurisdiction": "ca",
  "formCode": "Schedule1",
  "formName": "Schedule 1 — Federal Tax",
  "version": "2025",
  "category": "federal_calc",
  "dependencies": ["T1"],
  "sections": [
    {
      "sectionId": "federal_tax",
      "title": "Federal Tax Calculation",
      "fields": [
        { "fieldId": "taxable_income", "label": "Taxable income (from T1 line 26000)", "lineNumber": "1", "type": "currency", "required": true, "source": "calculated", "formula": "T1.taxable_income_26000" },
        { "fieldId": "federal_tax", "label": "Federal tax on taxable income", "lineNumber": "2", "type": "currency", "required": true, "source": "calculated", "formula": "PROGRESSIVE_TAX(taxable_income, ca_federal_brackets)" },
        { "fieldId": "basic_personal_30000", "label": "Basic personal amount", "lineNumber": "30000", "type": "currency", "required": true, "source": "auto", "sourceQuery": "ca_basic_personal_2025" },
        { "fieldId": "cpp_30800", "label": "CPP contributions credit", "lineNumber": "30800", "type": "currency", "required": false, "source": "calculated", "formula": "T1.cpp_employee_22215 + T1.cpp_self_22200" },
        { "fieldId": "ei_31200", "label": "EI premiums credit", "lineNumber": "31200", "type": "currency", "required": false, "source": "slip", "slipType": "T4", "slipField": "ei_premiums" },
        { "fieldId": "total_credits", "label": "Total non-refundable tax credits", "lineNumber": "35000", "type": "currency", "required": true, "source": "calculated", "formula": "(basic_personal_30000 + cpp_30800 + ei_31200) * 0.15" },
        { "fieldId": "net_federal_tax", "label": "Net federal tax", "lineNumber": "", "type": "currency", "required": true, "source": "calculated", "formula": "MAX(0, federal_tax - total_credits)" }
      ]
    }
  ]
}
```

## Pre-Processing Handlers

### tax-filing-start (INTERNAL)

```typescript
if (selectedSkill.name === 'tax-filing-start') {
  // 1. Get jurisdiction from tenant config
  // 2. Load all AbTaxFormTemplate for jurisdiction + year
  // 3. Create or resume AbTaxFiling
  // 4. Load existing AbTaxSlip records
  // 5. Auto-populate fields from AgentBook data
  // 6. Identify missing fields
  // 7. Create multi-step session plan:
  //    - Step per form (T2125, GST/HST, T1, Schedule 1)
  //    - Step for slip collection
  //    - Final evaluation step
  // 8. Return plan for user confirmation
}
```

### tax-slip-scan (INTERNAL)

```typescript
if (selectedSkill.name === 'tax-slip-scan' || (attachments?.length && activeFiling)) {
  // 1. Upload attachment to blob storage
  // 2. Call Gemini vision with prompt:
  //    "This is a Canadian tax document. Identify the type (T4, T5, T3, RRSP, TFSA, T4A, bank statement)
  //     and extract all fields as JSON."
  // 3. Parse response → create AbTaxSlip
  // 4. Auto-fill corresponding AbTaxFiling fields
  // 5. Return confirmation with extracted values
}
```

### Per-form review skills (INTERNAL)

```typescript
if (selectedSkill.name.match(/^ca-(t2125|t1|gst-hst|schedule-1)-review$/)) {
  // 1. Load AbTaxFiling for tenant
  // 2. Load form template
  // 3. Identify fields with source="manual" that are empty
  // 4. Ask user for each missing field (one at a time or batched)
  // 5. Update AbTaxFiling.forms with provided values
  // 6. Recalculate calculated fields
  // 7. Return updated completeness
}
```

## Phase B: Form Generation + Export

### Export Formats

| Format | Use Case | Implementation |
|--------|----------|---------------|
| **PDF** | Print/review, share with CPA | HTML → PDF (reuse invoice PDF pattern) |
| **CRA XML** | Upload to CRA My Account or NETFILE-compatible software | Based on CRA T1 XML schema |
| **SimpleTax/Wealthsimple .tax** | Import into Wealthsimple Tax for e-filing | JSON matching their import format |
| **JSON** | Developer API, backup | Raw form field data |

### Validation Rules (Phase B)

```typescript
interface ValidationRule {
  ruleId: string;
  description: string;
  formCode: string;
  check: string;           // expression to evaluate
  severity: "error" | "warning";
  message: string;
}

// Examples:
{ ruleId: "t1_income_match", formCode: "T1", check: "total_income_15000 > 0", severity: "error", message: "Total income cannot be zero" }
{ ruleId: "t2125_expenses_ratio", formCode: "T2125", check: "total_expenses_9368 / gross_sales_8000 < 0.95", severity: "warning", message: "Expenses exceed 95% of revenue — CRA may flag this" }
{ ruleId: "gst_registration", formCode: "GST-HST", check: "gross_sales_8000 > 3000000 || gst_number != null", severity: "error", message: "GST registration required if revenue exceeds $30,000" }
```

### tax-filing-export Skill

```typescript
if (selectedSkill.name === 'tax-filing-export') {
  // 1. Load AbTaxFiling
  // 2. Run validation rules — abort if errors
  // 3. Generate export data based on requested format:
  //    a. PDF: render HTML templates, return URL
  //    b. XML: map fields to CRA schema using exportSchema
  //    c. JSON: raw field dump
  // 4. Store in AbTaxFiling.exportData + exportUrl
  // 5. Return download link
}
```

## Phase C: E-Filing via Partner API

### Partner Integration

```
AgentBook → Partner API (Wealthsimple Tax API / certified NETFILE vendor)
  → Transmit prepared XML/JSON
  → Receive confirmation number
  → Store in AbTaxFiling (filedAt, filedRef, filedStatus)
```

### Partner Config Model

```prisma
model AbTaxFilingPartner {
  id            String   @id @default(uuid())
  jurisdiction  String                           // ca | us
  partnerName   String                           // "wealthsimple_tax" | "turbotax"
  apiUrl        String
  apiKey        String?                          // encrypted
  certId        String?                          // NETFILE certification ID
  enabled       Boolean  @default(true)
  createdAt     DateTime @default(now())

  @@unique([jurisdiction, partnerName])
  @@schema("plugin_agentbook_tax")
}
```

### tax-filing-submit Skill

```typescript
if (selectedSkill.name === 'tax-filing-submit') {
  // 1. Load AbTaxFiling — must be status "complete" or "exported"
  // 2. Run ALL validation rules — abort if any errors
  // 3. Load partner config for jurisdiction
  // 4. Transmit export data to partner API
  // 5. Receive confirmation
  // 6. Update AbTaxFiling: filedAt, filedRef, filedStatus, status = "filed"
  // 7. Return: "Filed! CRA confirmation #12345678"
}
```

### tax-filing-check Skill

```typescript
if (selectedSkill.name === 'tax-filing-check') {
  // 1. Load AbTaxFiling
  // 2. If filedRef: poll partner API for status
  // 3. Return: accepted (NOA info), rejected (error details), pending
}
```

## Evaluator Extensions

```typescript
// Tax filing quality checks
if (step.action === 'tax-filing-start') {
  if (!data?.completeness) { score -= 0.5; issues.push('Could not calculate completeness'); }
  if (data?.completeness < 0.5) { score -= 0.3; issues.push(`Only ${Math.round(data.completeness * 100)}% auto-populated — many manual fields needed`); }
}

if (step.action === 'tax-slip-scan') {
  if (data?.confidence < 0.7) { score -= 0.3; issues.push('Low OCR confidence — verify extracted values'); }
}

if (step.action.includes('-review')) {
  const completeness = data?.completeness || 0;
  score = completeness;
  if (completeness < 1.0) {
    const missing = data?.missingCount || 0;
    issues.push(`${missing} fields still missing`);
  }
}
```

## Implementation Phases

### Phase A: Filing Prep Assistant
**Scope:** Completeness checking, field collection via Telegram, document upload/OCR

**New models:** AbTaxFormTemplate, AbTaxFiling, AbTaxSlip
**New skills:** tax-filing-start, tax-filing-status, tax-filing-field, tax-slip-scan, tax-slip-list, ca-t2125-review, ca-t1-review, ca-gst-hst-review, ca-schedule-1-review
**New endpoints:** POST /tax-slips/ocr, GET /tax-filing/:year, POST /tax-filing/:year/field
**Seed data:** 4 Canadian form templates (T2125, T1, GST/HST, Schedule 1)
**Auto-population:** Wire sourceQuery to AgentBook journal entries, expenses, revenue
**Tests:** Completeness calculation, field collection flow, slip OCR, multi-step filing plan

### Phase B: Form Generation + Export
**Scope:** Validation rules, PDF generation, CRA XML export, Wealthsimple .tax export

**Depends on:** Phase A complete
**New skills:** tax-filing-export, tax-filing-validate
**New in AbTaxFormTemplate:** exportSchema (CRA XML field mapping), validationRules
**Endpoints:** POST /tax-filing/:year/export, GET /tax-filing/:year/pdf
**Tests:** Validation rules fire, PDF renders, XML matches CRA schema

### Phase C: E-Filing via Partner API
**Scope:** Partner API integration, submission, confirmation tracking

**Depends on:** Phase B complete
**New models:** AbTaxFilingPartner
**New skills:** tax-filing-submit, tax-filing-check
**Endpoints:** POST /tax-filing/:year/submit, GET /tax-filing/:year/status
**Tests:** Mock partner API, submission flow, status polling

## Backward Compatibility

- All existing 41 skills continue to work unchanged
- Existing tax-estimate, quarterly-payments, tax-deductions skills remain (they serve different purpose — quick estimates vs formal filing)
- New skills are additive — seeded via POST /agent/seed-skills
- No changes to agent-brain.ts, agent-planner.ts, agent-memory.ts, agent-evaluator.ts
- Telegram adapter needs no changes (plan/eval formatting already works; document upload already routes through agent)

## Testing Strategy

### Phase A Tests (agent-tax-filing.spec.ts)
1. tax-filing-start creates filing session
2. tax-filing-status returns completeness
3. Auto-population fills revenue/expense fields from books
4. tax-slip-scan routes correctly for photo attachment during filing
5. tax-slip-list returns uploaded slips
6. ca-t2125-review routes correctly
7. ca-t1-review routes correctly
8. ca-gst-hst-review routes correctly
9. Missing field identification works
10. Multi-step filing plan is generated

### Phase B Tests
11. Validation catches errors (zero income)
12. Validation warns on suspicious ratios
13. PDF export generates URL
14. XML export matches expected structure
15. Export blocks if validation errors exist

### Phase C Tests
16. Submit requires "complete" status
17. Submit calls partner API (mocked)
18. Filing status shows confirmation
19. Rejected filing shows error details
20. Re-submit after fix works
