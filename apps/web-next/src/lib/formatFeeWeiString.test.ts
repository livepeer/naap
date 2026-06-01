/** @vitest-environment node */

import { describe, it, expect } from 'vitest';
import { formatFeeWeiStringToEthDisplay } from '@naap/utils';

describe('formatFeeWeiStringToEthDisplay', () => {
  it('formats whole ETH', () => {
    expect(formatFeeWeiStringToEthDisplay('1000000000000000000')).toBe('1');
  });

  it('formats fractional wei with trimming', () => {
    expect(formatFeeWeiStringToEthDisplay('1500000000000000000')).toBe('1.5');
  });

  it('does not underflow to 0 for sub–micro-ETH per-pipeline wei (regression)', () => {
    expect(formatFeeWeiStringToEthDisplay('4727936')).toBe('0.000000000004727936');
  });

  it('formats period-total-style wei with full fractional precision', () => {
    expect(formatFeeWeiStringToEthDisplay('7272526494817')).toBe('0.000007272526494817');
  });

  it('returns em dash for invalid', () => {
    expect(formatFeeWeiStringToEthDisplay('12.34')).toBe('—');
    expect(formatFeeWeiStringToEthDisplay('-1')).toBe('—');
  });
});
