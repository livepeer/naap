import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  appendTurn,
  clearMentionedEntities,
  setMentionedEntities,
  setPendingSlots,
  MAX_RECENT_TURNS,
  type ConversationContext,
} from './agentbook-conversation-context';
import {
  resolveReference,
  entityFromInvoice,
  entityFromExpense,
  type ReferenceResolution,
} from './agentbook-reference-resolver';
import {
  evaluateSlots,
  mergeSlots,
} from './agentbook-slot-accumulator';

function emptyCtx(): ConversationContext {
  return {
    lastBotTopic: null,
    recentTurns: [],
    mentionedEntities: [],
    pendingSlots: null,
    lastActiveAt: new Date().toISOString(),
  };
}

describe('appendTurn', () => {
  it('appends and caps at MAX_RECENT_TURNS', () => {
    let ctx = emptyCtx();
    for (let i = 0; i < 5; i++) {
      ctx = appendTurn(ctx, i % 2 === 0 ? 'user' : 'bot', `turn ${i}`);
    }
    expect(ctx.recentTurns.length).toBe(MAX_RECENT_TURNS);
    expect(ctx.recentTurns[0].text).toBe('turn 2');
    expect(ctx.recentTurns[2].text).toBe('turn 4');
  });

  it('truncates long messages', () => {
    const ctx = appendTurn(emptyCtx(), 'bot', 'x'.repeat(500));
    expect(ctx.recentTurns[0].text.length).toBeLessThanOrEqual(300);
    expect(ctx.recentTurns[0].text).toMatch(/\.\.\.$/);
  });
});

describe('mentioned-entity management', () => {
  it('setMentionedEntities updates list + topic', () => {
    const e = entityFromInvoice(1, { id: 'i1', number: 'INV-2026-005' });
    const ctx = setMentionedEntities(emptyCtx(), [e], 'review_queue');
    expect(ctx.mentionedEntities.length).toBe(1);
    expect(ctx.lastBotTopic).toBe('review_queue');
  });

  it('clearMentionedEntities drops them but preserves topic', () => {
    let ctx = setMentionedEntities(emptyCtx(), [
      entityFromInvoice(1, { id: 'i1', number: 'INV-2026-001' }),
    ], 'invoices');
    ctx = clearMentionedEntities(ctx);
    expect(ctx.mentionedEntities.length).toBe(0);
    expect(ctx.lastBotTopic).toBe('invoices');
  });

  it('setPendingSlots writes the pending object', () => {
    const ctx = setPendingSlots(emptyCtx(), {
      intent: 'create_invoice_from_chat',
      filled: { clientNameHint: 'Beta' },
      awaiting: 'amountCents',
      question: 'How much?',
      askedAt: new Date().toISOString(),
    });
    expect(ctx.pendingSlots?.awaiting).toBe('amountCents');
  });
});

describe('resolveReference', () => {
  const entities = [
    entityFromInvoice(1, { id: 'a', number: 'INV-2026-001', client: { name: 'Acme Corp' } }),
    entityFromInvoice(2, { id: 'b', number: 'INV-2026-005', client: { name: 'Beta Inc' } }),
    entityFromInvoice(3, { id: 'c', number: 'INV-2026-009', client: { name: 'Gamma LLC' } }),
  ];

  it('returns none on empty input', () => {
    expect(resolveReference('', entities).kind).toBe('none');
    expect(resolveReference('hello', []).kind).toBe('none');
  });

  it('resolves "1" / "first" / "1st"', () => {
    expect((resolveReference('1', entities) as { kind: 'single'; entity: { id: string } }).entity.id).toBe('a');
    expect((resolveReference('first', entities) as { kind: 'single'; entity: { id: string } }).entity.id).toBe('a');
    expect((resolveReference('the 1st one', entities) as { kind: 'single'; entity: { id: string } }).entity.id).toBe('a');
  });

  it('resolves "second" / "#2"', () => {
    expect((resolveReference('second', entities) as { kind: 'single'; entity: { id: string } }).entity.id).toBe('b');
    expect((resolveReference('#2', entities) as { kind: 'single'; entity: { id: string } }).entity.id).toBe('b');
  });

  it('resolves "last" → final entity', () => {
    expect((resolveReference('last', entities) as { kind: 'single'; entity: { id: string } }).entity.id).toBe('c');
  });

  it('resolves shortCode "INV-001"', () => {
    expect((resolveReference('INV-001', entities) as { kind: 'single'; entity: { id: string } }).entity.id).toBe('a');
  });

  it('resolves exact long number "INV-2026-005"', () => {
    expect((resolveReference('INV-2026-005', entities) as { kind: 'single'; entity: { id: string } }).entity.id).toBe('b');
  });

  it('resolves single label substring "Acme"', () => {
    expect((resolveReference('Acme', entities) as { kind: 'single'; entity: { id: string } }).entity.id).toBe('a');
  });

  it('returns multiple on ambiguous substring', () => {
    const inv = [
      entityFromInvoice(1, { id: 'a', number: 'INV-2026-001', client: { name: 'Acme Corp' } }),
      entityFromInvoice(2, { id: 'b', number: 'INV-2026-005', client: { name: 'Acme Holdings' } }),
    ];
    const out = resolveReference('Acme', inv);
    expect(out.kind).toBe('multiple');
    if (out.kind === 'multiple') expect(out.entities.length).toBe(2);
  });

  it('resolves "all of them"', () => {
    expect((resolveReference('all of them', entities) as ReferenceResolution).kind).toBe('all');
    expect((resolveReference('all', entities) as ReferenceResolution).kind).toBe('all');
  });

  it('single-entity affirmative short-circuit', () => {
    const one = [entities[0]];
    expect((resolveReference('yes', one) as { kind: 'single'; entity: { id: string } }).entity.id).toBe('a');
    expect((resolveReference('ok', one) as { kind: 'single'; entity: { id: string } }).entity.id).toBe('a');
    expect(resolveReference('yes', entities).kind).toBe('none'); // ambiguous when multiple
  });

  it('out-of-range numeric returns none', () => {
    expect(resolveReference('5', entities).kind).toBe('none');
  });

  it('does not match on 2-char tokens (would over-match)', () => {
    expect(resolveReference('an', entities).kind).toBe('none');
  });

  it('expense entities resolve by vendor', () => {
    const exps = [
      entityFromExpense(1, { id: 'e1', vendorName: 'Shell', amountCents: 4500 }),
      entityFromExpense(2, { id: 'e2', description: 'AWS October bill', amountCents: 12000 }),
    ];
    expect((resolveReference('Shell', exps) as { kind: 'single'; entity: { id: string } }).entity.id).toBe('e1');
    expect((resolveReference('aws', exps) as { kind: 'single'; entity: { id: string } }).entity.id).toBe('e2');
  });
});

describe('evaluateSlots', () => {
  it('returns complete when all filled', () => {
    const out = evaluateSlots('create_invoice_from_chat', { clientNameHint: 'Beta', amountCents: 500000 });
    expect(out.complete).toBe(true);
    expect(out.awaiting).toBeNull();
    expect(out.missing).toEqual([]);
  });

  it('flags missing amount', () => {
    const out = evaluateSlots('create_invoice_from_chat', { clientNameHint: 'Beta' });
    expect(out.complete).toBe(false);
    expect(out.awaiting?.key).toBe('amountCents');
    expect(out.missing).toEqual(['amountCents']);
  });

  it('flags missing client first', () => {
    const out = evaluateSlots('create_invoice_from_chat', {});
    expect(out.awaiting?.key).toBe('clientNameHint');
    expect(out.missing).toEqual(['clientNameHint', 'amountCents']);
  });

  it('rejects invalid amount via validator', () => {
    const out = evaluateSlots('create_invoice_from_chat', { clientNameHint: 'Beta', amountCents: 0 });
    expect(out.complete).toBe(false);
    expect(out.missing).toContain('amountCents');
  });

  it('preserves optional hints', () => {
    const out = evaluateSlots('create_invoice_from_chat', {
      clientNameHint: 'Beta', amountCents: 500000, description: 'website',
    });
    expect(out.filled.description).toBe('website');
  });

  it('estimate requires 3 slots', () => {
    const out = evaluateSlots('create_estimate', { clientNameHint: 'Beta' });
    expect(out.missing).toEqual(['amountCents', 'description']);
  });

  it('per-diem validates day range', () => {
    expect(evaluateSlots('record_per_diem', { cityHint: 'NYC', days: 50 }).complete).toBe(false);
    expect(evaluateSlots('record_per_diem', { cityHint: 'NYC', days: 3 }).complete).toBe(true);
  });

  it('unknown intent is treated as complete (no-op fallthrough)', () => {
    expect(evaluateSlots('some_unknown_intent', {}).complete).toBe(true);
  });
});

describe('mergeSlots', () => {
  it('later turn wins per field', () => {
    const merged = mergeSlots(
      { clientNameHint: 'Beta', amountCents: 500000 },
      { amountCents: 300000 },
    );
    expect(merged.clientNameHint).toBe('Beta');
    expect(merged.amountCents).toBe(300000);
  });

  it('null / empty later values do not overwrite', () => {
    const merged = mergeSlots(
      { clientNameHint: 'Beta', amountCents: 500000 },
      { clientNameHint: null, amountCents: '' },
    );
    expect(merged.clientNameHint).toBe('Beta');
    expect(merged.amountCents).toBe(500000);
  });
});
