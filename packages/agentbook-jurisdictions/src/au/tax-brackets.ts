import type { TaxBracketProvider, TaxBracket, TaxCalculation } from '../interfaces.js';

// ATO 2024-25 Income Tax Rates (amounts in cents)
const AU_BRACKETS_2025: TaxBracket[] = [
  { min: 0, max: 1820000, rate: 0 },              // $0-$18,200: Nil
  { min: 1820000, max: 4500000, rate: 0.16 },      // $18,201-$45,000: 16c per $1
  { min: 4500000, max: 13500000, rate: 0.30 },     // $45,001-$135,000: 30c per $1
  { min: 13500000, max: 19000000, rate: 0.37 },    // $135,001-$190,000: 37c per $1
  { min: 19000000, max: null, rate: 0.45 },         // $190,001+: 45c per $1
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
    marginalRate: AU_BRACKETS_2025.find(b => incomeCents <= (b.max ?? Infinity) && incomeCents > b.min)?.rate ?? 0,
    bracketBreakdown: breakdown,
  };
}

export const auTaxBrackets: TaxBracketProvider = {
  jurisdiction: 'au',
  getTaxBrackets(taxYear: number) { return AU_BRACKETS_2025; },
  calculateTax(taxableIncomeCents: number, taxYear: number) {
    return calculateFromBrackets(taxableIncomeCents, AU_BRACKETS_2025);
  },
};
