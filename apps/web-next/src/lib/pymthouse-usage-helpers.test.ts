/** @vitest-environment node */

import { describe, it, expect } from 'vitest';

import {
  buildMeScopeUsagePayload,
  getUtcCalendarMonthIsoBounds,
  parseUsageDateParam,
  pickByUserRowForExternalId,
  isSystemAdmin,
} from '@/lib/pymthouse-usage-helpers';

describe('pymthouse-usage-helpers', () => {
  it('parseUsageDateParam accepts ISO and rejects junk', () => {
    expect(parseUsageDateParam('2025-04-01T00:00:00.000Z')).toBe('2025-04-01T00:00:00.000Z');
    expect(parseUsageDateParam('not-a-date')).toBeNull();
    expect(parseUsageDateParam('')).toBeNull();
    expect(parseUsageDateParam(null)).toBeNull();
  });

  it('pickByUserRowForExternalId finds matching externalUserId', () => {
    const row = pickByUserRowForExternalId(
      [
        { endUserId: 'a', externalUserId: 'x', requestCount: 1, feeWei: '1' },
        { endUserId: 'b', externalUserId: 'y', requestCount: 2, feeWei: '2' },
      ],
      'y',
    );
    expect(row?.requestCount).toBe(2);
  });

  it('buildMeScopeUsagePayload zeros when no row', () => {
    const body = buildMeScopeUsagePayload(
      {
        clientId: 'app',
        period: { start: null, end: null },
        totals: { requestCount: 0, totalFeeWei: '0' },
        byUser: [],
      },
      'missing-user',
    );
    expect(body.currentUser.requestCount).toBe(0);
    expect(body.currentUser.feeWei).toBe('0');
  });

  it('getUtcCalendarMonthIsoBounds returns ordered ISO strings', () => {
    const fixed = new Date(Date.UTC(2026, 3, 15, 12, 0, 0));
    const { startDate, endDate } = getUtcCalendarMonthIsoBounds(fixed);
    expect(startDate < endDate).toBe(true);
    expect(startDate.startsWith('2026-04-01')).toBe(true);
  });

  it('isSystemAdmin detects system:admin', () => {
    expect(isSystemAdmin(['user'])).toBe(false);
    expect(isSystemAdmin(['system:admin'])).toBe(true);
  });
});
