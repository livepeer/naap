/**
 * Tests for the receipt-expiry description fuzzy matcher (PR 16).
 *
 * The bot intent `manage_receipt_request` parses commands like
 * "send receipt for AWS October bill" or "skip receipt for Stripe fee" and
 * needs to resolve which AbExpense the user is referring to. Pure
 * description-fuzzy-match logic — no DB, no I/O — so it stays a vitest.
 */

import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

import {
  parseManageReceiptCommand,
  scoreExpenseMatch,
  pickBestExpenseMatch,
} from './agentbook-receipt-match';

describe('parseManageReceiptCommand', () => {
  it('parses "send receipt for AWS October bill"', () => {
    const r = parseManageReceiptCommand('send receipt for AWS October bill');
    expect(r).toEqual({ action: 'send', target: 'AWS October bill' });
  });

  it('parses "skip receipt for Stripe fee"', () => {
    const r = parseManageReceiptCommand('skip receipt for Stripe fee');
    expect(r).toEqual({ action: 'skip', target: 'Stripe fee' });
  });

  it('case-insensitive on the verb', () => {
    expect(parseManageReceiptCommand('SEND receipt for X')?.action).toBe('send');
    expect(parseManageReceiptCommand('Skip Receipt For Y')?.action).toBe('skip');
  });

  it('strips trailing punctuation/whitespace from target', () => {
    const r = parseManageReceiptCommand('send receipt for AWS bill.   ');
    expect(r?.target).toBe('AWS bill');
  });

  it('returns null for unrelated text', () => {
    expect(parseManageReceiptCommand('what is my balance')).toBeNull();
    expect(parseManageReceiptCommand('how much did I spend')).toBeNull();
  });

  it('returns null when target is empty', () => {
    expect(parseManageReceiptCommand('send receipt for ')).toBeNull();
    expect(parseManageReceiptCommand('skip receipt for')).toBeNull();
  });

  it('does not match "send a receipt" without "for X"', () => {
    expect(parseManageReceiptCommand('send a receipt')).toBeNull();
  });
});

describe('scoreExpenseMatch', () => {
  it('exact description match scores highest', () => {
    const s = scoreExpenseMatch('AWS October bill', {
      description: 'AWS October bill',
      vendor: null,
    });
    expect(s).toBeGreaterThan(0.9);
  });

  it('partial token overlap still scores well', () => {
    const s = scoreExpenseMatch('AWS October', {
      description: 'AWS October bill',
      vendor: null,
    });
    expect(s).toBeGreaterThan(0.6);
  });

  it('case-insensitive', () => {
    const a = scoreExpenseMatch('aws october', {
      description: 'AWS October Bill',
      vendor: null,
    });
    const b = scoreExpenseMatch('AWS OCTOBER', {
      description: 'AWS October Bill',
      vendor: null,
    });
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0.5);
  });

  it('vendor name contributes to match', () => {
    const s = scoreExpenseMatch('AWS bill', {
      description: 'October hosting charge',
      vendor: 'AWS',
    });
    expect(s).toBeGreaterThan(0.3);
  });

  it('no overlap → 0', () => {
    const s = scoreExpenseMatch('groceries', {
      description: 'AWS October bill',
      vendor: 'AWS',
    });
    expect(s).toBe(0);
  });

  it('ignores common words like "bill", "for", "the"', () => {
    // "the bill" alone should not match any AWS expense.
    const s = scoreExpenseMatch('the bill', {
      description: 'AWS October bill',
      vendor: 'AWS',
    });
    expect(s).toBeLessThan(0.3);
  });
});

describe('pickBestExpenseMatch', () => {
  const expenses = [
    { id: 'e1', description: 'AWS October bill', vendor: 'AWS' },
    { id: 'e2', description: 'Stripe transaction fee', vendor: 'Stripe' },
    { id: 'e3', description: 'AWS September bill', vendor: 'AWS' },
    { id: 'e4', description: 'GitHub annual', vendor: 'GitHub' },
  ];

  it('picks the expense with the strongest token overlap', () => {
    const best = pickBestExpenseMatch('AWS October bill', expenses);
    expect(best?.id).toBe('e1');
  });

  it('disambiguates between two AWS rows by additional tokens', () => {
    const best = pickBestExpenseMatch('AWS September', expenses);
    expect(best?.id).toBe('e3');
  });

  it('returns null when no expense matches at all', () => {
    const best = pickBestExpenseMatch('groceries from costco', expenses);
    expect(best).toBeNull();
  });

  it('returns null below confidence threshold', () => {
    // "the bill" matches all three "bill" rows weakly — should not pick one.
    const best = pickBestExpenseMatch('the bill', expenses);
    expect(best).toBeNull();
  });

  it('handles empty expense list', () => {
    expect(pickBestExpenseMatch('AWS', [])).toBeNull();
  });
});
