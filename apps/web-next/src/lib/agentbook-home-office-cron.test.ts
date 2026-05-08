/**
 * Tests for the home-office quarterly cron's date-gating helper (PR 15).
 *
 * The cron fires daily but only sends Telegram messages on the 1st of
 * Jan / Apr / Jul / Oct — the start of each calendar quarter. We
 * reference the *previous* quarter (the one that just ended), so on
 * Jan 1 we prompt for Q4 of the previous year.
 */

import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

import { quarterTriggerForDate } from '@/app/api/v1/agentbook/cron/home-office-quarterly/route';

describe('quarterTriggerForDate', () => {
  it('Apr 1 → Q1 (just-ended quarter)', () => {
    const r = quarterTriggerForDate(new Date(Date.UTC(2026, 3, 1)));
    expect(r).toEqual({ year: 2026, quarter: 1 });
  });

  it('Jul 1 → Q2', () => {
    const r = quarterTriggerForDate(new Date(Date.UTC(2026, 6, 1)));
    expect(r).toEqual({ year: 2026, quarter: 2 });
  });

  it('Oct 1 → Q3', () => {
    const r = quarterTriggerForDate(new Date(Date.UTC(2026, 9, 1)));
    expect(r).toEqual({ year: 2026, quarter: 3 });
  });

  it('Jan 1 → Q4 of PREVIOUS year', () => {
    // The Q4 just ended (Dec) belongs to last year, so we ask about
    // 2025 Q4 on Jan 1 2026.
    const r = quarterTriggerForDate(new Date(Date.UTC(2026, 0, 1)));
    expect(r).toEqual({ year: 2025, quarter: 4 });
  });

  it('non-quarter-start day → null (e.g. Apr 2, May 5, Dec 31)', () => {
    expect(quarterTriggerForDate(new Date(Date.UTC(2026, 3, 2)))).toBeNull();
    expect(quarterTriggerForDate(new Date(Date.UTC(2026, 4, 5)))).toBeNull();
    expect(quarterTriggerForDate(new Date(Date.UTC(2026, 11, 31)))).toBeNull();
  });

  it('1st of a non-trigger month → null (Feb 1, Mar 1, May 1, Jun 1, Aug 1, Sep 1, Nov 1, Dec 1)', () => {
    for (const m of [1, 2, 4, 5, 7, 8, 10, 11]) {
      expect(
        quarterTriggerForDate(new Date(Date.UTC(2026, m, 1))),
        `month ${m} should not trigger`,
      ).toBeNull();
    }
  });
});
