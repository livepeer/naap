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
