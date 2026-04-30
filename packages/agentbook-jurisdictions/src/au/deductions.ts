import type { DeductionRuleSet, DeductionRule } from '../interfaces.js';

const AU_DEDUCTIONS: DeductionRule[] = [
  { id: 'home_office_fixed_rate', name: 'Home Office (Fixed Rate)', description: 'Revised fixed rate of 67c/hour for home office expenses (from 2022-23)', category: 'home_office' },
  { id: 'home_office_actual', name: 'Home Office (Actual Cost)', description: 'Claim actual running expenses for a dedicated home office', category: 'home_office' },
  { id: 'motor_vehicle_cents', name: 'Motor Vehicle (Cents per km)', description: 'ATO rate of 88c/km for 2024-25, max 5,000 km', category: 'vehicle' },
  { id: 'motor_vehicle_logbook', name: 'Motor Vehicle (Logbook)', description: 'Claim business percentage of actual car expenses based on logbook', category: 'vehicle' },
  { id: 'instant_asset_writeoff', name: 'Instant Asset Write-Off', description: 'Immediately deduct the cost of eligible assets under the threshold ($20,000 for 2024-25)', category: 'depreciation' },
  { id: 'depreciation_pool', name: 'Small Business Pool', description: 'Simplified depreciation — pool assets at 15% first year, 30% thereafter', category: 'depreciation' },
  { id: 'super_contribution', name: 'Superannuation Contribution', description: 'Personal super contributions — deductible up to the concessional cap ($30,000)', category: 'retirement' },
  { id: 'loss_carry_forward', name: 'Tax Loss Carry Forward', description: 'Carry forward business losses to offset future income', category: 'loss' },
  { id: 'self_education', name: 'Self-Education Expenses', description: 'Courses and study directly related to current employment/business', category: 'education' },
  { id: 'working_from_home', name: 'Working From Home', description: 'Deductions for phone, internet, depreciation of equipment when working from home', category: 'home_office' },
];

export const auDeductions: DeductionRuleSet = {
  getAvailableDeductions(businessType: string) { return AU_DEDUCTIONS; },
  calculateDeduction(ruleId: string, inputs: Record<string, number>): number {
    switch (ruleId) {
      case 'home_office_fixed_rate': {
        // 67c per hour worked at home
        const hoursPerYear = inputs.hours_per_year || 0;
        return Math.round(hoursPerYear * 67);
      }
      case 'motor_vehicle_cents': {
        // 88c/km, max 5,000 km
        const km = Math.min(inputs.total_km || 0, 5000);
        return Math.round(km * 88);
      }
      case 'motor_vehicle_logbook': {
        // Actual costs * business percentage from logbook
        const actualCostsCents = inputs.actual_costs_cents || 0;
        const businessPercent = inputs.business_percent || 0;
        return Math.round(actualCostsCents * (businessPercent / 100));
      }
      case 'instant_asset_writeoff': {
        // Full deduction for assets under $20,000 (2000000 cents)
        const assetCostCents = inputs.asset_cost_cents || 0;
        return assetCostCents <= 2000000 ? assetCostCents : 0;
      }
      case 'depreciation_pool': {
        // 15% first year, 30% thereafter
        const poolValueCents = inputs.pool_value_cents || 0;
        const isFirstYear = inputs.first_year || 0;
        const rate = isFirstYear ? 0.15 : 0.30;
        return Math.round(poolValueCents * rate);
      }
      case 'super_contribution': {
        // Personal super contributions, capped at $30,000 concessional cap (3000000 cents)
        const contributions = inputs.super_contributions_cents || 0;
        return Math.min(contributions, 3000000);
      }
      default:
        return 0;
    }
  },
};
