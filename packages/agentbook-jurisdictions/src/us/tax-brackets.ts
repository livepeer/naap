import type { TaxBracketProvider, TaxBracket, TaxCalculation } from '../interfaces.js';

const FEDERAL_BRACKETS_2025: TaxBracket[] = [
  { min: 0, max: 1160000, rate: 0.10 },
  { min: 1160000, max: 4712500, rate: 0.12 },
  { min: 4712500, max: 10052500, rate: 0.22 },
  { min: 10052500, max: 19190000, rate: 0.24 },
  { min: 19190000, max: 24337500, rate: 0.32 },
  { min: 24337500, max: 60962500, rate: 0.35 },
  { min: 60962500, max: null, rate: 0.37 },
];

function calculateFromBrackets(incomeCents: number, brackets: TaxBracket[]): TaxCalculation {
  let totalTax = 0;
  const breakdown: TaxCalculation['bracketBreakdown'] = [];

  for (const bracket of brackets) {
    if (incomeCents <= bracket.min) break;
    const taxableInBracket = Math.min(incomeCents, bracket.max ?? Infinity) - bracket.min;
    const tax = Math.round(taxableInBracket * bracket.rate);
    totalTax += tax;
    breakdown.push({ bracket, taxCents: tax });
  }

  return {
    taxCents: totalTax,
    effectiveRate: incomeCents > 0 ? totalTax / incomeCents : 0,
    marginalRate: brackets.find(b => incomeCents <= (b.max ?? Infinity) && incomeCents > b.min)?.rate ?? 0,
    bracketBreakdown: breakdown,
  };
}

export const usTaxBrackets: TaxBracketProvider = {
  jurisdiction: 'us',
  getTaxBrackets(taxYear: number) {
    return FEDERAL_BRACKETS_2025; // TODO: year-versioned lookup
  },
  calculateTax(taxableIncomeCents: number, taxYear: number) {
    return calculateFromBrackets(taxableIncomeCents, FEDERAL_BRACKETS_2025);
  },
};
