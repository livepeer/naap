import type { DeductionRuleSet, DeductionRule } from '../interfaces.js';

const UK_DEDUCTIONS: DeductionRule[] = [
  { id: 'trading_allowance', name: 'Trading Allowance', description: 'Tax-free trading income up to £1,000 — no need to register as self-employed below this', category: 'allowance' },
  { id: 'capital_allowances_aia', name: 'Annual Investment Allowance (AIA)', description: 'Full deduction on qualifying plant and machinery up to £1,000,000', category: 'depreciation' },
  { id: 'capital_allowances_wda', name: 'Writing Down Allowance (WDA)', description: '18% main rate or 6% special rate pool on capital expenditure', category: 'depreciation' },
  { id: 'use_of_home', name: 'Use of Home as Office', description: 'Simplified expenses: £10/month (25-50 hrs), £18/month (51-100 hrs), £26/month (101+ hrs)', category: 'home_office' },
  { id: 'business_mileage', name: 'Business Mileage (AMAP)', description: '45p/mile first 10,000, 25p/mile thereafter', category: 'vehicle' },
  { id: 'pension_contributions', name: 'Pension Contributions', description: 'Personal pension contributions — tax relief at marginal rate, annual allowance £60,000', category: 'retirement' },
  { id: 'loss_relief', name: 'Trading Loss Relief', description: 'Carry forward losses against future profits, or carry back one year', category: 'loss' },
  { id: 'flat_rate_expenses', name: 'Flat Rate Expenses', description: 'Simplified expenses for vehicles, working from home, and living on business premises', category: 'simplified' },
];

export const ukDeductions: DeductionRuleSet = {
  getAvailableDeductions(businessType: string) { return UK_DEDUCTIONS; },
  calculateDeduction(ruleId: string, inputs: Record<string, number>): number {
    switch (ruleId) {
      case 'trading_allowance': {
        // £1,000 trading allowance (100000 pence)
        const income = inputs.trading_income_cents || 0;
        return Math.min(income, 100000);
      }
      case 'capital_allowances_aia': {
        // Full deduction up to £1,000,000 (100000000 pence)
        const expenditure = inputs.qualifying_expenditure_cents || 0;
        return Math.min(expenditure, 100000000);
      }
      case 'capital_allowances_wda': {
        // 18% main rate pool
        const poolValue = inputs.pool_value_cents || 0;
        const rate = inputs.special_rate ? 0.06 : 0.18;
        return Math.round(poolValue * rate);
      }
      case 'use_of_home': {
        // Simplified expenses based on hours worked at home per month
        const hoursPerMonth = inputs.hours_per_month || 0;
        let monthlyRate = 0;
        if (hoursPerMonth >= 101) monthlyRate = 2600;      // £26
        else if (hoursPerMonth >= 51) monthlyRate = 1800;   // £18
        else if (hoursPerMonth >= 25) monthlyRate = 1000;   // £10
        return monthlyRate * 12;
      }
      case 'pension_contributions': {
        // Tax relief on pension contributions, capped at £60,000 annual allowance (6000000 pence)
        const contributions = inputs.pension_contributions_cents || 0;
        return Math.min(contributions, 6000000);
      }
      default:
        return 0;
    }
  },
};
