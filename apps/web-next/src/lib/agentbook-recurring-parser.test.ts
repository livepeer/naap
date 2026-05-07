/**
 * Unit tests for the recurring-invoice NL parser. The Gemini path needs an
 * API key + network access, so we exercise the regex fallback directly so
 * the suite can run offline. The Gemini code path is covered by the e2e
 * webhook tests.
 */

import { describe, expect, it, vi } from 'vitest';
// Stub `server-only` so the parser can be loaded in a vitest environment.
vi.mock('server-only', () => ({}));
import { parseRecurringWithRegex } from './agentbook-recurring-parser';

describe('parseRecurringWithRegex', () => {
  it('parses a monthly recurring invoice with a $K amount', () => {
    const result = parseRecurringWithRegex(
      'every month invoice TechCorp $5K consulting on the 1st',
    );
    expect(result).not.toBeNull();
    expect(result?.cadence).toBe('monthly');
    expect(result?.amountCents).toBe(500000);
    expect(result?.clientNameHint).toBe('TechCorp');
    expect(result?.dayOfMonth).toBe(1);
    expect(result?.description?.toLowerCase()).toContain('consulting');
  });

  it('parses "set up monthly $1K subscription for Acme"', () => {
    const result = parseRecurringWithRegex('set up monthly $1K subscription for Acme');
    expect(result).not.toBeNull();
    expect(result?.cadence).toBe('monthly');
    expect(result?.amountCents).toBe(100000);
    expect(result?.clientNameHint).toBe('Acme');
    expect(result?.description?.toLowerCase()).toContain('subscription');
  });

  it('parses "schedule a quarterly invoice for Beta $3K"', () => {
    const result = parseRecurringWithRegex('schedule a quarterly invoice for Beta $3K');
    expect(result).not.toBeNull();
    expect(result?.cadence).toBe('quarterly');
    expect(result?.amountCents).toBe(300000);
    expect(result?.clientNameHint).toBe('Beta');
  });

  it('parses weekly cadence', () => {
    const result = parseRecurringWithRegex(
      'create a weekly invoice for Acme $500 for retainer',
    );
    expect(result).not.toBeNull();
    expect(result?.cadence).toBe('weekly');
    expect(result?.amountCents).toBe(50000);
    expect(result?.clientNameHint).toBe('Acme');
  });

  it('parses biweekly cadence', () => {
    const result = parseRecurringWithRegex(
      'set up a biweekly invoice for TechCorp $2000 hosting',
    );
    expect(result).not.toBeNull();
    expect(result?.cadence).toBe('biweekly');
    expect(result?.amountCents).toBe(200000);
    expect(result?.clientNameHint).toBe('TechCorp');
  });

  it('parses annual cadence', () => {
    const result = parseRecurringWithRegex(
      'schedule an annual invoice for BigCo $12000 license',
    );
    expect(result).not.toBeNull();
    expect(result?.cadence).toBe('annual');
    expect(result?.amountCents).toBe(1200000);
    expect(result?.clientNameHint).toBe('BigCo');
  });

  it('returns null when no recurring/cadence trigger is present', () => {
    expect(parseRecurringWithRegex('hi there')).toBeNull();
    expect(parseRecurringWithRegex('invoice Acme $5000 for July consulting')).toBeNull();
    expect(parseRecurringWithRegex('show my invoices')).toBeNull();
  });

  it('returns null when amount is missing', () => {
    expect(
      parseRecurringWithRegex('every month invoice TechCorp for consulting'),
    ).toBeNull();
  });

  it('returns null when client name is missing', () => {
    expect(parseRecurringWithRegex('every month invoice $5000')).toBeNull();
  });

  it('rejects negative amounts', () => {
    expect(
      parseRecurringWithRegex('monthly invoice Acme $-500 for consulting'),
    ).toBeNull();
  });

  it('rejects zero amounts', () => {
    expect(
      parseRecurringWithRegex('monthly invoice Acme $0 for consulting'),
    ).toBeNull();
  });

  it('handles a long input (no catastrophic backtracking) within 100ms', () => {
    const filler = 'a '.repeat(5000);
    const text = `every month invoice Acme $5000 ${filler} for consulting`;
    const start = Date.now();
    const result = parseRecurringWithRegex(text);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
    expect(result === null || typeof result === 'object').toBe(true);
  });
});
