import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();

vi.mock('@naap/database', () => ({
  prisma: {
    abConvThread: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      create: (...args: unknown[]) => create(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

import {
  openThread,
  addTurn,
  attachEntity,
  detachEntity,
  setFocus,
  setPendingSlots,
  setTopic,
  closeThread,
  getFocus,
  KEEP_TURNS,
  type ConvThread,
  type ThreadEntity,
} from './agentbook-thread';

function baseRow(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 't1', tenantId: 'tenant-1', channel: 'telegram', chatId: '555',
    status: 'active', startedAt: now, lastActiveAt: now,
    closedAt: null, closeReason: null,
    activeEntities: [], focusedEntityId: null,
    pendingSlots: null, parkedFills: [],
    topic: null, subtopic: null,
    turns: [], turnCount: 0, summary: null,
    ...overrides,
  };
}

beforeEach(() => {
  findFirst.mockReset();
  create.mockReset();
  update.mockReset();
});

describe('openThread', () => {
  it('returns existing active thread', async () => {
    findFirst.mockResolvedValue(baseRow({ id: 'existing' }));
    const t = await openThread('tenant-1', 'telegram', '555');
    expect(t.id).toBe('existing');
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a fresh thread when none active', async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue(baseRow({ id: 'new' }));
    const t = await openThread('tenant-1', 'telegram', '555');
    expect(t.id).toBe('new');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('coerces numeric chatId to string', async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue(baseRow({ id: 'new', chatId: '555' }));
    await openThread('tenant-1', 'telegram', 555);
    expect(create.mock.calls[0][0].data.chatId).toBe('555');
  });

  it('returns ephemeral thread on DB error (never throws)', async () => {
    findFirst.mockRejectedValue(new Error('db down'));
    const t = await openThread('tenant-1', 'telegram', '555');
    expect(t.id).toBe('ephemeral');
    expect(t.status).toBe('active');
  });
});

describe('addTurn', () => {
  it('appends and caps at KEEP_TURNS', async () => {
    update.mockResolvedValue({});
    let t: ConvThread = {
      id: 't1', tenantId: 'tenant-1', channel: 'telegram', chatId: '555',
      status: 'active', startedAt: new Date(), lastActiveAt: new Date(),
      closedAt: null, closeReason: null, activeEntities: [], focusedEntityId: null,
      pendingSlots: null, parkedFills: [], topic: null, subtopic: null,
      turns: [], turnCount: 0, summary: null,
    };
    for (let i = 0; i < KEEP_TURNS + 3; i++) {
      t = await addTurn(t, i % 2 === 0 ? 'user' : 'bot', `turn ${i}`);
    }
    expect(t.turns.length).toBe(KEEP_TURNS);
    expect(t.turnCount).toBe(KEEP_TURNS + 3);
    expect(t.turns[0].text).toBe('turn 3'); // first 3 dropped
  });

  it('truncates long text', async () => {
    update.mockResolvedValue({});
    const t: ConvThread = {
      id: 't1', tenantId: 'tenant-1', channel: 'telegram', chatId: '555',
      status: 'active', startedAt: new Date(), lastActiveAt: new Date(),
      closedAt: null, closeReason: null, activeEntities: [], focusedEntityId: null,
      pendingSlots: null, parkedFills: [], topic: null, subtopic: null,
      turns: [], turnCount: 0, summary: null,
    };
    const r = await addTurn(t, 'bot', 'x'.repeat(500));
    expect(r.turns[0].text.length).toBeLessThanOrEqual(300);
    expect(r.turns[0].text).toMatch(/\.\.\.$/);
  });

  it('persists ephemeral threads as a no-op (no crash)', async () => {
    const eph: ConvThread = {
      id: 'ephemeral', tenantId: 'tenant-1', channel: 'telegram', chatId: '555',
      status: 'active', startedAt: new Date(), lastActiveAt: new Date(),
      closedAt: null, closeReason: null, activeEntities: [], focusedEntityId: null,
      pendingSlots: null, parkedFills: [], topic: null, subtopic: null,
      turns: [], turnCount: 0, summary: null,
    };
    const r = await addTurn(eph, 'user', 'hi');
    expect(r.turnCount).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('attachEntity / detachEntity', () => {
  function freshThread(): ConvThread {
    return {
      id: 't1', tenantId: 'tenant-1', channel: 'telegram', chatId: '555',
      status: 'active', startedAt: new Date(), lastActiveAt: new Date(),
      closedAt: null, closeReason: null, activeEntities: [], focusedEntityId: null,
      pendingSlots: null, parkedFills: [], topic: null, subtopic: null,
      turns: [], turnCount: 0, summary: null,
    };
  }

  it('attaches a new entity', async () => {
    update.mockResolvedValue({});
    const r = await attachEntity(freshThread(), { kind: 'invoice', id: 'i1', label: 'Acme · INV-001' });
    expect(r.activeEntities.length).toBe(1);
    expect(r.activeEntities[0].id).toBe('i1');
    expect(r.activeEntities[0].addedAt).toBeTruthy();
  });

  it('is idempotent — same (kind,id) does not duplicate', async () => {
    update.mockResolvedValue({});
    let t = await attachEntity(freshThread(), { kind: 'invoice', id: 'i1', label: 'A' });
    t = await attachEntity(t, { kind: 'invoice', id: 'i1', label: 'A' });
    expect(t.activeEntities.length).toBe(1);
  });

  it('different kinds with same id coexist', async () => {
    update.mockResolvedValue({});
    let t = await attachEntity(freshThread(), { kind: 'invoice', id: 'i1', label: 'A' });
    t = await attachEntity(t, { kind: 'expense', id: 'i1', label: 'B' });
    expect(t.activeEntities.length).toBe(2);
  });

  it('detach removes entity and clears focus if it pointed there', async () => {
    update.mockResolvedValue({});
    let t = await attachEntity(freshThread(), { kind: 'invoice', id: 'i1', label: 'A' });
    t = await setFocus(t, { kind: 'invoice', id: 'i1', label: 'A' });
    t = await detachEntity(t, 'i1');
    expect(t.activeEntities.length).toBe(0);
    expect(t.focusedEntityId).toBeNull();
  });
});

describe('setFocus', () => {
  function freshThread(): ConvThread {
    return {
      id: 't1', tenantId: 'tenant-1', channel: 'telegram', chatId: '555',
      status: 'active', startedAt: new Date(), lastActiveAt: new Date(),
      closedAt: null, closeReason: null, activeEntities: [], focusedEntityId: null,
      pendingSlots: null, parkedFills: [], topic: null, subtopic: null,
      turns: [], turnCount: 0, summary: null,
    };
  }

  it('attaches and focuses an unknown entity in one call', async () => {
    update.mockResolvedValue({});
    const r = await setFocus(freshThread(), { kind: 'invoice', id: 'i1', label: 'A' });
    expect(r.activeEntities.length).toBe(1);
    expect(r.focusedEntityId).toBe('i1');
  });

  it('null clears focus', async () => {
    update.mockResolvedValue({});
    let t = await setFocus(freshThread(), { kind: 'invoice', id: 'i1', label: 'A' });
    t = await setFocus(t, null);
    expect(t.focusedEntityId).toBeNull();
  });
});

describe('getFocus', () => {
  function freshThread(): ConvThread {
    return {
      id: 't1', tenantId: 'tenant-1', channel: 'telegram', chatId: '555',
      status: 'active', startedAt: new Date(), lastActiveAt: new Date(),
      closedAt: null, closeReason: null, activeEntities: [], focusedEntityId: null,
      pendingSlots: null, parkedFills: [], topic: null, subtopic: null,
      turns: [], turnCount: 0, summary: null,
    };
  }

  it('returns explicit focused entity', async () => {
    update.mockResolvedValue({});
    let t = await attachEntity(freshThread(), { kind: 'invoice', id: 'i1', label: 'A' });
    t = await attachEntity(t, { kind: 'expense', id: 'e1', label: 'B' });
    t = await setFocus(t, { kind: 'invoice', id: 'i1', label: 'A' });
    const focused = getFocus(t);
    expect(focused?.id).toBe('i1');
  });

  it('falls back to last-attached when no explicit focus', async () => {
    update.mockResolvedValue({});
    let t = await attachEntity(freshThread(), { kind: 'invoice', id: 'i1', label: 'A' });
    t = await attachEntity(t, { kind: 'expense', id: 'e1', label: 'B' });
    const focused = getFocus(t);
    expect(focused?.id).toBe('e1'); // last-attached
  });

  it('returns null on empty working set', () => {
    expect(getFocus(freshThread())).toBeNull();
  });
});

describe('setPendingSlots + setTopic', () => {
  function freshThread(): ConvThread {
    return {
      id: 't1', tenantId: 'tenant-1', channel: 'telegram', chatId: '555',
      status: 'active', startedAt: new Date(), lastActiveAt: new Date(),
      closedAt: null, closeReason: null, activeEntities: [], focusedEntityId: null,
      pendingSlots: null, parkedFills: [], topic: null, subtopic: null,
      turns: [], turnCount: 0, summary: null,
    };
  }

  it('persists pending slots', async () => {
    update.mockResolvedValue({});
    const r = await setPendingSlots(freshThread(), {
      intent: 'create_invoice_from_chat',
      filled: { clientNameHint: 'Beta' },
      awaiting: 'amountCents',
      question: 'How much?',
      askedAt: new Date().toISOString(),
    });
    expect(r.pendingSlots?.awaiting).toBe('amountCents');
  });

  it('setTopic preserves subtopic when not passed', async () => {
    update.mockResolvedValue({});
    let t = await setTopic(freshThread(), 'expense_management', 'review_queue');
    t = await setTopic(t, 'expense_management'); // only top-level
    expect(t.subtopic).toBe('review_queue');
  });
});

describe('closeThread', () => {
  function freshThread(status: 'active' | 'closed' = 'active'): ConvThread {
    return {
      id: 't1', tenantId: 'tenant-1', channel: 'telegram', chatId: '555',
      status, startedAt: new Date(), lastActiveAt: new Date(),
      closedAt: null, closeReason: null, activeEntities: [], focusedEntityId: null,
      pendingSlots: null, parkedFills: [], topic: null, subtopic: null,
      turns: [], turnCount: 0, summary: null,
    };
  }

  it('marks active thread closed with reason', async () => {
    update.mockResolvedValue({});
    await closeThread(freshThread(), 'idle_timeout');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.status).toBe('closed');
    expect(update.mock.calls[0][0].data.closeReason).toBe('idle_timeout');
  });

  it('no-ops on already-closed threads (idempotent)', async () => {
    await closeThread(freshThread('closed'), 'idle_timeout');
    expect(update).not.toHaveBeenCalled();
  });

  it('swallows DB errors silently', async () => {
    update.mockRejectedValue(new Error('db down'));
    await expect(closeThread(freshThread(), 'explicit')).resolves.toBeUndefined();
  });
});

describe('shape sanity', () => {
  it('a ThreadEntity has the required shape', () => {
    const e: ThreadEntity = { kind: 'invoice', id: 'i1', label: 'A', addedAt: new Date().toISOString() };
    expect(e.kind).toBe('invoice');
  });
});
