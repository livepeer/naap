import { describe, it, expect } from 'vitest';
import { caTaxBrackets } from '../ca/tax-brackets.js';
import { caSelfEmploymentTax } from '../ca/self-employment-tax.js';
import { caSalesTax } from '../ca/sales-tax.js';
import { caChartOfAccounts } from '../ca/chart-of-accounts.js';
import { caInstallmentSchedule } from '../ca/installment-schedule.js';
import { caContractorReport } from '../ca/contractor-report.js';
import { caMileageRate } from '../ca/mileage-rate.js';

describe('CA Tax Brackets', () => {
  it('has jurisdiction set to "ca"', () => {
    expect(caTaxBrackets.jurisdiction).toBe('ca');
  });

  it('calculates correct federal tax on $80,000 income', () => {
    // $80,000 = 8,000,000 cents
    // 15% on first $57,375 (5,737,500 cents) = 860,625
    // 20.5% on $57,375-$80,000 ($22,625 = 2,262,500 cents) = 463,813 (rounded)
    const result = caTaxBrackets.calculateTax(8000000, 2025);

    // Bracket 1: 15% on 5,737,500 = 860,625
    expect(result.bracketBreakdown[0].taxCents).toBe(860625);
    // Bracket 2: 20.5% on (8,000,000 - 5,737,500) = 2,262,500 * 0.205 = 463,812.5 -> 463,813
    expect(result.bracketBreakdown[1].taxCents).toBe(463813);

    const expectedTotal = 860625 + 463813; // 1,324,438 cents = $13,244.38
    expect(result.taxCents).toBe(expectedTotal);
  });

  it('returns correct marginal rate for $80,000 income', () => {
    const result = caTaxBrackets.calculateTax(8000000, 2025);
    expect(result.marginalRate).toBe(0.205);
  });

  it('returns two bracket breakdowns for $80,000 income', () => {
    const result = caTaxBrackets.calculateTax(8000000, 2025);
    expect(result.bracketBreakdown).toHaveLength(2);
  });

  it('returns zero tax for zero income', () => {
    const result = caTaxBrackets.calculateTax(0, 2025);
    expect(result.taxCents).toBe(0);
    expect(result.effectiveRate).toBe(0);
  });
});

describe('CA Self-Employment Tax (CPP)', () => {
  it('calculates CPP on $100,000 net income correctly', () => {
    // $100,000 = 10,000,000 cents
    const result = caSelfEmploymentTax.calculate(10000000, 2025);

    // Pensionable earnings capped at $71,300 = 7,130,000
    // CPP base = 7,130,000 - 350,000 (basic exemption) = 6,780,000
    // CPP = 6,780,000 * 0.119 = 806,820
    const expectedCppBase = 7130000 - 350000; // 6,780,000
    const expectedCpp = Math.round(expectedCppBase * 0.119); // 806,820
    expect(result.breakdown.cpp).toBe(expectedCpp);

    // CPP2: 8% on earnings between $71,300-$81,200
    // $100k > $81,200 so: (8,120,000 - 7,130,000) * 0.08 = 990,000 * 0.08 = 79,200
    const expectedCpp2 = Math.round(990000 * 0.08);
    expect(result.breakdown.cpp2).toBe(expectedCpp2);

    // EI is 0 for self-employed
    expect(result.breakdown.ei).toBe(0);

    expect(result.amountCents).toBe(expectedCpp + expectedCpp2);
  });

  it('deductible portion is half of total', () => {
    const result = caSelfEmploymentTax.calculate(10000000, 2025);
    expect(result.deductiblePortionCents).toBe(Math.round(result.amountCents / 2));
  });

  it('does not charge CPP2 when income is below first ceiling', () => {
    // $50,000 = 5,000,000 cents (below $71,300 cap)
    const result = caSelfEmploymentTax.calculate(5000000, 2025);
    expect(result.breakdown.cpp2).toBe(0);
  });

  it('calculates correct CPP on income below basic exemption', () => {
    // $3,000 = 300,000 cents (below $3,500 basic exemption)
    const result = caSelfEmploymentTax.calculate(300000, 2025);
    expect(result.breakdown.cpp).toBe(0);
    expect(result.amountCents).toBe(0);
  });
});

describe('CA Sales Tax', () => {
  it('returns 13% HST for Ontario', () => {
    const rates = caSalesTax.getRates('ON');
    expect(rates).toHaveLength(1);
    expect(rates[0].taxType).toBe('HST');
    expect(rates[0].rate).toBe(0.13);
  });

  it('returns 5% GST only for Alberta', () => {
    const rates = caSalesTax.getRates('AB');
    expect(rates).toHaveLength(1);
    expect(rates[0].taxType).toBe('GST');
    expect(rates[0].rate).toBe(0.05);
  });

  it('returns GST + QST for Quebec', () => {
    const rates = caSalesTax.getRates('QC');
    expect(rates).toHaveLength(2);
    const gst = rates.find(r => r.taxType === 'GST');
    const qst = rates.find(r => r.taxType === 'PST');
    expect(gst).toBeDefined();
    expect(gst!.rate).toBe(0.05);
    expect(qst).toBeDefined();
    expect(qst!.rate).toBe(0.09975);
  });

  it('calculates total tax correctly for Ontario', () => {
    const result = caSalesTax.calculateTax(10000, 'ON'); // $100.00
    expect(result.totalRate).toBe(0.13);
    expect(result.totalCents).toBe(1300);
  });

  it('calculates combined GST+QST for Quebec', () => {
    const result = caSalesTax.calculateTax(10000, 'QC');
    const expectedTotal = 0.05 + 0.09975;
    expect(result.totalRate).toBeCloseTo(expectedTotal, 5);
    // GST component: 500, QST component: round(10000 * 0.09975) = 998
    expect(result.totalCents).toBe(500 + 998);
  });

  it('handles case-insensitive region codes', () => {
    const rates = caSalesTax.getRates('on');
    expect(rates[0].rate).toBe(0.13);
  });
});

describe('CA Chart of Accounts', () => {
  it('returns T2125 aligned accounts', () => {
    const accounts = caChartOfAccounts.getDefaultAccounts('sole_proprietor');
    expect(accounts.length).toBeGreaterThan(0);
  });

  it('has all account types', () => {
    const accounts = caChartOfAccounts.getDefaultAccounts('sole_proprietor');
    const types = new Set(accounts.map(a => a.type));
    expect(types).toContain('asset');
    expect(types).toContain('liability');
    expect(types).toContain('equity');
    expect(types).toContain('revenue');
    expect(types).toContain('expense');
  });

  it('has expense accounts with T2125 tax categories (Line XXXX format)', () => {
    const accounts = caChartOfAccounts.getDefaultAccounts('sole_proprietor');
    const expenseAccounts = accounts.filter(a => a.type === 'expense');
    expect(expenseAccounts.every(a => a.taxCategory)).toBe(true);
    // T2125 uses "Line XXXX" format (4-digit codes like 8521, 8810, etc.)
    expect(expenseAccounts.some(a => a.taxCategory?.match(/Line \d{4}/))).toBe(true);
  });

  it('includes GST/HST Payable liability', () => {
    const accounts = caChartOfAccounts.getDefaultAccounts('sole_proprietor');
    const gstAccount = accounts.find(a => a.name.includes('GST/HST'));
    expect(gstAccount).toBeDefined();
    expect(gstAccount!.type).toBe('liability');
  });

  it('provides tax category mapping', () => {
    const mapping = caChartOfAccounts.getTaxCategoryMapping();
    expect(Object.keys(mapping).length).toBeGreaterThan(0);
    // code '5000' should map to Advertising
    expect(mapping['5000']).toMatch(/Advertising/);
  });
});

describe('CA Installment Schedule', () => {
  it('returns 4 quarterly deadlines', () => {
    const deadlines = caInstallmentSchedule.getDeadlines(2025);
    expect(deadlines).toHaveLength(4);
  });

  it('has correct deadline months: Mar, Jun, Sep, Dec', () => {
    const deadlines = caInstallmentSchedule.getDeadlines(2025);
    // JavaScript months are 0-indexed: 2=Mar, 5=Jun, 8=Sep, 11=Dec
    expect(deadlines[0].deadline.getMonth()).toBe(2);   // March
    expect(deadlines[1].deadline.getMonth()).toBe(5);   // June
    expect(deadlines[2].deadline.getMonth()).toBe(8);   // September
    expect(deadlines[3].deadline.getMonth()).toBe(11);  // December
  });

  it('all deadlines are within the same tax year', () => {
    const deadlines = caInstallmentSchedule.getDeadlines(2025);
    for (const d of deadlines) {
      expect(d.deadline.getFullYear()).toBe(2025);
    }
  });

  it('all deadlines fall on the 15th', () => {
    const deadlines = caInstallmentSchedule.getDeadlines(2025);
    for (const d of deadlines) {
      expect(d.deadline.getDate()).toBe(15);
    }
  });

  it('calculates prior-year method as prior year tax / 4', () => {
    const amount = caInstallmentSchedule.calculateAmount('prior_year', 0, 800000);
    expect(amount).toBe(200000);
  });
});

describe('CA Contractor Report', () => {
  it('uses T4A form', () => {
    expect(caContractorReport.formId).toBe('T4A');
  });

  it('has $500 threshold (50000 cents)', () => {
    expect(caContractorReport.threshold).toBe(50000);
  });

  it('filters contractors by $500 threshold', () => {
    const payments = [
      { name: 'Alice', totalCents: 100000 },  // $1,000 - above
      { name: 'Bob', totalCents: 40000 },      // $400 - below
      { name: 'Carol', totalCents: 50000 },    // $500 - exactly at threshold
      { name: 'Dave', totalCents: 49999 },     // $499.99 - below
    ];
    const reports = caContractorReport.generate(payments, 2025);
    expect(reports).toHaveLength(2);
    expect(reports.map(r => r.contractorName)).toEqual(['Alice', 'Carol']);
    expect(reports.every(r => r.formId === 'T4A')).toBe(true);
  });

  it('returns empty array when no payments meet threshold', () => {
    const reports = caContractorReport.generate([], 2025);
    expect(reports).toHaveLength(0);
  });
});

describe('CA Mileage Rate', () => {
  it('returns $0.72/km for first 5000 km', () => {
    const result = caMileageRate.getRate(2025, 3000);
    expect(result.rate).toBe(0.72);
    expect(result.unit).toBe('km');
  });

  it('unit is "km"', () => {
    const result = caMileageRate.getRate(2025, 1000);
    expect(result.unit).toBe('km');
  });

  it('returns blended rate for distance over 5000 km', () => {
    const result = caMileageRate.getRate(2025, 10000);
    // First 5000 km at $0.72 = $3,600
    // Next 5000 km at $0.66 = $3,300
    // Total: $6,900 / 10,000 = $0.69
    expect(result.rate).toBe(0.69);
    expect(result.unit).toBe('km');
  });

  it('returns $0.72 for exactly 5000 km (at threshold boundary)', () => {
    const result = caMileageRate.getRate(2025, 5000);
    expect(result.rate).toBe(0.72);
  });

  it('includes tier description for distance over threshold', () => {
    const result = caMileageRate.getRate(2025, 10000);
    expect(result.tierDescription).toContain('5000');
    expect(result.tierDescription).toContain('0.72');
    expect(result.tierDescription).toContain('0.66');
  });
});
