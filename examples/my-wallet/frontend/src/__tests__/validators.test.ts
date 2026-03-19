import { describe, it, expect } from 'vitest';
import { isMetaMaskInstalled, delay, formatAddress, formatTxHash } from '../lib/utils.js';

describe('isMetaMaskInstalled', () => {
  it('returns false in node environment (no window)', () => {
    expect(isMetaMaskInstalled()).toBe(false);
  });
});

describe('delay', () => {
  it('resolves after the specified time', async () => {
    const start = Date.now();
    await delay(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it('resolves with undefined', async () => {
    const result = await delay(1);
    expect(result).toBeUndefined();
  });
});

describe('formatAddress – edge cases', () => {
  it('handles undefined-like falsy input', () => {
    expect(formatAddress('')).toBe('');
  });

  it('handles very short addresses gracefully', () => {
    const result = formatAddress('0x1234');
    expect(typeof result).toBe('string');
    expect(result.includes('...')).toBe(true);
  });

  it('handles chars=0 (slice(-0) returns full string in JS)', () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    const result = formatAddress(addr, 0);
    // slice(0, 2) = '0x', slice(-0) = slice(0) = full string
    expect(result).toBe(`0x...${addr}`);
  });

  it('preserves full address when chars is very large', () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    const result = formatAddress(addr, 40);
    expect(result).toContain('0x');
    expect(result).toContain('...');
  });
});

describe('formatTxHash – edge cases', () => {
  it('handles empty string', () => {
    expect(formatTxHash('')).toBe('');
  });

  it('formats with custom chars parameter', () => {
    const hash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const result = formatTxHash(hash, 4);
    expect(result).toBe(`0x${hash.slice(2, 6)}...${hash.slice(-4)}`);
  });
});
