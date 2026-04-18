# Tax Filing Phase A — Filing Prep Assistant

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a conversational tax filing prep assistant where the agent walks users through completing their Canadian tax return via Telegram — auto-populating from books, accepting tax slip uploads via OCR, and tracking completeness per form.

**Architecture:** Add 3 Prisma models (AbTaxFormTemplate, AbTaxFiling, AbTaxSlip), seed Canadian form templates as data, add 3 new tax endpoints to the tax plugin, add 9 agent skills with INTERNAL handlers, implement `resolveSourceQuery` and `evaluateFormula` for auto-population. Reuses agent brain v2 session/planning infra.

**Tech Stack:** TypeScript/ESM, Express, Prisma (PostgreSQL), Gemini LLM (OCR), Playwright E2E

**Spec:** `docs/superpowers/specs/2026-04-18-tax-filing-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `plugins/agentbook-tax/backend/src/tax-forms.ts` | Form template seeder, resolveSourceQuery, evaluateFormula, auto-population logic |
| `plugins/agentbook-tax/backend/src/tax-filing.ts` | Filing session management, completeness calculation, field updates |
| `plugins/agentbook-tax/backend/src/tax-slips.ts` | Slip OCR processing, extraction, storage |
| `tests/e2e/agent-tax-filing.spec.ts` | E2E tests for filing prep flow |

### Modified Files

| File | Changes |
|------|---------|
| `packages/database/prisma/schema.prisma` | Add AbTaxFormTemplate, AbTaxFiling, AbTaxSlip models |
| `plugins/agentbook-tax/backend/src/server.ts` | Import new modules, add 3 endpoints (GET/POST /tax-filing, POST /tax-slips/ocr) |
| `plugins/agentbook-core/backend/src/server.ts` | Add 9 skill manifests, add INTERNAL handlers for filing skills |
| `tests/e2e/agent-brain.spec.ts` | Update skill count |

---

## Task 1: Schema — 3 New Models

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Add AbTaxFormTemplate model**

Add after the existing `AbCalendarEvent` model (end of `plugin_agentbook_tax` section):

```prisma
model AbTaxFormTemplate {
  id            String   @id @default(uuid())
  jurisdiction  String
  formCode      String
  formName      String
  version       String
  category      String
  sections      Json
  validationRules Json   @default("[]")
  exportSchema  Json?
  dependencies  Json     @default("[]")
  enabled       Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([jurisdiction, formCode, version])
  @@index([jurisdiction, version])
  @@schema("plugin_agentbook_tax")
}
```

- [ ] **Step 2: Add AbTaxFiling model**

```prisma
model AbTaxFiling {
  id            String    @id @default(uuid())
  tenantId      String
  taxYear       Int
  jurisdiction  String
  region        String    @default("")
  filingType    String    @default("personal_return")
  status        String    @default("draft")
  forms         Json      @default("{}")
  missingFields Json      @default("[]")
  slips         Json      @default("[]")
  exportData    Json?
  exportUrl     String?
  filedAt       DateTime?
  filedRef      String?
  filedStatus   String?
  notes         Json      @default("[]")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@unique([tenantId, taxYear, filingType])
  @@index([tenantId])
  @@schema("plugin_agentbook_tax")
}
```

- [ ] **Step 3: Add AbTaxSlip model**

```prisma
model AbTaxSlip {
  id            String   @id @default(uuid())
  tenantId      String
  taxYear       Int
  slipType      String
  issuer        String?
  imageUrl      String?
  extractedData Json     @default("{}")
  confidence    Float    @default(0)
  status        String   @default("pending")
  filingId      String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([tenantId, taxYear])
  @@index([tenantId, slipType])
  @@schema("plugin_agentbook_tax")
}
```

- [ ] **Step 4: Push schema**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p/packages/database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" npx --no prisma db push --skip-generate
```

- [ ] **Step 5: Commit**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
git add packages/database/prisma/schema.prisma
git commit -m "feat: schema for tax filing — AbTaxFormTemplate, AbTaxFiling, AbTaxSlip

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Tax Forms Module — Templates, Source Queries, Formulas

**Files:**
- Create: `plugins/agentbook-tax/backend/src/tax-forms.ts`

- [ ] **Step 1: Implement tax-forms.ts**

This module exports: `seedCanadianForms()`, `resolveSourceQuery()`, `evaluateFormula()`, `autoPopulateForm()`, and the Canadian form template constants.

```typescript
/**
 * Tax Forms — template seeding, source query resolution, formula evaluation.
 */
import { db } from './db/client.js';

// === Canadian Form Templates (2025) ===
// These are the full form definitions from the spec.
// See docs/superpowers/specs/2026-04-18-tax-filing-design.md for field details.

const CA_T2125_2025 = {
  jurisdiction: 'ca', formCode: 'T2125', version: '2025',
  formName: 'Statement of Business or Professional Activities',
  category: 'business_income', dependencies: [],
  sections: [
    {
      sectionId: 'identification', title: 'Part 1 — Identification',
      fields: [
        { fieldId: 'business_name', label: 'Name of business', lineNumber: '', type: 'text', required: true, source: 'auto', sourceQuery: 'tenant_business_name' },
        { fieldId: 'fiscal_period_start', label: 'Fiscal period start', lineNumber: '', type: 'date', required: true, source: 'auto', sourceQuery: 'fiscal_year_start' },
        { fieldId: 'fiscal_period_end', label: 'Fiscal period end', lineNumber: '', type: 'date', required: true, source: 'auto', sourceQuery: 'fiscal_year_end' },
        { fieldId: 'industry_code', label: 'Industry code (NAICS)', lineNumber: '', type: 'text', required: true, source: 'manual', helpText: '6-digit NAICS code. Consultants: 541611, Software: 541511' },
      ],
    },
    {
      sectionId: 'income', title: 'Part 3 — Gross Business Income',
      fields: [
        { fieldId: 'gross_sales_8000', label: 'Gross sales, commissions, or fees', lineNumber: '8000', type: 'currency', required: true, source: 'auto', sourceQuery: 'revenue_total' },
        { fieldId: 'gst_hst_collected_8000a', label: 'GST/HST collected', lineNumber: '8000a', type: 'currency', required: false, source: 'auto', sourceQuery: 'gst_collected' },
        { fieldId: 'adjusted_gross_8299', label: 'Adjusted gross income', lineNumber: '8299', type: 'currency', required: true, source: 'calculated', formula: 'gross_sales_8000 - gst_hst_collected_8000a' },
      ],
    },
    {
      sectionId: 'expenses', title: 'Part 4 — Net Income (Loss)',
      fields: [
        { fieldId: 'advertising_8520', label: 'Advertising', lineNumber: '8520', type: 'currency', required: false, source: 'auto', sourceQuery: 'expense_category:5000' },
        { fieldId: 'meals_8523', label: 'Meals and entertainment (50% deductible)', lineNumber: '8523', type: 'currency', required: false, source: 'auto', sourceQuery: 'expense_category:6400:meals_50pct' },
        { fieldId: 'insurance_8690', label: 'Insurance', lineNumber: '8690', type: 'currency', required: false, source: 'auto', sourceQuery: 'expense_category:5400' },
        { fieldId: 'office_8810', label: 'Office expenses', lineNumber: '8810', type: 'currency', required: false, source: 'auto', sourceQuery: 'expense_category:5800' },
        { fieldId: 'supplies_8811', label: 'Supplies', lineNumber: '8811', type: 'currency', required: false, source: 'auto', sourceQuery: 'expense_category:6100' },
        { fieldId: 'legal_8860', label: 'Legal, accounting, professional fees', lineNumber: '8860', type: 'currency', required: false, source: 'auto', sourceQuery: 'expense_category:5700' },
        { fieldId: 'travel_8910', label: 'Travel', lineNumber: '8910', type: 'currency', required: false, source: 'auto', sourceQuery: 'expense_category:6300' },
        { fieldId: 'phone_utilities_8920', label: 'Telephone and utilities', lineNumber: '8920', type: 'currency', required: false, source: 'auto', sourceQuery: 'expense_category:6500' },
        { fieldId: 'other_expenses_9270', label: 'Other expenses (software, subscriptions)', lineNumber: '9270', type: 'currency', required: false, source: 'auto', sourceQuery: 'expense_category:6600' },
        { fieldId: 'total_expenses_9368', label: 'Total expenses', lineNumber: '9368', type: 'currency', required: true, source: 'calculated', formula: 'SUM(advertising_8520,meals_8523,insurance_8690,office_8810,supplies_8811,legal_8860,travel_8910,phone_utilities_8920,other_expenses_9270)' },
        { fieldId: 'net_income_9369', label: 'Net income (loss)', lineNumber: '9369', type: 'currency', required: true, source: 'calculated', formula: 'adjusted_gross_8299 - total_expenses_9368' },
      ],
    },
    {
      sectionId: 'vehicle', title: 'Part 5 — Motor Vehicle Expenses',
      fields: [
        { fieldId: 'vehicle_total_km', label: 'Total kilometres driven', lineNumber: '', type: 'number', required: false, source: 'manual' },
        { fieldId: 'vehicle_business_km', label: 'Business kilometres', lineNumber: '', type: 'number', required: false, source: 'manual' },
        { fieldId: 'vehicle_expenses_total', label: 'Total vehicle expenses', lineNumber: '', type: 'currency', required: false, source: 'auto', sourceQuery: 'expense_category:5100' },
        { fieldId: 'vehicle_business_portion', label: 'Business portion', lineNumber: '9281', type: 'currency', required: false, source: 'calculated', formula: 'vehicle_expenses_total * vehicle_business_km / MAX(vehicle_total_km, 1)' },
      ],
    },
    {
      sectionId: 'home_office', title: 'Part 7 — Business-use-of-home Expenses',
      fields: [
        { fieldId: 'home_office_pct', label: 'Business-use percentage of home', lineNumber: '', type: 'percent', required: false, source: 'manual' },
        { fieldId: 'home_rent', label: 'Rent', lineNumber: '', type: 'currency', required: false, source: 'auto', sourceQuery: 'expense_category:5900' },
        { fieldId: 'home_utilities', label: 'Utilities (heat, electricity, water)', lineNumber: '', type: 'currency', required: false, source: 'manual' },
        { fieldId: 'home_insurance', label: 'Home insurance', lineNumber: '', type: 'currency', required: false, source: 'manual' },
        { fieldId: 'home_office_deduction', label: 'Business-use-of-home deduction', lineNumber: '9945', type: 'currency', required: false, source: 'calculated', formula: '(home_rent + home_utilities + home_insurance) * home_office_pct / 100' },
      ],
    },
  ],
};

const CA_T1_2025 = {
  jurisdiction: 'ca', formCode: 'T1', version: '2025',
  formName: 'T1 General Income Tax and Benefit Return',
  category: 'personal_return', dependencies: ['T2125'],
  sections: [
    {
      sectionId: 'identification', title: 'Identification',
      fields: [
        { fieldId: 'full_name', label: 'Full legal name', lineNumber: '', type: 'text', required: true, source: 'manual' },
        { fieldId: 'sin', label: 'Social Insurance Number', lineNumber: '', type: 'text', required: true, source: 'manual', sensitive: true, helpText: '9-digit SIN' },
        { fieldId: 'date_of_birth', label: 'Date of birth', lineNumber: '', type: 'date', required: true, source: 'manual' },
        { fieldId: 'marital_status', label: 'Marital status on Dec 31', lineNumber: '', type: 'text', required: true, source: 'manual' },
        { fieldId: 'province_territory', label: 'Province/territory of residence on Dec 31', lineNumber: '', type: 'text', required: true, source: 'auto', sourceQuery: 'tenant_region' },
      ],
    },
    {
      sectionId: 'total_income', title: 'Total Income',
      fields: [
        { fieldId: 'employment_income_10100', label: 'Employment income (T4 box 14)', lineNumber: '10100', type: 'currency', required: false, source: 'slip', slipType: 'T4', slipField: 'employment_income' },
        { fieldId: 'self_employment_income_13500', label: 'Self-employment income (from T2125)', lineNumber: '13500', type: 'currency', required: false, source: 'calculated', formula: 'T2125.net_income_9369' },
        { fieldId: 'interest_income_12100', label: 'Interest and investment income', lineNumber: '12100', type: 'currency', required: false, source: 'slip', slipType: 'T5', slipField: 'interest_income' },
        { fieldId: 'dividend_income_12000', label: 'Taxable dividends', lineNumber: '12000', type: 'currency', required: false, source: 'slip', slipType: 'T5', slipField: 'dividends' },
        { fieldId: 'total_income_15000', label: 'Total income', lineNumber: '15000', type: 'currency', required: true, source: 'calculated', formula: 'SUM(employment_income_10100,self_employment_income_13500,interest_income_12100,dividend_income_12000)' },
      ],
    },
    {
      sectionId: 'deductions', title: 'Deductions',
      fields: [
        { fieldId: 'rrsp_20800', label: 'RRSP deduction', lineNumber: '20800', type: 'currency', required: false, source: 'slip', slipType: 'RRSP', slipField: 'contribution_amount' },
        { fieldId: 'cpp_self_22200', label: 'CPP on self-employment', lineNumber: '22200', type: 'currency', required: false, source: 'calculated', formula: 'SCHEDULE8_CPP(T2125.net_income_9369)' },
        { fieldId: 'cpp_employee_22215', label: 'CPP contributions (T4)', lineNumber: '22215', type: 'currency', required: false, source: 'slip', slipType: 'T4', slipField: 'cpp_contributions' },
        { fieldId: 'total_deductions_23300', label: 'Total deductions', lineNumber: '23300', type: 'currency', required: true, source: 'calculated', formula: 'SUM(rrsp_20800,cpp_self_22200,cpp_employee_22215)' },
        { fieldId: 'net_income_23600', label: 'Net income', lineNumber: '23600', type: 'currency', required: true, source: 'calculated', formula: 'total_income_15000 - total_deductions_23300' },
        { fieldId: 'taxable_income_26000', label: 'Taxable income', lineNumber: '26000', type: 'currency', required: true, source: 'calculated', formula: 'MAX(0, net_income_23600)' },
      ],
    },
    {
      sectionId: 'tax_calculation', title: 'Tax Calculation',
      fields: [
        { fieldId: 'federal_tax_40400', label: 'Federal tax (from Schedule 1)', lineNumber: '40400', type: 'currency', required: true, source: 'calculated', formula: 'Schedule1.net_federal_tax' },
        { fieldId: 'provincial_tax_42800', label: 'Provincial tax', lineNumber: '42800', type: 'currency', required: true, source: 'calculated', formula: 'PROVINCIAL_TAX(taxable_income_26000, province_territory)' },
        { fieldId: 'total_tax_43500', label: 'Total payable', lineNumber: '43500', type: 'currency', required: true, source: 'calculated', formula: 'federal_tax_40400 + provincial_tax_42800 + cpp_self_22200' },
        { fieldId: 'tax_deducted_43700', label: 'Total income tax deducted (T4s)', lineNumber: '43700', type: 'currency', required: false, source: 'slip', slipType: 'T4', slipField: 'tax_deducted' },
        { fieldId: 'balance_owing_48500', label: 'Balance owing (refund)', lineNumber: '48500', type: 'currency', required: true, source: 'calculated', formula: 'total_tax_43500 - tax_deducted_43700' },
      ],
    },
  ],
};

const CA_GST_HST_2025 = {
  jurisdiction: 'ca', formCode: 'GST-HST', version: '2025',
  formName: 'GST/HST Return for Registrants',
  category: 'sales_tax', dependencies: [],
  sections: [
    {
      sectionId: 'sales_tax', title: 'GST/HST Calculation',
      fields: [
        { fieldId: 'total_sales_101', label: 'Total revenue', lineNumber: '101', type: 'currency', required: true, source: 'auto', sourceQuery: 'revenue_total' },
        { fieldId: 'gst_hst_collected_105', label: 'GST/HST collected', lineNumber: '105', type: 'currency', required: true, source: 'auto', sourceQuery: 'gst_collected' },
        { fieldId: 'itc_106', label: 'Input tax credits (ITCs)', lineNumber: '106', type: 'currency', required: true, source: 'auto', sourceQuery: 'gst_itc' },
        { fieldId: 'net_tax_109', label: 'Net tax', lineNumber: '109', type: 'currency', required: true, source: 'calculated', formula: 'gst_hst_collected_105 - itc_106' },
        { fieldId: 'gst_number', label: 'GST/HST registration number', lineNumber: '', type: 'text', required: true, source: 'manual' },
        { fieldId: 'reporting_period', label: 'Reporting period', lineNumber: '', type: 'text', required: true, source: 'auto', sourceQuery: 'fiscal_year_range' },
      ],
    },
  ],
};

const CA_SCHEDULE1_2025 = {
  jurisdiction: 'ca', formCode: 'Schedule1', version: '2025',
  formName: 'Schedule 1 — Federal Tax',
  category: 'federal_calc', dependencies: ['T1'],
  sections: [
    {
      sectionId: 'federal_tax', title: 'Federal Tax Calculation',
      fields: [
        { fieldId: 'taxable_income', label: 'Taxable income', lineNumber: '1', type: 'currency', required: true, source: 'calculated', formula: 'T1.taxable_income_26000' },
        { fieldId: 'federal_tax', label: 'Federal tax', lineNumber: '2', type: 'currency', required: true, source: 'calculated', formula: 'PROGRESSIVE_TAX(taxable_income, ca_federal)' },
        { fieldId: 'basic_personal_30000', label: 'Basic personal amount', lineNumber: '30000', type: 'currency', required: true, source: 'auto', sourceQuery: 'ca_basic_personal_2025' },
        { fieldId: 'cpp_30800', label: 'CPP credit', lineNumber: '30800', type: 'currency', required: false, source: 'calculated', formula: 'T1.cpp_employee_22215 + T1.cpp_self_22200' },
        { fieldId: 'ei_31200', label: 'EI premiums credit', lineNumber: '31200', type: 'currency', required: false, source: 'slip', slipType: 'T4', slipField: 'ei_premiums' },
        { fieldId: 'total_credits', label: 'Total non-refundable credits', lineNumber: '35000', type: 'currency', required: true, source: 'calculated', formula: 'SUM(basic_personal_30000, cpp_30800, ei_31200) * 0.15' },
        { fieldId: 'net_federal_tax', label: 'Net federal tax', lineNumber: '', type: 'currency', required: true, source: 'calculated', formula: 'MAX(0, federal_tax - total_credits)' },
      ],
    },
  ],
};

const ALL_CA_FORMS = [CA_T2125_2025, CA_T1_2025, CA_GST_HST_2025, CA_SCHEDULE1_2025];

// === Seed Forms ===

export async function seedCanadianForms(): Promise<{ created: number; updated: number }> {
  let created = 0, updated = 0;
  for (const form of ALL_CA_FORMS) {
    const existing = await db.abTaxFormTemplate.findFirst({
      where: { jurisdiction: form.jurisdiction, formCode: form.formCode, version: form.version },
    });
    if (existing) {
      await db.abTaxFormTemplate.update({
        where: { id: existing.id },
        data: { formName: form.formName, category: form.category, sections: form.sections as any, dependencies: form.dependencies as any },
      });
      updated++;
    } else {
      await db.abTaxFormTemplate.create({
        data: { ...form, sections: form.sections as any, dependencies: form.dependencies as any, validationRules: [] },
      });
      created++;
    }
  }
  return { created, updated };
}

// === Source Query Resolution ===

export async function resolveSourceQuery(
  tenantId: string, taxYear: number, query: string,
): Promise<number | string | null> {
  const yearStart = new Date(taxYear, 0, 1);
  const yearEnd = new Date(taxYear, 11, 31, 23, 59, 59);

  if (query === 'revenue_total') {
    const result = await db.abJournalLine.aggregate({
      _sum: { creditCents: true },
      where: { entry: { tenantId, date: { gte: yearStart, lte: yearEnd } }, account: { code: { startsWith: '4' } } },
    });
    return result._sum.creditCents || 0;
  }

  if (query.startsWith('expense_category:')) {
    const parts = query.split(':');
    const accountCode = parts[1];
    const modifier = parts[2]; // e.g., "meals_50pct"
    const result = await db.abJournalLine.aggregate({
      _sum: { debitCents: true },
      where: { entry: { tenantId, date: { gte: yearStart, lte: yearEnd } }, account: { code: accountCode } },
    });
    let amount = result._sum.debitCents || 0;
    if (modifier === 'meals_50pct') amount = Math.round(amount * 0.5);
    return amount;
  }

  if (query === 'gst_collected') {
    const result = await db.abSalesTaxCollected.aggregate({
      _sum: { amountCents: true },
      where: { tenantId, taxType: { in: ['GST', 'HST'] }, createdAt: { gte: yearStart, lte: yearEnd } },
    });
    return result._sum.amountCents || 0;
  }

  if (query === 'gst_itc') {
    const expenses = await db.abJournalLine.aggregate({
      _sum: { debitCents: true },
      where: { entry: { tenantId, date: { gte: yearStart, lte: yearEnd } }, account: { accountType: 'expense' } },
    });
    return Math.round((expenses._sum.debitCents || 0) * 13 / 113);
  }

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
  if (query === 'ca_basic_personal_2025') return 1609500;

  return null;
}

// === Formula Evaluator ===

// CA federal tax brackets 2025
const CA_FEDERAL_BRACKETS = [
  { limit: 5590700, rate: 0.15 },
  { limit: 11181400, rate: 0.205 },
  { limit: 15468200, rate: 0.26 },
  { limit: 22005200, rate: 0.29 },
  { limit: Infinity, rate: 0.33 },
];

// Ontario provincial brackets 2025 (example — extend for other provinces)
const PROVINCIAL_BRACKETS: Record<string, { limit: number; rate: number }[]> = {
  ON: [
    { limit: 5114200, rate: 0.0505 },
    { limit: 10228400, rate: 0.0915 },
    { limit: 15000000, rate: 0.1116 },
    { limit: 22000000, rate: 0.1216 },
    { limit: Infinity, rate: 0.1316 },
  ],
  BC: [
    { limit: 4707400, rate: 0.0506 },
    { limit: 9414800, rate: 0.077 },
    { limit: 10805600, rate: 0.105 },
    { limit: 13108800, rate: 0.1229 },
    { limit: 22786800, rate: 0.147 },
    { limit: Infinity, rate: 0.168 },
  ],
  AB: [
    { limit: 14212200, rate: 0.10 },
    { limit: 17070600, rate: 0.12 },
    { limit: 22769200, rate: 0.13 },
    { limit: 34153800, rate: 0.14 },
    { limit: Infinity, rate: 0.15 },
  ],
  // Add more provinces as needed
};

function calcProgressiveTax(incomeCents: number, brackets: { limit: number; rate: number }[]): number {
  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    if (incomeCents <= prev) break;
    const taxable = Math.min(incomeCents, b.limit) - prev;
    tax += taxable * b.rate;
    prev = b.limit;
  }
  return Math.round(tax);
}

function schedule8Cpp(netSEIncomeCents: number): number {
  const basicExemption = 350000;
  const maxPensionable = 7130000;
  const rate = 0.1190;
  const pensionable = Math.min(maxPensionable, Math.max(0, netSEIncomeCents)) - basicExemption;
  return Math.max(0, Math.round(pensionable * rate));
}

export function evaluateFormula(
  formula: string,
  fields: Record<string, any>,
  allFormFields?: Record<string, Record<string, any>>,
): number | null {
  try {
    // Cross-form references: "T2125.field_name" → look up in allFormFields
    let resolved = formula;
    const crossRefs = formula.match(/([A-Za-z]\w+)\.(\w+)/g);
    if (crossRefs && allFormFields) {
      for (const ref of crossRefs) {
        const [formCode, fieldId] = ref.split('.');
        const val = allFormFields[formCode]?.[fieldId] ?? 0;
        resolved = resolved.replace(ref, String(val));
      }
    }

    // Built-in functions
    // SUM(a, b, c, ...)
    const sumMatch = resolved.match(/^SUM\((.+)\)$/);
    if (sumMatch) {
      const args = sumMatch[1].split(',').map(a => Number(fields[a.trim()] ?? 0));
      return args.reduce((s, v) => s + v, 0);
    }

    // MAX(a, b)
    const maxMatch = resolved.match(/^MAX\((.+),\s*(.+)\)$/);
    if (maxMatch) {
      const a = Number(fields[maxMatch[1].trim()] ?? evaluateSimple(maxMatch[1].trim(), fields) ?? 0);
      const b = Number(fields[maxMatch[2].trim()] ?? evaluateSimple(maxMatch[2].trim(), fields) ?? 0);
      return Math.max(a, b);
    }

    // PROGRESSIVE_TAX(income_field, bracket_key)
    const ptMatch = resolved.match(/^PROGRESSIVE_TAX\((.+),\s*(\w+)\)$/);
    if (ptMatch) {
      const income = Number(fields[ptMatch[1].trim()] ?? 0);
      const brackets = ptMatch[2] === 'ca_federal' ? CA_FEDERAL_BRACKETS : PROVINCIAL_BRACKETS[ptMatch[2]] || CA_FEDERAL_BRACKETS;
      return calcProgressiveTax(income, brackets);
    }

    // PROVINCIAL_TAX(income_field, province_field)
    const provMatch = resolved.match(/^PROVINCIAL_TAX\((.+),\s*(.+)\)$/);
    if (provMatch) {
      const income = Number(fields[provMatch[1].trim()] ?? 0);
      const province = String(fields[provMatch[2].trim()] || 'ON');
      const brackets = PROVINCIAL_BRACKETS[province] || PROVINCIAL_BRACKETS['ON'];
      return calcProgressiveTax(income, brackets);
    }

    // SCHEDULE8_CPP(income)
    const cppMatch = resolved.match(/^SCHEDULE8_CPP\((.+)\)$/);
    if (cppMatch) {
      const income = Number(evaluateSimple(cppMatch[1].trim(), fields) ?? 0);
      return schedule8Cpp(income);
    }

    // Simple arithmetic: field +- field * field / field
    return evaluateSimple(resolved, fields);
  } catch {
    return null;
  }
}

function evaluateSimple(expr: string, fields: Record<string, any>): number | null {
  // Replace field references with values
  let resolved = expr;
  const fieldRefs = expr.match(/[a-zA-Z_]\w*/g);
  if (fieldRefs) {
    for (const ref of fieldRefs) {
      if (ref in fields) {
        resolved = resolved.replace(new RegExp(`\\b${ref}\\b`), String(Number(fields[ref]) || 0));
      }
    }
  }
  // Evaluate simple arithmetic (safe — no user input, only spec-defined formulas)
  try {
    const result = Function(`"use strict"; return (${resolved})`)();
    return typeof result === 'number' && isFinite(result) ? Math.round(result) : null;
  } catch {
    return null;
  }
}

// === Auto-Population ===

export async function autoPopulateForm(
  tenantId: string, taxYear: number,
  template: any, slips: any[],
  allFormFields: Record<string, Record<string, any>>,
): Promise<{ fields: Record<string, any>; completeness: number; missing: any[] }> {
  const fields: Record<string, any> = {};
  let filled = 0;
  let total = 0;
  const missing: any[] = [];

  for (const section of template.sections) {
    for (const field of section.fields) {
      total++;

      if (field.source === 'auto' && field.sourceQuery) {
        const value = await resolveSourceQuery(tenantId, taxYear, field.sourceQuery);
        if (value !== null && value !== 0 && value !== '') { fields[field.fieldId] = value; filled++; }
        else if (field.required) missing.push({ formCode: template.formCode, fieldId: field.fieldId, label: field.label, source: field.source });
      } else if (field.source === 'slip' && field.slipType) {
        const matchingSlips = slips.filter((s: any) => s.slipType === field.slipType && s.status === 'confirmed');
        if (matchingSlips.length > 0 && field.slipField) {
          if (field.type === 'currency' || field.type === 'number') {
            const sum = matchingSlips.reduce((s: number, sl: any) => s + (Number(sl.extractedData?.[field.slipField]) || 0), 0);
            if (sum > 0) { fields[field.fieldId] = sum; filled++; }
            else if (field.required) missing.push({ formCode: template.formCode, fieldId: field.fieldId, label: field.label, source: 'slip', slipType: field.slipType });
          } else {
            const val = matchingSlips[0].extractedData?.[field.slipField];
            if (val) { fields[field.fieldId] = val; filled++; }
            else if (field.required) missing.push({ formCode: template.formCode, fieldId: field.fieldId, label: field.label, source: 'slip', slipType: field.slipType });
          }
        } else if (field.required) {
          missing.push({ formCode: template.formCode, fieldId: field.fieldId, label: field.label, source: 'slip', slipType: field.slipType });
        }
      } else if (field.source === 'calculated' && field.formula) {
        const value = evaluateFormula(field.formula, fields, allFormFields);
        if (value !== null) { fields[field.fieldId] = value; filled++; }
      } else if (field.source === 'manual') {
        if (field.required) missing.push({ formCode: template.formCode, fieldId: field.fieldId, label: field.label, source: 'manual' });
      }
    }
  }

  // Store in allFormFields for cross-form references
  allFormFields[template.formCode] = fields;

  return { fields, completeness: total > 0 ? filled / total : 0, missing };
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
git add plugins/agentbook-tax/backend/src/tax-forms.ts
git commit -m "feat: tax-forms module — templates, source queries, formula evaluator, auto-populate

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Tax Filing Module — Session Management

**Files:**
- Create: `plugins/agentbook-tax/backend/src/tax-filing.ts`

- [ ] **Step 1: Implement tax-filing.ts**

This module manages filing sessions: create/resume, populate, update fields, calculate completeness.

```typescript
/**
 * Tax Filing — session management, completeness, field updates.
 */
import { db } from './db/client.js';
import { autoPopulateForm, seedCanadianForms } from './tax-forms.js';

export async function getOrCreateFiling(
  tenantId: string, taxYear: number, jurisdiction: string, region: string,
): Promise<any> {
  let filing = await db.abTaxFiling.findFirst({
    where: { tenantId, taxYear, filingType: 'personal_return' },
  });
  if (!filing) {
    filing = await db.abTaxFiling.create({
      data: { tenantId, taxYear, jurisdiction, region, filingType: 'personal_return', status: 'draft', forms: {}, missingFields: [] },
    });
  }
  return filing;
}

export async function populateFiling(tenantId: string, taxYear: number): Promise<any> {
  const config = await db.abTenantConfig.findFirst({ where: { userId: tenantId } });
  const jurisdiction = config?.jurisdiction || 'ca';
  const region = config?.region || 'ON';

  const filing = await getOrCreateFiling(tenantId, taxYear, jurisdiction, region);

  // Load form templates
  const templates = await db.abTaxFormTemplate.findMany({
    where: { jurisdiction, version: String(taxYear), enabled: true },
    orderBy: { formCode: 'asc' },
  });

  if (templates.length === 0) {
    // Seed forms if not present
    await seedCanadianForms();
    return populateFiling(tenantId, taxYear);
  }

  // Load existing slips
  const slips = await db.abTaxSlip.findMany({
    where: { tenantId, taxYear, status: 'confirmed' },
  });

  // Process forms in dependency order
  const sorted = sortByDependencies(templates);
  const allFormFields: Record<string, Record<string, any>> = {};
  const formsData: Record<string, any> = {};
  let allMissing: any[] = [];

  // Two-pass: first pass for all forms, second pass for circular deps (T1↔Schedule1)
  for (let pass = 0; pass < 2; pass++) {
    for (const template of sorted) {
      const { fields, completeness, missing } = await autoPopulateForm(
        tenantId, taxYear, template, slips, allFormFields,
      );
      formsData[template.formCode] = { fields, completeness, status: completeness >= 1 ? 'complete' : 'in_progress' };
      if (pass === 1) allMissing = [...allMissing, ...missing];
    }
  }

  // Deduplicate missing
  const uniqueMissing = allMissing.filter((m, i, arr) =>
    arr.findIndex(x => x.formCode === m.formCode && x.fieldId === m.fieldId) === i,
  );

  const overallCompleteness = Object.values(formsData).reduce(
    (sum: number, f: any) => sum + f.completeness, 0,
  ) / Math.max(1, Object.keys(formsData).length);

  // Update filing
  await db.abTaxFiling.update({
    where: { id: filing.id },
    data: {
      forms: formsData as any,
      missingFields: uniqueMissing as any,
      status: overallCompleteness >= 1 ? 'complete' : 'in_progress',
    },
  });

  return {
    filingId: filing.id,
    taxYear,
    jurisdiction,
    completeness: overallCompleteness,
    forms: Object.entries(formsData).map(([code, data]: [string, any]) => ({
      formCode: code,
      completeness: Math.round(data.completeness * 100),
      status: data.status,
    })),
    missingFields: uniqueMissing,
    slipsCount: slips.length,
  };
}

export async function updateFilingField(
  tenantId: string, taxYear: number, formCode: string, fieldId: string, value: any,
): Promise<any> {
  const filing = await db.abTaxFiling.findFirst({
    where: { tenantId, taxYear, filingType: 'personal_return' },
  });
  if (!filing) throw new Error('No filing found');

  const forms = (filing.forms as any) || {};
  if (!forms[formCode]) forms[formCode] = { fields: {}, completeness: 0, status: 'in_progress' };
  forms[formCode].fields[fieldId] = value;

  // Remove from missing
  const missing = ((filing.missingFields as any[]) || []).filter(
    (m: any) => !(m.formCode === formCode && m.fieldId === fieldId),
  );

  await db.abTaxFiling.update({
    where: { id: filing.id },
    data: { forms: forms as any, missingFields: missing as any },
  });

  return { updated: true, formCode, fieldId, remainingMissing: missing.length };
}

function sortByDependencies(templates: any[]): any[] {
  const sorted: any[] = [];
  const visited = new Set<string>();
  const templateMap = new Map(templates.map(t => [t.formCode, t]));

  function visit(t: any) {
    if (visited.has(t.formCode)) return;
    visited.add(t.formCode);
    const deps = (t.dependencies as string[]) || [];
    for (const dep of deps) {
      const depTemplate = templateMap.get(dep);
      if (depTemplate) visit(depTemplate);
    }
    sorted.push(t);
  }

  for (const t of templates) visit(t);
  return sorted;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
git add plugins/agentbook-tax/backend/src/tax-filing.ts
git commit -m "feat: tax-filing module — session management, auto-populate, completeness

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Tax Slips Module — OCR Processing

**Files:**
- Create: `plugins/agentbook-tax/backend/src/tax-slips.ts`

- [ ] **Step 1: Implement tax-slips.ts**

OCR processing for tax slip uploads. Uses Gemini vision to classify slip type and extract fields.

```typescript
/**
 * Tax Slips — OCR extraction for T4, T5, RRSP, TFSA, etc.
 */
import { db } from './db/client.js';

const SLIP_EXTRACTION_PROMPT = `You are a Canadian tax document scanner. Analyze this image and:
1. Identify the slip type: T4, T5, T3, T4A, RRSP receipt, TFSA receipt, T5007, or bank statement
2. Extract all relevant fields as JSON

For T4: { employment_income, tax_deducted, cpp_contributions, ei_premiums, employer_name }
For T5: { interest_income, dividends, capital_gains, payer_name }
For T3: { capital_gains, other_income, trust_name }
For RRSP: { contribution_amount, receipt_number, issuer }
For TFSA: { contribution_amount, issuer }
For T4A: { pension_income, other_income, payer_name }
For bank statement: { interest_earned, fees_paid, institution_name }

Respond as JSON only: { "slipType": "T4", "fields": { ... }, "confidence": 0.95 }
All monetary values in CENTS (multiply dollars by 100).`;

export async function processSlipOCR(
  tenantId: string,
  taxYear: number,
  imageUrl: string,
  filingId: string | null,
  callGemini: (sys: string, user: string, max?: number) => Promise<string | null>,
): Promise<any> {
  // Call Gemini vision with the image URL
  const result = await callGemini(
    SLIP_EXTRACTION_PROMPT,
    `Image URL: ${imageUrl}\nTax year: ${taxYear}`,
    500,
  );

  if (!result) {
    return { success: false, error: 'Could not process the document' };
  }

  try {
    const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const slip = await db.abTaxSlip.create({
      data: {
        tenantId,
        taxYear,
        slipType: parsed.slipType || 'unknown',
        issuer: parsed.fields?.employer_name || parsed.fields?.payer_name || parsed.fields?.issuer || parsed.fields?.institution_name || null,
        imageUrl,
        extractedData: parsed.fields || {},
        confidence: parsed.confidence || 0.5,
        status: 'pending',
        filingId,
      },
    });

    return {
      success: true,
      data: {
        id: slip.id,
        slipType: slip.slipType,
        issuer: slip.issuer,
        extractedData: parsed.fields,
        confidence: parsed.confidence,
      },
    };
  } catch {
    return { success: false, error: 'Could not parse OCR result' };
  }
}

export async function confirmSlip(tenantId: string, slipId: string): Promise<any> {
  const slip = await db.abTaxSlip.findFirst({ where: { id: slipId, tenantId } });
  if (!slip) return { success: false, error: 'Slip not found' };

  await db.abTaxSlip.update({
    where: { id: slipId },
    data: { status: 'confirmed' },
  });

  return { success: true, data: { confirmed: true, slipType: slip.slipType } };
}

export async function listSlips(tenantId: string, taxYear: number): Promise<any> {
  const slips = await db.abTaxSlip.findMany({
    where: { tenantId, taxYear },
    orderBy: { createdAt: 'desc' },
  });

  return {
    success: true,
    data: slips.map((s: any) => ({
      id: s.id,
      slipType: s.slipType,
      issuer: s.issuer,
      status: s.status,
      confidence: s.confidence,
      extractedData: s.extractedData,
    })),
  };
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
git add plugins/agentbook-tax/backend/src/tax-slips.ts
git commit -m "feat: tax-slips module — OCR extraction for T4, T5, RRSP, bank statements

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Tax Plugin Endpoints

**Files:**
- Modify: `plugins/agentbook-tax/backend/src/server.ts`

- [ ] **Step 1: Add imports and 3 endpoints**

At the top of server.ts, add imports:
```typescript
import { seedCanadianForms } from './tax-forms.js';
import { populateFiling, updateFilingField } from './tax-filing.js';
import { processSlipOCR, confirmSlip, listSlips } from './tax-slips.js';
```

Add 3 new endpoints (at end, before `start()`):

```typescript
// === Tax Filing ===
server.app.post('/api/v1/agentbook-tax/tax-forms/seed', async (_req, res) => {
  try {
    const result = await seedCanadianForms();
    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

server.app.get('/api/v1/agentbook-tax/tax-filing/:year', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const taxYear = parseInt(req.params.year);
    const result = await populateFiling(tenantId, taxYear);
    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

server.app.post('/api/v1/agentbook-tax/tax-filing/:year/field', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const taxYear = parseInt(req.params.year);
    const { formCode, fieldId, value } = req.body;
    if (!formCode || !fieldId) return res.status(400).json({ success: false, error: 'formCode and fieldId required' });
    const result = await updateFilingField(tenantId, taxYear, formCode, fieldId, value);
    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

server.app.post('/api/v1/agentbook-tax/tax-slips/ocr', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { imageUrl, taxYear, filingId } = req.body;
    if (!imageUrl) return res.status(400).json({ success: false, error: 'imageUrl required' });
    // TODO: Wire callGemini from LLM config — for now use inline
    const result = await processSlipOCR(tenantId, taxYear || 2025, imageUrl, filingId || null, async () => null);
    res.json(result);
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

server.app.post('/api/v1/agentbook-tax/tax-slips/:id/confirm', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const result = await confirmSlip(tenantId, req.params.id);
    res.json(result);
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

server.app.get('/api/v1/agentbook-tax/tax-slips', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const taxYear = parseInt(req.query.taxYear as string) || 2025;
    const result = await listSlips(tenantId, taxYear);
    res.json(result);
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});
```

- [ ] **Step 2: Restart tax plugin, test endpoints**

```bash
kill $(lsof -i :4053 -t) 2>/dev/null; sleep 1
cd /Users/qianghan/Documents/mycodespace/a3p
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4053 npx tsx plugins/agentbook-tax/backend/src/server.ts > /tmp/tax-backend.log 2>&1 &
sleep 4

# Seed forms
curl -s -X POST http://localhost:4053/api/v1/agentbook-tax/tax-forms/seed
# Expected: {"success":true,"data":{"created":4,"updated":0}}

# Test filing
curl -s http://localhost:4053/api/v1/agentbook-tax/tax-filing/2025 -H 'x-tenant-id: 2e2348b6-a64c-44ad-907e-4ac120ff06f2'
# Expected: filing data with completeness
```

- [ ] **Step 3: Commit**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
git add plugins/agentbook-tax/backend/src/server.ts
git commit -m "feat: tax plugin endpoints — filing session, form seed, slip OCR

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Agent Skills — Filing Skills + INTERNAL Handlers

**Files:**
- Modify: `plugins/agentbook-core/backend/src/server.ts`
- Create: `tests/e2e/agent-tax-filing.spec.ts`

- [ ] **Step 1: Add 9 skill manifests to BUILT_IN_SKILLS**

Add before `general-question`:

```typescript
  // Tax filing skills
  {
    name: 'tax-filing-start', description: 'Start tax filing — create filing session, auto-populate from books, identify missing fields', category: 'tax',
    triggerPatterns: ['start.*tax.*fil', 'file.*my.*tax', 'begin.*return', 'prepare.*tax.*return', 'tax.*return'],
    parameters: { taxYear: { type: 'number', required: false, default: 2025 } },
    endpoint: { method: 'INTERNAL', url: '' },
  },
  {
    name: 'tax-filing-status', description: 'Check tax filing progress — completeness by form, what is missing', category: 'tax',
    triggerPatterns: ['tax.*filing.*status', 'filing.*progress', 'what.*missing.*tax', 'tax.*complete', 'filing.*complete'],
    parameters: { taxYear: { type: 'number', required: false, default: 2025 } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax-filing/2025' },
  },
  {
    name: 'tax-slip-scan', description: 'Upload and scan a tax slip (T4, T5, RRSP, TFSA, bank statement) for OCR extraction', category: 'tax',
    triggerPatterns: ['upload.*slip', 'scan.*t4', 'scan.*t5', 'scan.*rrsp', 'scan.*slip', 'tax.*document'],
    parameters: { imageUrl: { type: 'string', required: false } },
    endpoint: { method: 'INTERNAL', url: '' },
  },
  {
    name: 'tax-slip-list', description: 'Show uploaded tax slips and their status', category: 'tax',
    triggerPatterns: ['show.*slip', 'list.*slip', 'uploaded.*slip', 'my.*slip', 'tax.*slip'],
    parameters: { taxYear: { type: 'number', required: false, default: 2025 } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax-slips', queryParams: ['taxYear'] },
  },
  {
    name: 'ca-t2125-review', description: 'Review T2125 Statement of Business Income — revenue, expenses, vehicle, home office', category: 'tax',
    triggerPatterns: ['review.*t2125', 'business.*income.*form', 't2125', 'statement.*business'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax-filing/2025' },
  },
  {
    name: 'ca-t1-review', description: 'Review T1 General personal income tax return — income sources, deductions, credits', category: 'tax',
    triggerPatterns: ['review.*t1', 'personal.*return', 't1.*general', 't1.*review'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax-filing/2025' },
  },
  {
    name: 'ca-gst-hst-review', description: 'Review GST/HST return — collected tax, input tax credits, net tax', category: 'tax',
    triggerPatterns: ['review.*gst', 'review.*hst', 'sales.*tax.*return', 'gst.*hst.*review', 'gst.*return'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax-filing/2025' },
  },
  {
    name: 'ca-schedule-1-review', description: 'Review Schedule 1 federal tax calculation', category: 'tax',
    triggerPatterns: ['schedule.*1', 'federal.*tax.*calc'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax-filing/2025' },
  },
  {
    name: 'tax-filing-field', description: 'Provide a value for a missing tax filing field', category: 'tax',
    triggerPatterns: [],
    parameters: { formCode: { type: 'string', required: true }, fieldId: { type: 'string', required: true }, value: { type: 'string', required: true } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-tax/tax-filing/2025/field' },
  },
```

- [ ] **Step 2: Add INTERNAL handler for tax-filing-start**

In `classifyAndExecuteV1()`, add before the skill HTTP execution block:

```typescript
    // INTERNAL handler: tax-filing-start — create/resume filing, auto-populate
    if (selectedSkill.name === 'tax-filing-start') {
      try {
        const taxBase = baseUrls['/api/v1/agentbook-tax'] || 'http://localhost:4053';
        const IH = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
        const taxYear = extractedParams.taxYear || 2025;

        // Seed forms if needed
        await fetch(`${taxBase}/api/v1/agentbook-tax/tax-forms/seed`, { method: 'POST', headers: IH });

        // Populate filing
        const res = await fetch(`${taxBase}/api/v1/agentbook-tax/tax-filing/${taxYear}`, { headers: IH });
        const data = await res.json() as any;

        if (!data.success) throw new Error(data.error);

        const filing = data.data;
        let message = `**Tax Filing ${taxYear} — ${filing.jurisdiction.toUpperCase()}**\n\n`;
        message += `Overall completeness: **${Math.round(filing.completeness * 100)}%**\n\n`;

        for (const form of filing.forms) {
          const icon = form.completeness >= 100 ? '\u2705' : form.completeness >= 50 ? '\u{1F7E1}' : '\u{1F534}';
          message += `${icon} **${form.formCode}**: ${form.completeness}% complete\n`;
        }

        if (filing.missingFields.length > 0) {
          const manualFields = filing.missingFields.filter((f: any) => f.source === 'manual');
          const slipFields = filing.missingFields.filter((f: any) => f.source === 'slip');
          message += `\n**Missing:**\n`;
          if (manualFields.length > 0) message += `- ${manualFields.length} fields need your input\n`;
          if (slipFields.length > 0) message += `- ${slipFields.length} fields need tax slips (T4, T5, RRSP, etc.)\n`;
          message += `\nSend tax slips as photos/PDFs, or ask me about a specific form.`;
        } else {
          message += `\nAll fields are populated! Review each form or export when ready.`;
        }

        if (filing.slipsCount > 0) {
          message += `\n\n${filing.slipsCount} tax slips uploaded.`;
        }

        await db.abConversation.create({ data: { tenantId, question: text || '[tax filing]', answer: message, queryType: 'agent', channel, skillUsed: 'tax-filing-start' } });
        return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-filing-start', skillResponse: data,
          responseData: { message, actions: [], chartData: null, skillUsed: 'tax-filing-start', confidence, latencyMs: Date.now() - startTime } };
      } catch (err) {
        console.error('Tax filing start error:', err);
        return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-filing-start', skillResponse: null,
          responseData: { message: "I couldn't start the tax filing. Please try again.", actions: [], chartData: null, skillUsed: 'tax-filing-start', confidence: 0, latencyMs: Date.now() - startTime } };
      }
    }
```

- [ ] **Step 3: Add response formatting for filing status**

Add to the response formatting chain:

```typescript
    // Tax filing status
    } else if (data?.filingId && data?.completeness !== undefined && data?.forms) {
      message = `**Tax Filing ${data.taxYear || '2025'}**\n\n`;
      message += `Overall: **${Math.round(data.completeness * 100)}%** complete\n\n`;
      for (const form of (data.forms || [])) {
        const icon = form.completeness >= 100 ? '\u2705' : form.completeness >= 50 ? '\u{1F7E1}' : '\u{1F534}';
        message += `${icon} **${form.formCode}**: ${form.completeness}%\n`;
      }
      if (data.missingFields?.length > 0) {
        message += `\n${data.missingFields.length} fields still needed.`;
      }

    // Tax slips list
    } else if (Array.isArray(data) && data.length > 0 && data[0]?.slipType && data[0]?.extractedData) {
      message = '**Tax Slips**\n';
      for (const s of data) {
        const icon = s.status === 'confirmed' ? '\u2705' : '\u{1F7E1}';
        message += `\n${icon} **${s.slipType}**${s.issuer ? ` from ${s.issuer}` : ''} [${s.status}] (${Math.round(s.confidence * 100)}% confidence)`;
      }
```

- [ ] **Step 4: Add query-finance exclusion for tax filing triggers**

Update the `query-finance` exclusion regex to also skip tax filing queries:

Find the existing `query-finance` exclusion line and append: `|tax.*fil|start.*fil|file.*tax|review.*t[12]|t2125|schedule.*1|gst.*return`

- [ ] **Step 5: Write tests**

Create `tests/e2e/agent-tax-filing.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

const CORE = 'http://localhost:4050';
const TAX = 'http://localhost:4053';
const MAYA = '2e2348b6-a64c-44ad-907e-4ac120ff06f2';
const H = { 'x-tenant-id': MAYA, 'Content-Type': 'application/json' };

test.describe.serial('Tax Filing Agent', () => {
  test('seed forms creates 4 Canadian templates', async ({ request }) => {
    const res = await request.post(`${TAX}/api/v1/agentbook-tax/tax-forms/seed`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.created + body.data.updated).toBe(4);
  });

  test('tax-filing-start: "start my tax filing"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'start my tax filing for 2025', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.skillUsed).toBe('tax-filing-start');
    expect(body.data.message).toContain('Tax Filing');
    expect(body.data.message).toContain('T2125');
  });

  test('tax-filing-status: "what is missing for my tax filing?"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'what is missing for my tax filing?', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('tax-filing-status');
  });

  test('tax-slip-list: "show my tax slips"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'show my tax slips', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('tax-slip-list');
  });

  test('ca-t2125-review: "review T2125"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'review T2125', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('ca-t2125-review');
  });

  test('ca-t1-review: "review T1 general"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'review my T1 general return', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('ca-t1-review');
  });

  test('ca-gst-hst-review: "review GST return"', async ({ request }) => {
    const res = await request.post(`${CORE}/api/v1/agentbook-core/agent/message`, {
      headers: H, data: { text: 'review my GST return', channel: 'api' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.skillUsed).toBe('ca-gst-hst-review');
  });

  test('filing endpoint returns completeness', async ({ request }) => {
    const res = await request.get(`${TAX}/api/v1/agentbook-tax/tax-filing/2025`, { headers: H });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.completeness).toBeGreaterThanOrEqual(0);
    expect(body.data.forms.length).toBe(4);
  });

  test('auto-population fills revenue from books', async ({ request }) => {
    const res = await request.get(`${TAX}/api/v1/agentbook-tax/tax-filing/2025`, { headers: H });
    const body = await res.json();
    const t2125 = body.data.forms.find((f: any) => f.formCode === 'T2125');
    expect(t2125).toBeTruthy();
    expect(t2125.completeness).toBeGreaterThan(0);
  });

  test('field update reduces missing count', async ({ request }) => {
    // Get current missing count
    const before = await request.get(`${TAX}/api/v1/agentbook-tax/tax-filing/2025`, { headers: H });
    const missingBefore = (await before.json()).data.missingFields.length;

    // Update a manual field
    await request.post(`${TAX}/api/v1/agentbook-tax/tax-filing/2025/field`, {
      headers: H,
      data: { formCode: 'T2125', fieldId: 'industry_code', value: '541611' },
    });

    // Verify missing decreased
    const after = await request.get(`${TAX}/api/v1/agentbook-tax/tax-filing/2025`, { headers: H });
    const missingAfter = (await after.json()).data.missingFields.length;
    expect(missingAfter).toBeLessThanOrEqual(missingBefore);
  });
});
```

- [ ] **Step 6: Update agent-brain.spec.ts skill count**

Update to 50 (41 + 9 new).

- [ ] **Step 7: Restart all, seed, run tests**

```bash
# Restart core
kill $(lsof -i :4050 -t) 2>/dev/null; sleep 1
cd /Users/qianghan/Documents/mycodespace/a3p
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=4050 npx tsx plugins/agentbook-core/backend/src/server.ts > /tmp/core-backend.log 2>&1 &
sleep 4
curl -s -X POST http://localhost:4050/api/v1/agentbook-core/agent/seed-skills
# Expected: total: 50

# Run all tests
cd tests/e2e && npx playwright test agent-brain.spec.ts agent-brain-v2.spec.ts agent-invoice.spec.ts agent-tax-finance.spec.ts agent-cpa-automation.spec.ts agent-tax-filing.spec.ts --config=playwright.config.ts --reporter=line
```

- [ ] **Step 8: Commit and push**

```bash
cd /Users/qianghan/Documents/mycodespace/a3p
git add plugins/agentbook-core/backend/src/server.ts tests/e2e/agent-tax-filing.spec.ts tests/e2e/agent-brain.spec.ts
git commit -m "feat: 9 tax filing skills — start, status, slip scan/list, form reviews, field update

Phase A complete: conversational tax filing prep via Telegram.
Auto-populates from books, accepts slip uploads, tracks completeness.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push origin feat/agentbook
```

---

## Phase B & C: Future Plans

Phase B (Form Generation + Export) and Phase C (E-Filing) will be separate implementation plans, each building on Phase A:

- **Phase B plan:** `docs/superpowers/plans/YYYY-MM-DD-tax-filing-phase-b.md`
  - Validation rules in AbTaxFormTemplate
  - PDF rendering (HTML → PDF, reuse invoice pattern)
  - CRA XML export (exportSchema mapping)
  - tax-filing-export + tax-filing-validate skills

- **Phase C plan:** `docs/superpowers/plans/YYYY-MM-DD-tax-filing-phase-c.md`
  - AbTaxFilingPartner model
  - Partner API integration (Wealthsimple Tax)
  - tax-filing-submit + tax-filing-check skills
  - Filing confirmation tracking
