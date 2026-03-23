import type { TaxBracketProvider, TaxBracket, TaxCalculation } from '../interfaces.js';

// Canadian federal brackets for 2025 (amounts in cents)
const FEDERAL_BRACKETS_2025: TaxBracket[] = [
  { min: 0, max: 5737500, rate: 0.15 },
  { min: 5737500, max: 11475000, rate: 0.205 },
  { min: 11475000, max: 15846800, rate: 0.26 },
  { min: 15846800, max: 22170800, rate: 0.29 },
  { min: 22170800, max: null, rate: 0.33 },
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

export const caTaxBrackets: TaxBracketProvider = {
  jurisdiction: 'ca',
  getTaxBrackets(taxYear: number) {
    return FEDERAL_BRACKETS_2025; // TODO: year-versioned lookup
  },
  calculateTax(taxableIncomeCents: number, taxYear: number) {
    return calculateFromBrackets(taxableIncomeCents, FEDERAL_BRACKETS_2025);
  },
};
