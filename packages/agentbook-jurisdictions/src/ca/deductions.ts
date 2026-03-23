import type { DeductionRuleSet, DeductionRule } from '../interfaces.js';

const CA_DEDUCTIONS: DeductionRule[] = [
  { id: 'business_use_of_home', name: 'Business-Use-of-Home Expenses', description: 'T2125 Part 7 — prorate home expenses by business-use area percentage', category: 'home_office' },
  { id: 'cca_class_8', name: 'CCA Class 8 (20%)', description: 'Office furniture, equipment, and other property not in another class', category: 'depreciation' },
  { id: 'cca_class_10', name: 'CCA Class 10 (30%)', description: 'Motor vehicles, general-purpose electronic data processing equipment', category: 'depreciation' },
  { id: 'cca_class_10_1', name: 'CCA Class 10.1 (30%)', description: 'Passenger vehicles costing more than prescribed amount ($37,000 for 2025)', category: 'depreciation' },
  { id: 'cca_class_12', name: 'CCA Class 12 (100%)', description: 'Tools, medical instruments, computer software (under $500)', category: 'depreciation' },
  { id: 'cca_class_50', name: 'CCA Class 50 (55%)', description: 'Computer hardware and systems software', category: 'depreciation' },
  { id: 'cpp_deduction', name: 'CPP on Self-Employment', description: 'Employer portion of CPP contributions is deductible', category: 'tax' },
  { id: 'rrsp', name: 'RRSP Contribution', description: '18% of prior year earned income, up to annual maximum ($32,490 for 2025)', category: 'retirement' },
  { id: 'meals_50_percent', name: 'Meals & Entertainment (50%)', description: 'Only 50% of meal and entertainment expenses are deductible', category: 'meals' },
  { id: 'home_internet', name: 'Home Internet (Business Portion)', description: 'Prorate internet costs by business-use percentage', category: 'home_office' },
];

export const caDeductions: DeductionRuleSet = {
  getAvailableDeductions(businessType: string) { return CA_DEDUCTIONS; },
  calculateDeduction(ruleId: string, inputs: Record<string, number>): number {
    switch (ruleId) {
      case 'business_use_of_home': {
        // Total home expenses * (business sq ft / total sq ft)
        const totalExpenses = inputs.total_home_expenses_cents || 0;
        const businessSqFt = inputs.business_sqft || 0;
        const totalSqFt = inputs.total_sqft || 1;
        return Math.round(totalExpenses * (businessSqFt / totalSqFt));
      }
      case 'cpp_deduction':
        // Employer half of CPP contributions
        return Math.round((inputs.cpp_contribution_cents || 0) / 2);
      case 'meals_50_percent':
        return Math.round((inputs.meals_cents || 0) * 0.50);
      case 'rrsp': {
        // 18% of prior year earned income, capped at annual max ($32,490 = 3249000 cents for 2025)
        const maxCents = 3249000;
        const contribution = Math.round((inputs.prior_year_earned_income_cents || 0) * 0.18);
        return Math.min(contribution, maxCents);
      }
      default:
        return 0;
    }
  },
};
