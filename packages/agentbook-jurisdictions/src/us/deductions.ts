import type { DeductionRuleSet, DeductionRule } from '../interfaces.js';

const US_DEDUCTIONS: DeductionRule[] = [
  { id: 'home_office_simplified', name: 'Home Office (Simplified)', description: '$5/sq ft, max 300 sq ft = $1,500', category: 'home_office' },
  { id: 'home_office_regular', name: 'Home Office (Regular)', description: 'Actual expenses prorated by area', category: 'home_office' },
  { id: 'section_179', name: 'Section 179 Expensing', description: 'Deduct full cost of equipment in year purchased', category: 'depreciation' },
  { id: 'se_health_insurance', name: 'Self-Employed Health Insurance', description: '100% deductible above the line', category: 'insurance' },
  { id: 'sep_ira', name: 'SEP-IRA Contribution', description: 'Up to 25% of net SE income, max $69,000 (2025)', category: 'retirement' },
  { id: 'solo_401k', name: 'Solo 401(k)', description: 'Employee + employer contributions', category: 'retirement' },
  { id: 'half_se_tax', name: 'Half of Self-Employment Tax', description: 'Deductible above the line', category: 'tax' },
  { id: 'qbi_deduction', name: 'QBI Deduction', description: '20% of qualified business income', category: 'income' },
];

export const usDeductions: DeductionRuleSet = {
  getAvailableDeductions(businessType: string) { return US_DEDUCTIONS; },
  calculateDeduction(ruleId: string, inputs: Record<string, number>): number {
    switch (ruleId) {
      case 'home_office_simplified':
        return Math.min((inputs.sqft || 0) * 500, 150000); // $5/sqft max 300sqft in cents
      case 'se_health_insurance':
        return inputs.premiums_cents || 0;
      case 'half_se_tax':
        return Math.round((inputs.se_tax_cents || 0) / 2);
      default:
        return 0;
    }
  },
};
