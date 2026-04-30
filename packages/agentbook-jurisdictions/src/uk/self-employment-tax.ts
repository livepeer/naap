import type { SelfEmploymentTaxCalculator, SelfEmploymentTaxResult } from '../interfaces.js';

// UK National Insurance Class 2 and Class 4
export const ukSelfEmploymentTax: SelfEmploymentTaxCalculator = {
  calculate(netSEIncomeCents: number, taxYear: number): SelfEmploymentTaxResult {
    // Class 2: £3.45/week (flat) if profit > £12,570
    const class2Weekly = 345; // pence
    const class2Annual = netSEIncomeCents > 1257000 ? class2Weekly * 52 : 0;

    // Class 4: 6% on profits between £12,570-£50,270, 2% above £50,270
    const lowerLimit = 1257000;
    const upperLimit = 5027000;
    let class4 = 0;
    if (netSEIncomeCents > lowerLimit) {
      const band1 = Math.min(netSEIncomeCents, upperLimit) - lowerLimit;
      class4 += Math.round(band1 * 0.06);
      if (netSEIncomeCents > upperLimit) {
        class4 += Math.round((netSEIncomeCents - upperLimit) * 0.02);
      }
    }

    return {
      amountCents: class2Annual + class4,
      deductiblePortionCents: 0, // NI is not deductible in UK
      breakdown: { class_2: class2Annual, class_4: class4 },
    };
  },
};
