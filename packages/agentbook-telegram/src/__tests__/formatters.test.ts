import { describe, it, expect } from 'vitest';
import {
  formatExpenseConfirmation,
  formatReceiptResult,
  formatDailyPulse,
  formatWeeklyReview,
  formatPaymentReceived,
  formatTaxDeadline,
} from '../formatters.js';

// ---------------------------------------------------------------------------
// formatExpenseConfirmation
// ---------------------------------------------------------------------------
describe('formatExpenseConfirmation', () => {
  it('includes amount, vendor, and date in HTML', () => {
    const result = formatExpenseConfirmation({
      amount: '$45.00',
      vendor: 'Starbucks',
      date: 'Jan 15, 2025',
    });
    expect(result).toContain('<b>$45.00</b>');
    expect(result).toContain('Starbucks');
    expect(result).toContain('Jan 15, 2025');
  });

  it('works without vendor', () => {
    const result = formatExpenseConfirmation({
      amount: '$20.00',
      date: 'Feb 1, 2025',
    });
    expect(result).toContain('<b>$20.00</b>');
    expect(result).toContain('Feb 1, 2025');
    expect(result).not.toContain(' — ');
  });

  it('includes subtotal, tax, and tip when provided', () => {
    const result = formatExpenseConfirmation({
      amount: '$55.00',
      vendor: 'Restaurant',
      date: 'Mar 1, 2025',
      subtotal: '$40.00',
      tax: '$5.00',
      tip: '$10.00',
    });
    expect(result).toContain('Subtotal: $40.00');
    expect(result).toContain('Tax: $5.00');
    expect(result).toContain('Tip: $10.00');
  });

  it('includes category when provided', () => {
    const result = formatExpenseConfirmation({
      amount: '$45.00',
      vendor: 'Office Depot',
      date: 'Jan 15, 2025',
      category: 'Office Supplies',
    });
    expect(result).toContain('Category: Office Supplies');
  });

  it('omits subtotal/tax/tip section when none provided', () => {
    const result = formatExpenseConfirmation({
      amount: '$10.00',
      date: 'Jan 1, 2025',
    });
    expect(result).not.toContain('Subtotal');
    expect(result).not.toContain('Tax');
    expect(result).not.toContain('Tip');
  });
});

// ---------------------------------------------------------------------------
// formatReceiptResult
// ---------------------------------------------------------------------------
describe('formatReceiptResult', () => {
  it('shows low confidence message when isLowConfidence is true', () => {
    const result = formatReceiptResult({
      amount: '$45.00',
      vendor: 'Amazon',
      date: 'Jan 15, 2025',
      category: 'Software',
      confidence: 0.65,
      isLowConfidence: true,
    });
    expect(result).toContain("I'm not very confident");
    expect(result).toContain('65%');
    expect(result).toContain('Software');
  });

  it('shows normal format when not low confidence', () => {
    const result = formatReceiptResult({
      amount: '$45.00',
      vendor: 'Amazon',
      date: 'Jan 15, 2025',
      category: 'Software',
      isLowConfidence: false,
    });
    expect(result).not.toContain("I'm not very confident");
    expect(result).toContain('<b>$45.00</b>');
    expect(result).toContain('Amazon');
    expect(result).toContain('Category: <b>Software</b>');
  });

  it('includes subtotal/tax/tip in normal mode', () => {
    const result = formatReceiptResult({
      amount: '$55.00',
      vendor: 'Restaurant',
      date: 'Mar 1, 2025',
      subtotal: '$40.00',
      tax: '$5.00',
      tip: '$10.00',
    });
    expect(result).toContain('Subtotal: $40.00');
    expect(result).toContain('Tax: $5.00');
    expect(result).toContain('Tip: $10.00');
  });

  it('low confidence without confidence number omits percentage', () => {
    const result = formatReceiptResult({
      amount: '$45.00',
      date: 'Jan 15, 2025',
      isLowConfidence: true,
    });
    expect(result).toContain("I'm not very confident");
    expect(result).not.toContain('%');
  });
});

// ---------------------------------------------------------------------------
// formatDailyPulse
// ---------------------------------------------------------------------------
describe('formatDailyPulse', () => {
  it('includes income, expenses, and balance', () => {
    const result = formatDailyPulse({
      income: '$340',
      expenses: '$127',
      balance: '$12,450',
      actionCount: 0,
    });
    expect(result).toContain('Daily Pulse');
    expect(result).toContain('In: $340');
    expect(result).toContain('Out: $127');
    expect(result).toContain('<b>$12,450</b>');
  });

  it('shows action count when > 0 (singular)', () => {
    const result = formatDailyPulse({
      income: '$100',
      expenses: '$50',
      balance: '$1,000',
      actionCount: 1,
    });
    expect(result).toContain('1 item needs your attention');
  });

  it('shows action count when > 1 (plural)', () => {
    const result = formatDailyPulse({
      income: '$100',
      expenses: '$50',
      balance: '$1,000',
      actionCount: 3,
    });
    expect(result).toContain('3 items need your attention');
  });

  it('does not show action count when 0', () => {
    const result = formatDailyPulse({
      income: '$100',
      expenses: '$50',
      balance: '$1,000',
      actionCount: 0,
    });
    expect(result).not.toContain('need');
    expect(result).not.toContain('attention');
  });
});

// ---------------------------------------------------------------------------
// formatWeeklyReview
// ---------------------------------------------------------------------------
describe('formatWeeklyReview', () => {
  it('includes all summary fields', () => {
    const result = formatWeeklyReview({
      revenue: '$4,200',
      expenses: '$1,340',
      topCategory: 'Software',
      topAmount: '$420',
      taxRate: '22.5%',
    });
    expect(result).toContain('Weekly Review');
    expect(result).toContain('Revenue: $4,200');
    expect(result).toContain('Expenses: $1,340');
    expect(result).toContain('Top spend: Software ($420)');
    expect(result).toContain('Effective tax rate: 22.5%');
  });
});

// ---------------------------------------------------------------------------
// formatPaymentReceived
// ---------------------------------------------------------------------------
describe('formatPaymentReceived', () => {
  it('includes celebration emoji, client, and amounts', () => {
    const result = formatPaymentReceived({
      client: 'Acme Corp',
      amount: '$5,000',
      netAmount: '$4,854.50',
    });
    expect(result).toContain('Acme Corp');
    expect(result).toContain('$5,000');
    expect(result).toContain('Net after fees: $4,854.50');
  });
});

// ---------------------------------------------------------------------------
// formatTaxDeadline
// ---------------------------------------------------------------------------
describe('formatTaxDeadline', () => {
  it('includes days, amount, and quarter', () => {
    const result = formatTaxDeadline({
      days: 14,
      amount: '$3,200',
      quarter: 'Q1 2025',
    });
    expect(result).toContain('Tax Deadline');
    expect(result).toContain('14 days');
    expect(result).toContain('$3,200');
    expect(result).toContain('Q1 2025');
  });
});
