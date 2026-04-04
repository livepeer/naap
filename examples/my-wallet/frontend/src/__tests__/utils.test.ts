import { describe, it, expect } from 'vitest';
import { formatAddress, formatTxHash, getExplorerTxUrl, getExplorerAddressUrl } from '../lib/utils.js';

describe('formatAddress', () => {
  it('formats with default chars', () => {
    expect(formatAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234...5678');
  });

  it('formats with custom chars', () => {
    expect(formatAddress('0x1234567890abcdef1234567890abcdef12345678', 6)).toBe('0x123456...345678');
  });

  it('returns empty string for empty input', () => {
    expect(formatAddress('')).toBe('');
  });
});

describe('formatTxHash', () => {
  const hash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

  it('formats with default chars', () => {
    const result = formatTxHash(hash);
    expect(result).toMatch(/^0x.+\.\.\..+$/);
    expect(result.length).toBeLessThan(hash.length);
  });

  it('returns empty string for empty input', () => {
    expect(formatTxHash('')).toBe('');
  });
});

describe('getExplorerTxUrl', () => {
  const txHash = '0xabc123';

  it('returns arbiscan URL for Arbitrum', () => {
    expect(getExplorerTxUrl(42161, txHash)).toBe('https://arbiscan.io/tx/0xabc123');
  });

  it('returns etherscan URL for mainnet', () => {
    expect(getExplorerTxUrl(1, txHash)).toBe('https://etherscan.io/tx/0xabc123');
  });

  it('defaults to etherscan for unknown chain', () => {
    expect(getExplorerTxUrl(999, txHash)).toBe('https://etherscan.io/tx/0xabc123');
  });
});

describe('getExplorerAddressUrl', () => {
  const addr = '0x1234';

  it('returns arbiscan URL for Arbitrum', () => {
    expect(getExplorerAddressUrl(42161, addr)).toBe('https://arbiscan.io/address/0x1234');
  });

  it('returns goerli URL', () => {
    expect(getExplorerAddressUrl(5, addr)).toBe('https://goerli.etherscan.io/address/0x1234');
  });
});
