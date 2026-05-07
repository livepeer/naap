/**
 * Unit tests for the invoice NL parser. We exercise the regex fallback
 * directly so the suite can run offline; the Gemini path is integration-
 * tested elsewhere.
 */

import { describe, expect, it, vi } from 'vitest';
// Stub `server-only` so the parser can be loaded in a vitest environment.
vi.mock('server-only', () => ({}));
import { parseInvoiceWithRegex } from './agentbook-invoice-parser';

describe('parseInvoiceWithRegex', () => {
  it('parses a simple single-line invoice', () => {
    const result = parseInvoiceWithRegex('invoice Acme $5000 for July consulting');
    expect(result).not.toBeNull();
    expect(result?.clientNameHint).toBe('Acme');
    expect(result?.amountCents).toBe(500000);
    expect(result?.lines).toHaveLength(1);
    expect(result?.lines[0]).toMatchObject({
      description: 'July consulting',
      rateCents: 500000,
      quantity: 1,
    });
    expect(result?.dueDateHint).toBe('net-30');
    expect(result?.currencyHint).toBe('USD');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('handles the K suffix', () => {
    const result = parseInvoiceWithRegex('invoice Acme $5K for July consulting');
    expect(result).not.toBeNull();
    expect(result?.amountCents).toBe(500000);
    expect(result?.lines[0].rateCents).toBe(500000);
  });

  it('parses a multi-line invoice separated by commas', () => {
    const result = parseInvoiceWithRegex('invoice Acme $5K consulting, $1K hosting');
    expect(result).not.toBeNull();
    expect(result?.clientNameHint).toBe('Acme');
    expect(result?.lines).toHaveLength(2);
    expect(result?.lines[0]).toMatchObject({ description: 'consulting', rateCents: 500000 });
    expect(result?.lines[1]).toMatchObject({ description: 'hosting', rateCents: 100000 });
    expect(result?.amountCents).toBe(600000);
  });

  it('parses a multi-line invoice with "and"', () => {
    const result = parseInvoiceWithRegex('invoice TechCorp $3000 for design and $500 for hosting');
    expect(result).not.toBeNull();
    expect(result?.clientNameHint).toBe('TechCorp');
    expect(result?.lines).toHaveLength(2);
    expect(result?.amountCents).toBe(350000);
  });

  it('handles "bill" verb and multi-word client names', () => {
    const result = parseInvoiceWithRegex("bill Acme Corp $2,500 for retainer");
    expect(result).not.toBeNull();
    expect(result?.clientNameHint).toBe('Acme Corp');
    expect(result?.amountCents).toBe(250000);
  });

  it('returns null when the message does not start with an invoice trigger', () => {
    expect(parseInvoiceWithRegex('hi there')).toBeNull();
    expect(parseInvoiceWithRegex('spent $50 on lunch')).toBeNull();
    expect(parseInvoiceWithRegex('show my invoices')).toBeNull();
  });

  it('returns null when the trigger is present but no amount is given', () => {
    expect(parseInvoiceWithRegex('invoice Acme for some consulting')).toBeNull();
  });

  it('returns null when the client name is missing', () => {
    expect(parseInvoiceWithRegex('invoice $5000 for consulting')).toBeNull();
  });

  // Hostile / pathological input — make sure we never produce a draft
  // with a non-positive or non-finite amount, and never hang on long
  // input thanks to a catastrophic regex backtrack.

  it('rejects negative amounts', () => {
    expect(parseInvoiceWithRegex('invoice Acme $-500 for consulting')).toBeNull();
  });

  it('rejects zero amounts', () => {
    expect(parseInvoiceWithRegex('invoice Acme $0 for consulting')).toBeNull();
  });

  it('rejects non-finite tokens (Infinity, NaN)', () => {
    expect(parseInvoiceWithRegex('invoice Acme $Infinity for consulting')).toBeNull();
    expect(parseInvoiceWithRegex('invoice Acme $NaN for consulting')).toBeNull();
  });

  it('handles a 10,000-character input within 100ms', () => {
    const filler = 'a '.repeat(5000); // ~10000 chars
    const text = `invoice Acme ${filler} $5000 for consulting`;
    const start = Date.now();
    const result = parseInvoiceWithRegex(text);
    const elapsed = Date.now() - start;
    // The shape of the regex is linear in length; we don't care if it
    // returns null vs a result, just that it doesn't pin a CPU.
    expect(elapsed).toBeLessThan(100);
    // Either null or a sensible parse — never a crash.
    expect(result === null || typeof result === 'object').toBe(true);
  });
});
