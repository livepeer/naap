import type { SelfEmploymentTaxCalculator, SelfEmploymentTaxResult } from '../interfaces.js';

export const usSelfEmploymentTax: SelfEmploymentTaxCalculator = {
  calculate(netSEIncomeCents: number, taxYear: number): SelfEmploymentTaxResult {
    // 92.35% of net SE income is subject to SE tax
    const taxableBase = Math.round(netSEIncomeCents * 0.9235);

    // Social Security: 12.4% on first $176,100 (2025)
    const ssWageCap = 17610000; // cents
    const ssBase = Math.min(taxableBase, ssWageCap);
    const ssTax = Math.round(ssBase * 0.124);

    // Medicare: 2.9% on all (no cap)
    const medicareTax = Math.round(taxableBase * 0.029);

    // Additional Medicare: 0.9% on income over $200,000
    const additionalMedicareThreshold = 20000000;
    const additionalMedicare = taxableBase > additionalMedicareThreshold
      ? Math.round((taxableBase - additionalMedicareThreshold) * 0.009)
      : 0;

    const totalSE = ssTax + medicareTax + additionalMedicare;

    return {
      amountCents: totalSE,
      deductiblePortionCents: Math.round(totalSE / 2), // Half of SE tax is deductible
      breakdown: {
        social_security: ssTax,
        medicare: medicareTax,
        additional_medicare: additionalMedicare,
      },
    };
  },
};
