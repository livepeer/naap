import { describe, it, expect } from 'vitest';
import { pnlToCsv, type PnlSummary, type PnlRow } from '../lib/pnlService.js';

function makeSummary(rows: PnlRow[]): PnlSummary {
  return {
    rows,
    totals: {
      totalStaked: '0',
      totalPrincipal: '0',
      totalRewards: '0',
      totalFees: '0',
      avgDailyReward: '0',
      avgAPR: '0',
    },
    prices: { lptUsd: 0, ethUsd: 0 },
    stakingEvents: [],
  };
}

function makeRow(overrides: Partial<PnlRow> = {}): PnlRow {
  return {
    address: '0xabc',
    orchestrator: '0xdef',
    totalStaked: '100.0000',
    principal: '95.0000',
    accumulatedRewards: '5.0000',
    pendingFees: '0.01000000',
    dailyRewardRate: '0.1000',
    roundsElapsed: 50,
    annualizedAPR: '19.21',
    periodStart: '2025-01-01T00:00:00.000Z',
    periodEnd: '2025-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('pnlToCsv', () => {
  it('generates correct CSV header with all columns', () => {
    const csv = pnlToCsv(makeSummary([]));
    const header = csv.split('\n')[0];

    expect(header).toBe(
      'Address,Orchestrator,Total Staked (LPT),Principal (LPT),Rewards Earned (LPT),' +
      'Pending Fees (ETH),Daily Reward Rate (LPT),Rounds Elapsed,Annualized APR %,' +
      'Period Start,Period End',
    );
  });

  it('formats rows with correct values', () => {
    const row = makeRow();
    const csv = pnlToCsv(makeSummary([row]));
    const lines = csv.split('\n');

    expect(lines).toHaveLength(2);
    const dataLine = lines[1];
    const fields = dataLine.split(',');

    expect(fields[0]).toBe('0xabc');
    expect(fields[1]).toBe('0xdef');
    expect(fields[2]).toBe('100.0000');
    expect(fields[3]).toBe('95.0000');
    expect(fields[4]).toBe('5.0000');
    expect(fields[5]).toBe('0.01000000');
    expect(fields[6]).toBe('0.1000');
    expect(fields[7]).toBe('50');
    expect(fields[8]).toBe('19.21');
    expect(fields[9]).toBe('2025-01-01T00:00:00.000Z');
    expect(fields[10]).toBe('2025-06-01T00:00:00.000Z');
  });

  it('handles multiple rows', () => {
    const row1 = makeRow({ address: '0x111' });
    const row2 = makeRow({ address: '0x222', totalStaked: '200.0000' });
    const csv = pnlToCsv(makeSummary([row1, row2]));
    const lines = csv.split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('0x111');
    expect(lines[2]).toContain('0x222');
    expect(lines[2]).toContain('200.0000');
  });

  it('handles empty rows array', () => {
    const csv = pnlToCsv(makeSummary([]));
    const lines = csv.split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Address');
    expect(lines[1]).toBe('');
  });

  it('handles special characters in orchestrator names', () => {
    const row = makeRow({ orchestrator: 'Orch "Best", Inc.' });
    const csv = pnlToCsv(makeSummary([row]));
    const lines = csv.split('\n');

    expect(lines[1]).toContain('"Orch ""Best"", Inc."');
  });

  it('escapes fields containing commas', () => {
    const row = makeRow({ orchestrator: 'Orch, Ltd' });
    const csv = pnlToCsv(makeSummary([row]));
    const lines = csv.split('\n');

    expect(lines[1]).toContain('"Orch, Ltd"');
  });

  it('escapes fields containing newlines', () => {
    const row = makeRow({ orchestrator: 'Orch\nLine2' });
    const csv = pnlToCsv(makeSummary([row]));

    expect(csv).toContain('"Orch\nLine2"');
  });
});
