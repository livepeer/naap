import { describe, it, expect } from 'vitest';
import { formatBalance, parseAmount } from '../lib/utils.js';

describe('formatBalance – advanced edge cases', () => {
  it('handles bigint input for 1 token', () => {
    expect(formatBalance(1000000000000000000n)).toBe('1');
  });

  it('handles bigint zero', () => {
    expect(formatBalance(0n)).toBe('0');
  });

  it('handles string input for 1 token', () => {
    expect(formatBalance('1000000000000000000')).toBe('1');
  });

  it('handles string zero', () => {
    expect(formatBalance('0')).toBe('0');
  });

  it('handles empty string as zero', () => {
    expect(formatBalance('')).toBe('0');
  });

  it('handles decimal string by stripping fractional part', () => {
    // '12295.496985577868' → BigInt('12295') → formatUnits(12295n, 18) ≈ 0
    // dust amount, so should show '<0.0001' or '0'
    const result = formatBalance('12295.496985577868');
    expect(['0', '<0.0001']).toContain(result);
  });

  it('handles very large values (100000 LPT)', () => {
    const hundredThousandWei = 100000n * 10n ** 18n;
    const result = formatBalance(hundredThousandWei);
    expect(parseFloat(result.replace(/,/g, ''))).toBe(100000);
  });

  it('shows <0.0001 for dust amounts', () => {
    expect(formatBalance(1n)).toBe('<0.0001');
    expect(formatBalance(1000n)).toBe('<0.0001');
    expect(formatBalance(10n ** 13n)).toBe('<0.0001');
  });

  it('respects displayDecimals parameter', () => {
    // 1.123456789 tokens
    const wei = 1123456789000000000n;
    const twoDecimals = formatBalance(wei, 18, 2);
    expect(twoDecimals).toBe('1.12');

    const sixDecimals = formatBalance(wei, 18, 6);
    expect(sixDecimals).toBe('1.123457');
  });

  it('handles custom token decimals (6 decimals, USDC-like)', () => {
    const oneUSDC = 1000000n;
    expect(formatBalance(oneUSDC, 6)).toBe('1');

    const halfUSDC = 500000n;
    expect(formatBalance(halfUSDC, 6)).toBe('0.5');
  });

  it('formats fractional values correctly', () => {
    // 0.5 tokens
    expect(formatBalance(500000000000000000n)).toBe('0.5');
    // 0.001 tokens
    expect(formatBalance(1000000000000000n)).toBe('0.001');
  });
});

describe('parseAmount – advanced edge cases', () => {
  it('parses "1" to 1e18 bigint', () => {
    expect(parseAmount('1')).toBe(10n ** 18n);
  });

  it('parses "0.5" to 0.5e18 bigint', () => {
    expect(parseAmount('0.5')).toBe(5n * 10n ** 17n);
  });

  it('parses "0" to 0n', () => {
    expect(parseAmount('0')).toBe(0n);
  });

  it('parses small decimal "0.000000000000000001" to 1 wei', () => {
    expect(parseAmount('0.000000000000000001')).toBe(1n);
  });

  it('parses with custom decimals (6 for USDC-like)', () => {
    expect(parseAmount('1', 6)).toBe(1000000n);
    expect(parseAmount('0.5', 6)).toBe(500000n);
  });

  it('throws on invalid input', () => {
    expect(() => parseAmount('abc')).toThrow();
    expect(() => parseAmount('')).toThrow();
  });

  it('round-trips with formatBalance', () => {
    const original = '42.5';
    const wei = parseAmount(original);
    const formatted = formatBalance(wei);
    expect(formatted).toBe('42.5');
  });
});
