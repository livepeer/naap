import { describe, it, expect } from 'vitest';
import { formatCurrency, formatDate, formatNumber, formatPercent } from '../formatters.js';

describe('formatCurrency', () => {
  it('formats USD cents to en-US dollar string', () => {
    const result = formatCurrency(4500, 'en-US', 'USD');
    expect(result).toContain('$');
    expect(result).toContain('45.00');
  });

  it('formats CAD cents to fr-CA dollar string with comma decimal', () => {
    const result = formatCurrency(4500, 'fr-CA', 'CAD');
    // French-Canadian format uses comma as decimal separator
    expect(result).toContain('45,00');
    expect(result).toContain('$');
  });

  it('formats zero amount correctly', () => {
    const result = formatCurrency(0, 'en-US', 'USD');
    expect(result).toContain('$');
    expect(result).toContain('0.00');
  });

  it('formats negative amounts', () => {
    const result = formatCurrency(-1500, 'en-US', 'USD');
    expect(result).toContain('15.00');
    // Should include some negative indicator (minus sign or parentheses)
    expect(result).toMatch(/[-\u2212(]/);
  });

  it('handles large amounts', () => {
    const result = formatCurrency(100000000, 'en-US', 'USD');
    expect(result).toContain('1,000,000.00');
  });
});

describe('formatDate', () => {
  it('formats date with en-US locale producing English month', () => {
    const result = formatDate('2026-03-22', 'en-US');
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/22/);
    expect(result).toMatch(/2026/);
  });

  it('formats date with fr-CA locale producing French month', () => {
    const result = formatDate('2026-03-22', 'fr-CA');
    expect(result).toMatch(/mars/i);
    expect(result).toMatch(/2026/);
  });

  it('accepts Date object input', () => {
    const result = formatDate(new Date(2026, 2, 22), 'en-US');
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/22/);
  });
});

describe('formatNumber', () => {
  it('formats number with comma separator for en-US', () => {
    const result = formatNumber(1234.56, 'en-US');
    expect(result).toBe('1,234.56');
  });

  it('formats number with space separator for fr-CA', () => {
    const result = formatNumber(1234.56, 'fr-CA');
    // fr-CA uses narrow no-break space (\u202F) or non-breaking space (\u00A0) as thousands separator
    // and comma as decimal separator
    expect(result).toMatch(/1[\s\u00A0\u202F]234,56/);
  });

  it('formats integer without decimal', () => {
    const result = formatNumber(1000, 'en-US');
    expect(result).toBe('1,000');
  });
});

describe('formatPercent', () => {
  it('formats 0.283 as 28.3% for en-US', () => {
    const result = formatPercent(0.283, 'en-US');
    expect(result).toContain('28.3');
    expect(result).toContain('%');
  });

  it('formats zero percent', () => {
    const result = formatPercent(0, 'en-US');
    expect(result).toContain('0.0%');
  });

  it('formats 100%', () => {
    const result = formatPercent(1, 'en-US');
    expect(result).toContain('100.0%');
  });

  it('respects custom decimal places', () => {
    const result = formatPercent(0.12345, 'en-US', 2);
    expect(result).toContain('12.35');
    expect(result).toContain('%');
  });
});
