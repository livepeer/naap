/** @vitest-environment node */

import { describe, it, expect } from 'vitest';

import {
  buildMeScopeUsagePayload,
  getUsageRecordUserIdsForExternalUser,
  getUtcCalendarMonthIsoBounds,
  parseUsageDateParam,
  isSystemAdmin,
} from '@/lib/pymthouse-usage-helpers';

describe('pymthouse-usage-helpers', () => {
  it('parseUsageDateParam accepts ISO and rejects junk', () => {
    expect(parseUsageDateParam('2025-04-01T00:00:00.000Z')).toBe('2025-04-01T00:00:00.000Z');
    expect(parseUsageDateParam('not-a-date')).toBeNull();
    expect(parseUsageDateParam('')).toBeNull();
    expect(parseUsageDateParam(null)).toBeNull();
  });

  it('buildMeScopeUsagePayload uses matching bucket for currentUser', () => {
    const body = buildMeScopeUsagePayload(
      {
        clientId: 'app',
        period: { start: null, end: null },
        totals: { requestCount: 0, totalFeeWei: '0' },
        byUser: [
          { endUserId: 'a', externalUserId: 'x', requestCount: 1, feeWei: '1' },
          { endUserId: 'b', externalUserId: 'y', requestCount: 2, feeWei: '2' },
        ],
      },
      'y',
    );
    expect(body.currentUser).toMatchObject({
      externalUserId: 'y',
      requestCount: 2,
      feeWei: '2',
    });
    expect(body.currentUser.pipelineModels).toEqual([]);
  });

  it('buildMeScopeUsagePayload aggregates duplicate externalUserId buckets (SDK)', () => {
    const body = buildMeScopeUsagePayload(
      {
        clientId: 'app',
        period: { start: null, end: null },
        totals: { requestCount: 0, totalFeeWei: '0' },
        byUser: [
          { endUserId: 'app-user-id', externalUserId: 'naap-user-id', requestCount: 19, feeWei: '1123447749974' },
          { endUserId: 'end-user-id', externalUserId: 'naap-user-id', requestCount: 43, feeWei: '2540996510612' },
          { endUserId: 'naap-user-id', externalUserId: 'naap-user-id', requestCount: 10, feeWei: '591680839970' },
        ],
      },
      'naap-user-id',
    );
    expect(body.currentUser).toMatchObject({
      externalUserId: 'naap-user-id',
      requestCount: 72,
      feeWei: '4256125100556',
    });
    expect(body.currentUser.pipelineModels).toEqual([]);
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
    expect(body.currentUser.pipelineModels).toEqual([]);
  });

  it('buildMeScopeUsagePayload includes sorted pipelineModels from second usage response', () => {
    const body = buildMeScopeUsagePayload(
      {
        clientId: 'app',
        period: { start: 'a', end: 'b' },
        totals: { requestCount: 1, totalFeeWei: '10' },
        byUser: [{ endUserId: 'u', externalUserId: 'me', requestCount: 1, feeWei: '10' }],
      },
      'me',
      {
        clientId: 'app',
        period: { start: 'a', end: 'b' },
        totals: { requestCount: 0, totalFeeWei: '0' },
        byPipelineModel: [
          {
            pipeline: 'z',
            modelId: 'm1',
            requestCount: 2,
            networkFeeWei: '20',
            networkFeeUsdMicros: '0',
            ownerChargeUsdMicros: '0',
            endUserBillableUsdMicros: '0',
          },
          {
            pipeline: 'a',
            modelId: 'm2',
            requestCount: 1,
            networkFeeWei: '10',
            networkFeeUsdMicros: '0',
            ownerChargeUsdMicros: '0',
            endUserBillableUsdMicros: '0',
          },
        ],
      },
    );
    expect(body.currentUser.pipelineModels.map((r) => `${r.pipeline}:${r.modelId}`)).toEqual([
      'a:m2',
      'z:m1',
    ]);
  });

  it('getUsageRecordUserIdsForExternalUser returns all matching storage ids', () => {
    expect(
      getUsageRecordUserIdsForExternalUser(
        {
          clientId: 'app',
          period: { start: null, end: null },
          totals: { requestCount: 0, totalFeeWei: '0' },
          byUser: [
            { endUserId: 'app-user-id', externalUserId: 'me', requestCount: 1, feeWei: '1' },
            { endUserId: 'end-user-id', externalUserId: 'me', requestCount: 2, feeWei: '2' },
            { endUserId: 'other-id', externalUserId: 'other', requestCount: 3, feeWei: '3' },
            { endUserId: 'unknown', externalUserId: 'me', requestCount: 4, feeWei: '4' },
          ],
        },
        'me',
      ),
    ).toEqual(['app-user-id', 'end-user-id']);
  });

  it('buildMeScopeUsagePayload merges duplicate pipeline/model rows from multiple user ids', () => {
    const body = buildMeScopeUsagePayload(
      {
        clientId: 'app',
        period: { start: 'a', end: 'b' },
        totals: { requestCount: 2, totalFeeWei: '30' },
        byUser: [{ endUserId: 'u', externalUserId: 'me', requestCount: 2, feeWei: '30' }],
      },
      'me',
      [
        {
          clientId: 'app',
          period: { start: 'a', end: 'b' },
          totals: { requestCount: 0, totalFeeWei: '0' },
          byPipelineModel: [
            {
              pipeline: 'p',
              modelId: 'm',
              requestCount: 1,
              networkFeeWei: '10',
              networkFeeUsdMicros: '100',
              ownerChargeUsdMicros: '110',
              endUserBillableUsdMicros: '120',
            },
          ],
        },
        {
          clientId: 'app',
          period: { start: 'a', end: 'b' },
          totals: { requestCount: 0, totalFeeWei: '0' },
          byPipelineModel: [
            {
              pipeline: 'p',
              modelId: 'm',
              requestCount: 2,
              networkFeeWei: '20',
              networkFeeUsdMicros: '200',
              ownerChargeUsdMicros: '220',
              endUserBillableUsdMicros: '240',
            },
          ],
        },
      ],
    );
    expect(body.currentUser.pipelineModels).toEqual([
      {
        pipeline: 'p',
        modelId: 'm',
        requestCount: 3,
        networkFeeWei: '30',
        networkFeeUsdMicros: '300',
        ownerChargeUsdMicros: '330',
        endUserBillableUsdMicros: '360',
      },
    ]);
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
