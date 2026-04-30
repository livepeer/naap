import type { SelfEmploymentTaxCalculator, SelfEmploymentTaxResult } from '../interfaces.js';

export const caSelfEmploymentTax: SelfEmploymentTaxCalculator = {
  calculate(netSEIncomeCents: number, taxYear: number): SelfEmploymentTaxResult {
    // CPP (Canada Pension Plan) for self-employed — both employee and employer portions
    // 2025: rate is 5.95% each (11.9% total) on pensionable earnings
    // Basic exemption: $3,500, Maximum pensionable earnings: $71,300
    const basicExemptionCents = 350000;  // $3,500
    const maxPensionableEarningsCents = 7130000; // $71,300
    const cppRate = 0.119; // Combined employee + employer rate

    const pensionableEarnings = Math.min(netSEIncomeCents, maxPensionableEarningsCents);
    const cppBase = Math.max(pensionableEarnings - basicExemptionCents, 0);
    const cppContribution = Math.round(cppBase * cppRate);

    // CPP2 (second ceiling) for 2025: additional 4% on earnings between $71,300-$81,200
    const cpp2Ceiling = 8120000; // $81,200 in cents
    const cpp2Rate = 0.08; // 4% x 2 for self-employed
    const cpp2Base = Math.max(
      Math.min(netSEIncomeCents, cpp2Ceiling) - maxPensionableEarningsCents,
      0,
    );
    const cpp2Contribution = Math.round(cpp2Base * cpp2Rate);

    const totalContribution = cppContribution + cpp2Contribution;

    // EI is optional for self-employed — not included in base calculation

    return {
      amountCents: totalContribution,
      deductiblePortionCents: Math.round(totalContribution / 2), // Employer portion is deductible
      breakdown: {
        cpp: cppContribution,
        cpp2: cpp2Contribution,
        ei: 0, // Optional for self-employed
      },
    };
  },
};
