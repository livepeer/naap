import { describe, it, expect } from 'vitest';
import { formatBalance, parseAmount } from '../lib/utils.js';

describe('formatBalance', () => {
  it('formats zero', () => {
    expect(formatBalance('0')).toBe('0');
  });

  it('formats 1 ETH/LPT', () => {
    const result = formatBalance('1000000000000000000');
    expect(result).toBe('1');
  });

  it('formats large amounts with locale formatting', () => {
    // 1000 tokens
    const result = formatBalance('1000000000000000000000');
    expect(result).toContain('1');
    // Should have thousands separator or just "1000"
    expect(parseFloat(result.replace(/,/g, ''))).toBe(1000);
  });

  it('formats with custom display decimals', () => {
    const result = formatBalance('1500000000000000000', 18, 2);
    expect(result).toBe('1.5');
  });

  it('shows <0.0001 for dust amounts', () => {
    expect(formatBalance('100')).toBe('<0.0001');
  });

  it('accepts bigint input', () => {
    const result = formatBalance(1000000000000000000n);
    expect(result).toBe('1');
  });
});

describe('parseAmount', () => {
  it('parses 1.0 to wei', () => {
    const result = parseAmount('1.0');
    expect(result).toBe(1000000000000000000n);
  });

  it('parses 0.5 to wei', () => {
    const result = parseAmount('0.5');
    expect(result).toBe(500000000000000000n);
  });
});
