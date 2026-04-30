/**
 * Unit tests for tax calculation logic.
 *
 * Extracted from the agentbook-tax server.ts:
 * - calcProgressiveTax: progressive bracket calculation (all in cents)
 * - calcSelfEmploymentTax: US (15.3% on 92.35%) and CA (CPP 11.9%)
 * - US_FEDERAL_BRACKETS and CA_FEDERAL_BRACKETS
 * - P&L and Balance Sheet structural logic
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Extracted tax bracket definitions (server.ts lines 30-47)
// All amounts in CENTS
// ---------------------------------------------------------------------------

const US_FEDERAL_BRACKETS = [
  { upTo: 11_600_00, rate: 0.10 },
  { upTo: 47_150_00, rate: 0.12 },
  { upTo: 100_525_00, rate: 0.22 },
  { upTo: 191_950_00, rate: 0.24 },
  { upTo: 243_725_00, rate: 0.32 },
  { upTo: 609_350_00, rate: 0.35 },
  { upTo: Infinity, rate: 0.37 },
];

const CA_FEDERAL_BRACKETS = [
  { upTo: 57_375_00, rate: 0.15 },
  { upTo: 114_750_00, rate: 0.205 },
  { upTo: 158_468_00, rate: 0.26 },
  { upTo: 221_708_00, rate: 0.29 },
  { upTo: Infinity, rate: 0.33 },
];

// ---------------------------------------------------------------------------
// Extracted: calcProgressiveTax (server.ts lines 53-70)
// ---------------------------------------------------------------------------

function calcProgressiveTax(
  incomeCents: number,
  brackets: { upTo: number; rate: number }[],
): number {
  if (incomeCents <= 0) return 0;
  let remaining = incomeCents;
  let tax = 0;
  let prev = 0;
  for (const bracket of brackets) {
    const width = bracket.upTo === Infinity ? remaining : bracket.upTo - prev;
    const taxable = Math.min(remaining, width);
    tax += Math.round(taxable * bracket.rate);
    remaining -= taxable;
    prev = bracket.upTo;
    if (remaining <= 0) break;
  }
  return tax;
}

// ---------------------------------------------------------------------------
// Extracted: calcSelfEmploymentTax (server.ts lines 77-91)
// ---------------------------------------------------------------------------

function calcSelfEmploymentTax(
  netIncomeCents: number,
  jurisdiction: string,
): number {
  if (netIncomeCents <= 0) return 0;
  if (jurisdiction === 'us') {
    // 92.35% of net income is subject to 15.3% SE tax
    return Math.round(netIncomeCents * 0.9235 * 0.153);
  }
  if (jurisdiction === 'ca') {
    // CPP self-employed contribution: 11.9%
    return Math.round(netIncomeCents * 0.119);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Extracted: getBrackets (server.ts lines 96-99)
// ---------------------------------------------------------------------------

function getBrackets(jurisdiction: string) {
  if (jurisdiction === 'ca') return CA_FEDERAL_BRACKETS;
  return US_FEDERAL_BRACKETS;
}

// ---------------------------------------------------------------------------
// Helper: full tax estimate calculation (mirrors server.ts lines 228-236)
// ---------------------------------------------------------------------------

function calculateFullTaxEstimate(
  netIncomeCents: number,
  jurisdiction: string,
): {
  seTaxCents: number;
  seDeductionCents: number;
  taxableIncomeCents: number;
  incomeTaxCents: number;
  totalTaxCents: number;
} {
  const seTaxCents = calcSelfEmploymentTax(netIncomeCents, jurisdiction);
  const seDeductionCents = jurisdiction === 'us' ? Math.round(seTaxCents / 2) : 0;
  const taxableIncomeCents = Math.max(0, netIncomeCents - seDeductionCents);
  const brackets = getBrackets(jurisdiction);
  const incomeTaxCents = calcProgressiveTax(taxableIncomeCents, brackets);
  const totalTaxCents = seTaxCents + incomeTaxCents;
  return { seTaxCents, seDeductionCents, taxableIncomeCents, incomeTaxCents, totalTaxCents };
}

// ---------------------------------------------------------------------------
// P&L and Balance Sheet structural helpers
// ---------------------------------------------------------------------------

function calculateNetIncome(
  grossRevenueCents: number,
  totalExpensesCents: number,
): number {
  return grossRevenueCents - totalExpensesCents;
}

function isBalanceSheetBalanced(
  totalAssetsCents: number,
  totalLiabilitiesCents: number,
  totalEquityCents: number,
): boolean {
  return totalAssetsCents === totalLiabilitiesCents + totalEquityCents;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('US Federal Income Tax (Progressive Brackets)', () => {
  it('should calculate $0 tax on $0 income', () => {
    const tax = calcProgressiveTax(0, US_FEDERAL_BRACKETS);
    expect(tax).toBe(0);
  });

  it('should calculate $0 tax on negative income', () => {
    const tax = calcProgressiveTax(-500_00, US_FEDERAL_BRACKETS);
    expect(tax).toBe(0);
  });

  it('should calculate tax on $50,000 income (crosses 3 brackets)', () => {
    // $50,000 = 5,000,000 cents
    // Bracket 1: $11,600 (1,160,000c) at 10% = $1,160 (116,000c)
    // Bracket 2: $47,150 - $11,600 = $35,550 (3,555,000c) at 12% = $4,266 (426,600c)
    // Bracket 3: $50,000 - $47,150 = $2,850 (285,000c) at 22% = $627 (62,700c)
    // Total = $6,053 (605,300c)
    const incomeCents = 50_000_00;
    const tax = calcProgressiveTax(incomeCents, US_FEDERAL_BRACKETS);

    // Each bracket is Math.round'd individually in the implementation
    const bracket1 = Math.round(11_600_00 * 0.10);   // 116,000
    const bracket2 = Math.round(35_550_00 * 0.12);    // 426,600
    const bracket3 = Math.round(2_850_00 * 0.22);     // 62,700
    const expected = bracket1 + bracket2 + bracket3;   // 605,300

    expect(tax).toBe(expected);
    // Verify dollar amounts
    expect(bracket1).toBe(116_000);
    expect(bracket2).toBe(426_600);
    expect(bracket3).toBe(62_700);
    expect(tax).toBe(605_300); // $6,053.00
  });

  it('should calculate tax on $200,000 income (crosses 4 brackets)', () => {
    // $200,000 = 20,000,000 cents
    // Bracket 1: $11,600 at 10% = $1,160
    // Bracket 2: $35,550 at 12% = $4,266
    // Bracket 3: $53,375 ($100,525 - $47,150) at 22% = $11,742.50 -> round
    // Bracket 4: $99,475 ($200,000 - $100,525) at 24% = $23,874 -> round
    const incomeCents = 200_000_00;
    const tax = calcProgressiveTax(incomeCents, US_FEDERAL_BRACKETS);

    const bracket1 = Math.round(11_600_00 * 0.10);
    const bracket2 = Math.round(35_550_00 * 0.12);
    const bracket3 = Math.round(53_375_00 * 0.22);
    const bracket4 = Math.round(99_475_00 * 0.24);
    const expected = bracket1 + bracket2 + bracket3 + bracket4;

    expect(tax).toBe(expected);
    // Sanity check: should be roughly $40k-$42k
    expect(tax / 100).toBeGreaterThan(40_000);
    expect(tax / 100).toBeLessThan(45_000);
  });

  it('should handle income exactly at a bracket boundary', () => {
    // Exactly $11,600 should only be taxed at 10%
    const tax = calcProgressiveTax(11_600_00, US_FEDERAL_BRACKETS);
    expect(tax).toBe(Math.round(11_600_00 * 0.10)); // 116,000c = $1,160
  });

  it('should handle income of $1 (100 cents)', () => {
    const tax = calcProgressiveTax(100, US_FEDERAL_BRACKETS);
    expect(tax).toBe(Math.round(100 * 0.10)); // 10 cents
  });
});

describe('US Self-Employment Tax', () => {
  it('should calculate SE tax on $100,000 net income', () => {
    // SE base = $100,000 * 92.35% = $92,350
    // SE tax = $92,350 * 15.3% = $14,129.55
    // In cents: 10,000,000 * 0.9235 * 0.153 = 1,412,956 (rounded)
    const seTax = calcSelfEmploymentTax(100_000_00, 'us');
    const expected = Math.round(100_000_00 * 0.9235 * 0.153);
    expect(seTax).toBe(expected);
    // Verify approximately $14,129.55
    expect(seTax / 100).toBeCloseTo(14_129.55, 0);
  });

  it('should calculate SE deduction as 50% of SE tax for US', () => {
    const seTax = calcSelfEmploymentTax(100_000_00, 'us');
    const deduction = Math.round(seTax / 2);
    // Deductible half of SE tax
    expect(deduction / 100).toBeCloseTo(7_064.78, 0);
  });

  it('should return 0 SE tax on $0 income', () => {
    expect(calcSelfEmploymentTax(0, 'us')).toBe(0);
  });

  it('should return 0 SE tax on negative income', () => {
    expect(calcSelfEmploymentTax(-50_000_00, 'us')).toBe(0);
  });
});

describe('CA (Canada) Federal Income Tax', () => {
  it('should calculate tax on $80,000 income', () => {
    // $80,000 = 8,000,000 cents
    // Bracket 1: $57,375 at 15% = $8,606.25
    // Bracket 2: $22,625 ($80,000 - $57,375) at 20.5% = $4,638.125
    const incomeCents = 80_000_00;
    const tax = calcProgressiveTax(incomeCents, CA_FEDERAL_BRACKETS);

    const bracket1 = Math.round(57_375_00 * 0.15);
    const bracket2 = Math.round(22_625_00 * 0.205);
    const expected = bracket1 + bracket2;

    expect(tax).toBe(expected);
    // bracket1 = 860,625c = $8,606.25
    expect(bracket1).toBe(860_625);
    // bracket2 = Math.round(4,638,125) = 463,813c = $4,638.13
    expect(bracket2).toBe(463_813);
    // Total = $13,244.38
    expect(tax).toBe(860_625 + 463_813);
  });

  it('should handle income at first bracket boundary', () => {
    const tax = calcProgressiveTax(57_375_00, CA_FEDERAL_BRACKETS);
    expect(tax).toBe(Math.round(57_375_00 * 0.15));
  });
});

describe('CA (Canada) CPP Self-Employment Tax', () => {
  it('should calculate CPP on $80,000 net income at 11.9%', () => {
    // The server uses a simplified CPP: 11.9% of net income
    // (not the real CPP exemption logic with $3,500 basic exemption)
    const cppTax = calcSelfEmploymentTax(80_000_00, 'ca');
    const expected = Math.round(80_000_00 * 0.119);
    expect(cppTax).toBe(expected);
    // 80,000 * 0.119 = 9,520
    expect(cppTax / 100).toBeCloseTo(9_520, 0);
  });

  it('should return 0 for negative income', () => {
    expect(calcSelfEmploymentTax(-10_000_00, 'ca')).toBe(0);
  });
});

describe('Full Tax Estimate (US)', () => {
  it('should compute full estimate for $100,000 net income', () => {
    const result = calculateFullTaxEstimate(100_000_00, 'us');

    // SE tax = $100,000 * 0.9235 * 0.153
    const expectedSE = Math.round(100_000_00 * 0.9235 * 0.153);
    expect(result.seTaxCents).toBe(expectedSE);

    // SE deduction = 50% of SE tax
    const expectedDeduction = Math.round(expectedSE / 2);
    expect(result.seDeductionCents).toBe(expectedDeduction);

    // Taxable income = $100,000 - SE deduction
    const expectedTaxable = 100_000_00 - expectedDeduction;
    expect(result.taxableIncomeCents).toBe(expectedTaxable);

    // Income tax from brackets
    const expectedIncomeTax = calcProgressiveTax(expectedTaxable, US_FEDERAL_BRACKETS);
    expect(result.incomeTaxCents).toBe(expectedIncomeTax);

    // Total = SE + income tax
    expect(result.totalTaxCents).toBe(expectedSE + expectedIncomeTax);
  });

  it('should compute full estimate for $0 net income', () => {
    const result = calculateFullTaxEstimate(0, 'us');
    expect(result.seTaxCents).toBe(0);
    expect(result.incomeTaxCents).toBe(0);
    expect(result.totalTaxCents).toBe(0);
  });
});

describe('Full Tax Estimate (CA)', () => {
  it('should not apply SE deduction for Canadian jurisdiction', () => {
    const result = calculateFullTaxEstimate(80_000_00, 'ca');
    expect(result.seDeductionCents).toBe(0);
    // Taxable income should equal net income for CA
    expect(result.taxableIncomeCents).toBe(80_000_00);
  });
});

describe('Unknown Jurisdiction SE Tax', () => {
  it('should return 0 SE tax for unknown jurisdiction', () => {
    expect(calcSelfEmploymentTax(100_000_00, 'uk')).toBe(0);
    expect(calcSelfEmploymentTax(100_000_00, 'au')).toBe(0);
  });
});

describe('P&L Calculation', () => {
  it('should calculate net income as revenue minus expenses', () => {
    expect(calculateNetIncome(500_000_00, 300_000_00)).toBe(200_000_00);
  });

  it('should handle net loss (expenses exceed revenue)', () => {
    expect(calculateNetIncome(100_000_00, 150_000_00)).toBe(-50_000_00);
  });

  it('should handle zero revenue and zero expenses', () => {
    expect(calculateNetIncome(0, 0)).toBe(0);
  });

  it('should handle zero expenses', () => {
    expect(calculateNetIncome(100_000_00, 0)).toBe(100_000_00);
  });
});

describe('Balance Sheet Equation', () => {
  it('should be balanced when assets = liabilities + equity', () => {
    expect(isBalanceSheetBalanced(100_000_00, 40_000_00, 60_000_00)).toBe(true);
  });

  it('should be unbalanced when assets != liabilities + equity', () => {
    expect(isBalanceSheetBalanced(100_000_00, 40_000_00, 50_000_00)).toBe(false);
  });

  it('should handle zero values', () => {
    expect(isBalanceSheetBalanced(0, 0, 0)).toBe(true);
  });

  it('should handle case with no liabilities (owner-funded)', () => {
    expect(isBalanceSheetBalanced(50_000_00, 0, 50_000_00)).toBe(true);
  });

  it('should handle negative equity (accumulated losses)', () => {
    // Assets = 30k, Liabilities = 50k, Equity = -20k
    expect(isBalanceSheetBalanced(30_000_00, 50_000_00, -20_000_00)).toBe(true);
  });
});
