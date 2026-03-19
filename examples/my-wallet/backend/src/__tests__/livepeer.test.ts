import { describe, it, expect } from 'vitest';
import { toWei } from '../lib/livepeer.js';

describe('toWei', () => {
  it('returns "0" for null', () => {
    expect(toWei(null)).toBe('0');
  });

  it('returns "0" for undefined', () => {
    expect(toWei(undefined)).toBe('0');
  });

  it('returns "0" for empty string', () => {
    expect(toWei('')).toBe('0');
  });

  it('returns "0" for the string "0"', () => {
    expect(toWei('0')).toBe('0');
  });

  it('passes through pure integer strings unchanged', () => {
    expect(toWei('1000')).toBe('1000');
    expect(toWei('999999999999999999')).toBe('999999999999999999');
  });

  it('handles negative integer strings', () => {
    expect(toWei('-5')).toBe('-5');
    expect(toWei('-12345')).toBe('-12345');
  });

  it('converts a decimal string to wei via parseUnits', () => {
    // 12295.496985577868554513 * 1e18 = 12295496985577868554513
    expect(toWei('12295.496985577868554513')).toBe('12295496985577868554513');
  });

  it('converts simple decimals to wei', () => {
    expect(toWei('1.0')).toBe('1000000000000000000');
    expect(toWei('0.5')).toBe('500000000000000000');
  });

  it('handles leading-dot decimal like ".5"', () => {
    expect(toWei('.5')).toBe('500000000000000000');
  });

  it('strips decimal portion for malformed strings that parseUnits rejects', () => {
    // parseUnits('abc.def', 18) throws → fallback strips after dot → 'abc'
    expect(toWei('abc.def')).toBe('abc');
  });

  it('returns "0" for malformed string with only dot prefix like ".abc"', () => {
    // slice(0, 0) = '' → '' || '0' = '0'
    expect(toWei('.abc')).toBe('0');
  });
});
