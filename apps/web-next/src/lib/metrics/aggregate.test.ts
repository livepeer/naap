/**
 * Cross-provider aggregation guardrail (NAAP-2).
 * Required by the catalog: "aggregation unit across ≥2 providers".
 */

import { describe, it, expect } from 'vitest';
import { aggregateSpendByProvider, type UsageRecordLike } from './aggregate';

const records: UsageRecordLike[] = [
  {
    providerSlug: 'pymthouse',
    accountId: 'acct_a',
    appId: 'app_sb',
    sessions: 10,
    tickets: 100,
    feeWei: '1000000000000000000',
    networkFeeUsdMicros: '4000000',
  },
  {
    providerSlug: 'pymthouse',
    accountId: 'acct_a',
    appId: 'app_cli',
    sessions: 5,
    tickets: 50,
    feeWei: '2000000000000000000',
    networkFeeUsdMicros: '2000000',
  },
  {
    providerSlug: 'stub',
    accountId: 'acct_b',
    appId: 'app_sb',
    sessions: 3,
    tickets: 30,
    feeWei: '500',
    networkFeeUsdMicros: '1000',
  },
];

describe('aggregateSpendByProvider', () => {
  it('produces one row per provider (cross-provider spend view)', () => {
    const rows = aggregateSpendByProvider(records);
    expect(rows.map((r) => r.providerSlug)).toEqual(['pymthouse', 'stub']);
  });

  it('sums sessions/tickets and BigInt monetary fields per provider', () => {
    const rows = aggregateSpendByProvider(records);
    const pymt = rows.find((r) => r.providerSlug === 'pymthouse')!;
    expect(pymt.sessions).toBe(15);
    expect(pymt.tickets).toBe(150);
    // 1e18 + 2e18 — exact via BigInt, no float loss
    expect(pymt.feeWei).toBe('3000000000000000000');
    expect(pymt.networkFeeUsdMicros).toBe('6000000');
    expect(pymt.accounts).toBe(1);
    expect(pymt.apps).toBe(2);

    const stub = rows.find((r) => r.providerSlug === 'stub')!;
    expect(stub.feeWei).toBe('500');
    expect(stub.accounts).toBe(1);
    expect(stub.apps).toBe(1);
  });

  it('treats missing numeric/monetary fields as zero and ignores null appId', () => {
    const rows = aggregateSpendByProvider([
      { providerSlug: 'stub', accountId: 'acct_x', appId: null },
      { providerSlug: 'stub', accountId: 'acct_x', tickets: 7 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sessions).toBe(0);
    expect(rows[0].tickets).toBe(7);
    expect(rows[0].feeWei).toBe('0');
    expect(rows[0].apps).toBe(0);
    expect(rows[0].accounts).toBe(1);
  });

  it('returns an empty view for no records', () => {
    expect(aggregateSpendByProvider([])).toEqual([]);
  });

  it('throws on a malformed monetary value (defensive)', () => {
    expect(() =>
      aggregateSpendByProvider([
        { providerSlug: 'stub', accountId: 'a', feeWei: 'not-a-number' },
      ]),
    ).toThrow(/non-decimal/);
  });

  it('omits byCapability for legacy/push records that carry none', () => {
    const rows = aggregateSpendByProvider(records);
    for (const row of rows) {
      expect('byCapability' in row).toBe(false);
    }
  });

  it('rolls up byCapability per provider when records carry it (pull path)', () => {
    const rows = aggregateSpendByProvider([
      {
        providerSlug: 'pymthouse',
        accountId: 'acct_a',
        tickets: 30,
        networkFeeUsdMicros: '3000',
        byCapability: {
          'text-to-image:sdxl': { tickets: 20, networkFeeUsdMicros: '2000' },
          'live-video:lvx': { tickets: 10, networkFeeUsdMicros: '1000' },
        },
      },
      {
        providerSlug: 'pymthouse',
        accountId: 'acct_b',
        tickets: 5,
        networkFeeUsdMicros: '500',
        byCapability: {
          'text-to-image:sdxl': { tickets: 5, networkFeeUsdMicros: '500' },
        },
      },
    ]);
    expect(rows).toHaveLength(1);
    const pymt = rows[0];
    expect(pymt.byCapability).toEqual({
      'text-to-image:sdxl': { tickets: 25, networkFeeUsdMicros: '2500' },
      'live-video:lvx': { tickets: 10, networkFeeUsdMicros: '1000' },
    });
  });
});
