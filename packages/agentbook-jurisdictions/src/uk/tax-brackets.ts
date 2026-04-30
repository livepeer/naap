import type { TaxBracketProvider, TaxBracket, TaxCalculation } from '../interfaces.js';

// UK 2025/26 Income Tax Bands (amounts in cents/pence x 100)
const UK_BRACKETS_2025: TaxBracket[] = [
  { min: 0, max: 1257000, rate: 0 },          // Personal allowance: £12,570
  { min: 1257000, max: 5027000, rate: 0.20 },  // Basic rate: £12,571-£50,270
  { min: 5027000, max: 15014000, rate: 0.40 }, // Higher rate: £50,271-£150,140 (actually £125,140)
  { min: 15014000, max: null, rate: 0.45 },     // Additional rate: £150,140+
];

function calculateFromBrackets(incomeCents: number, brackets: TaxBracket[]): TaxCalculation {
  let totalTax = 0;
  const breakdown: TaxCalculation['bracketBreakdown'] = [];
  for (const bracket of brackets) {
    if (incomeCents <= bracket.min) break;
    const taxable = Math.min(incomeCents, bracket.max ?? Infinity) - bracket.min;
    const tax = Math.round(taxable * bracket.rate);
    totalTax += tax;
    breakdown.push({ bracket, taxCents: tax });
  }
  return {
    taxCents: totalTax,
    effectiveRate: incomeCents > 0 ? totalTax / incomeCents : 0,
    marginalRate: UK_BRACKETS_2025.find(b => incomeCents <= (b.max ?? Infinity) && incomeCents > b.min)?.rate ?? 0,
    bracketBreakdown: breakdown,
  };
}

export const ukTaxBrackets: TaxBracketProvider = {
  jurisdiction: 'uk',
  getTaxBrackets(taxYear: number) { return UK_BRACKETS_2025; },
  calculateTax(taxableIncomeCents: number, taxYear: number) {
    return calculateFromBrackets(taxableIncomeCents, UK_BRACKETS_2025);
  },
};
