/**
 * Deduction Hunting — Proactively find missing tax deductions.
 * Per requirements-v2 US-5.2: "Agent reviews expenses against all deduction categories and flags gaps"
 */

export interface DeductionOpportunity {
  ruleId: string;
  category: string;
  description: string;
  estimatedSavingsCents: number;
  jurisdiction: string;
  suggestion: string;
}

// Common deduction categories to check
const DEDUCTION_CHECKS = [
  {
    id: 'home_office',
    category: 'home_office',
    question: 'Do you work from home?',
    usSuggestion: 'You could deduct up to $1,500 with the simplified method ($5/sq ft, max 300 sq ft)',
    caSuggestion: 'You can claim business-use-of-home expenses (proportion of rent/mortgage, utilities, internet)',
    usEstimatedSavingsCents: 150000,
    caEstimatedSavingsCents: 210000,
    expenseCodePrefix: '5900', // Rent/Lease
  },
  {
    id: 'health_insurance',
    category: 'insurance',
    question: 'Do you pay for health insurance?',
    usSuggestion: 'Self-employed health insurance premiums are 100% deductible above the line',
    caSuggestion: 'Health and dental premiums may be deductible as a business expense',
    usEstimatedSavingsCents: 200000,
    caEstimatedSavingsCents: 150000,
    expenseCodePrefix: '5400', // Insurance
  },
  {
    id: 'retirement',
    category: 'retirement',
    question: 'Are you contributing to a retirement account?',
    usSuggestion: 'You can contribute up to $69,000 to a SEP-IRA and deduct it',
    caSuggestion: 'RRSP contributions reduce taxable income (deadline: March 1)',
    usEstimatedSavingsCents: 500000,
    caEstimatedSavingsCents: 400000,
    expenseCodePrefix: null, // No expense category — it's a deduction
  },
  {
    id: 'vehicle',
    category: 'vehicle',
    question: 'Do you use a vehicle for business?',
    usSuggestion: 'Standard mileage deduction: $0.70/mile for 2025',
    caSuggestion: 'CRA mileage rate: $0.72/km for first 5,000 km',
    usEstimatedSavingsCents: 300000,
    caEstimatedSavingsCents: 250000,
    expenseCodePrefix: '5100', // Car & Truck
  },
  {
    id: 'equipment',
    category: 'depreciation',
    question: 'Did you buy any equipment over $2,500?',
    usSuggestion: 'You can expense the full amount under Section 179 this year',
    caSuggestion: 'Capital Cost Allowance (CCA) lets you depreciate equipment over time',
    usEstimatedSavingsCents: 200000,
    caEstimatedSavingsCents: 150000,
    expenseCodePrefix: '6800', // Depreciation
  },
];

/**
 * Find deduction opportunities by checking what categories have NO expenses.
 */
export async function findMissingDeductions(
  tenantId: string,
  jurisdiction: string,
  db: any,
): Promise<DeductionOpportunity[]> {
  const currentYear = new Date().getFullYear();
  const yearStart = new Date(currentYear, 0, 1);

  // Get all expense categories used this year
  const expenses = await db.abExpense.findMany({
    where: { tenantId, date: { gte: yearStart }, isPersonal: false },
    select: { categoryId: true },
  });
  const usedCategoryIds = new Set(expenses.map((e: any) => e.categoryId).filter(Boolean));

  // Get accounts to check code prefixes
  const accounts = await db.abAccount.findMany({
    where: { tenantId, isActive: true },
  });

  const opportunities: DeductionOpportunity[] = [];

  for (const check of DEDUCTION_CHECKS) {
    // If this deduction category has an expense code, check if any expenses exist
    if (check.expenseCodePrefix) {
      const matchingAccount = accounts.find((a: any) => a.code.startsWith(check.expenseCodePrefix!));
      if (matchingAccount && !usedCategoryIds.has(matchingAccount.id)) {
        const isUS = jurisdiction === 'us';
        opportunities.push({
          ruleId: check.id,
          category: check.category,
          description: isUS ? check.usSuggestion : check.caSuggestion,
          estimatedSavingsCents: isUS ? check.usEstimatedSavingsCents : check.caEstimatedSavingsCents,
          jurisdiction,
          suggestion: check.question,
        });
      }
    } else {
      // No expense code — always suggest (retirement, etc.)
      const isUS = jurisdiction === 'us';
      // Check if already suggested this year
      const existingSuggestion = await db.abDeductionSuggestion.findFirst({
        where: { tenantId, jurisdiction, category: check.category, status: { not: 'dismissed' } },
      });
      if (!existingSuggestion) {
        opportunities.push({
          ruleId: check.id,
          category: check.category,
          description: isUS ? check.usSuggestion : check.caSuggestion,
          estimatedSavingsCents: isUS ? check.usEstimatedSavingsCents : check.caEstimatedSavingsCents,
          jurisdiction,
          suggestion: check.question,
        });
      }
    }
  }

  // Store suggestions in DB
  for (const opp of opportunities) {
    // Check if already exists (no compound unique constraint on this table)
    const existing = await db.abDeductionSuggestion.findFirst({
      where: { tenantId, jurisdiction, category: opp.category },
    });
    if (!existing) {
      await db.abDeductionSuggestion.create({
        data: {
          tenantId,
          jurisdiction,
          category: opp.category,
          description: opp.description,
          estimatedSavingsCents: opp.estimatedSavingsCents,
        },
      });
    }
  }

  return opportunities;
}
