import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildDeterministicSummary, computeSummary, _resetCache } from '../agent-summary.js';

beforeEach(() => _resetCache());

describe('buildDeterministicSummary', () => {
  it('summarizes overdue + tax', () => {
    const s = buildDeterministicSummary({
      overdueCount: 3,
      overdueAmountCents: 840000,
      taxDaysOut: 12,
    });
    expect(s).toMatch(/3 invoices overdue/);
    expect(s).toMatch(/\$8,400/);
    expect(s).toMatch(/Tax payment in 12 days/);
  });

  it('All clear when nothing pending', () => {
    expect(buildDeterministicSummary({
      overdueCount: 0, overdueAmountCents: 0, taxDaysOut: null,
    })).toBe('All clear ☕');
  });
});

describe('computeSummary cache', () => {
  it('returns deterministic when callGemini returns null', async () => {
    const fakeGemini = vi.fn().mockResolvedValue(null);
    const out = await computeSummary('tenant-A', { overdueCount: 1, overdueAmountCents: 100000, taxDaysOut: null }, fakeGemini);
    expect(out.source).toBe('fallback');
    expect(out.summary).toMatch(/1 invoice overdue/);
  });

  it('returns LLM result when callGemini resolves', async () => {
    const fakeGemini = vi.fn().mockResolvedValue('Two big ones land next week — tight.');
    const out = await computeSummary('tenant-A', { overdueCount: 1, overdueAmountCents: 100000, taxDaysOut: null }, fakeGemini);
    expect(out.source).toBe('llm');
    expect(out.summary).toBe('Two big ones land next week — tight.');
  });

  it('caches LLM result for 15 min', async () => {
    const fakeGemini = vi.fn().mockResolvedValue('cached value');
    await computeSummary('tenant-B', { overdueCount: 0, overdueAmountCents: 0, taxDaysOut: null }, fakeGemini);
    await computeSummary('tenant-B', { overdueCount: 0, overdueAmountCents: 0, taxDaysOut: null }, fakeGemini);
    expect(fakeGemini).toHaveBeenCalledTimes(1);
  });

  it('falls back if LLM exceeds 3s', async () => {
    const slowGemini = () => new Promise<string | null>(resolve => setTimeout(() => resolve('too late'), 5000));
    const out = await computeSummary('tenant-C', { overdueCount: 0, overdueAmountCents: 0, taxDaysOut: null }, slowGemini);
    expect(out.source).toBe('fallback');
  }, 10_000);
});
