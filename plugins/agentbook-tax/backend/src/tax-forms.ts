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
  // Validate: only allow digits, arithmetic operators, parentheses, spaces, decimal points
  if (!/^[\d\s+\-*/().]+$/.test(resolved)) return null;
  // Evaluate simple arithmetic
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
