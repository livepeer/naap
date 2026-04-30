import type { SelfEmploymentTaxCalculator, SelfEmploymentTaxResult } from '../interfaces.js';

// Australia: Medicare Levy (2% of taxable income)
// Medicare Levy Surcharge applies for higher earners without private health insurance (not modelled here)
export const auSelfEmploymentTax: SelfEmploymentTaxCalculator = {
  calculate(netSEIncomeCents: number, taxYear: number): SelfEmploymentTaxResult {
    // Medicare Levy: 2% of taxable income
    // Reduced for low-income earners (below $26,000) — simplified here
    const lowIncomeThreshold = 2600000; // $26,000
    const shadingOutThreshold = 3250000; // $32,500

    let medicareLevy = 0;
    if (netSEIncomeCents > shadingOutThreshold) {
      // Full 2%
      medicareLevy = Math.round(netSEIncomeCents * 0.02);
    } else if (netSEIncomeCents > lowIncomeThreshold) {
      // Shading-in rate: 10% of excess over threshold
      medicareLevy = Math.round((netSEIncomeCents - lowIncomeThreshold) * 0.10);
    }
    // Below low income threshold: $0

    return {
      amountCents: medicareLevy,
      deductiblePortionCents: 0, // Medicare levy is not deductible
      breakdown: { medicare_levy: medicareLevy },
    };
  },
};
