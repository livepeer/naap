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

  it('returns em dash for invalid', () => {
    expect(formatFeeWeiStringToEthDisplay('12.34')).toBe('—');
    expect(formatFeeWeiStringToEthDisplay('-1')).toBe('—');
  });
});
