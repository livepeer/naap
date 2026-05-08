/**
 * Tests for the dead-letter replay helper (PR 23).
 *
 * Pins behaviour for the two entry points:
 *   - `replayDeadLetter`     — single-row replay; resolves on HTTP 200,
 *                              bumps attempts on failure, records the
 *                              latest error message.
 *   - `replayOpenDeadLetters` — batch sweep used by the daily cron.
 *
 * The Prisma client and global `fetch` are mocked at the module
 * boundary so this is a pure unit test.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@naap/database', () => ({
  prisma: {
    abWebhookDeadLetter: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma as db } from '@naap/database';
import {
  replayDeadLetter,
  replayOpenDeadLetters,
} from './agentbook-dead-letter';

const mockedDb = db as unknown as {
  abWebhookDeadLetter: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  mockedDb.abWebhookDeadLetter.findFirst.mockReset();
  mockedDb.abWebhookDeadLetter.findMany.mockReset();
  mockedDb.abWebhookDeadLetter.update.mockReset();
  (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
});

const ROW_ID = 'dl-1';
const PAYLOAD = { update_id: 42, message: { text: 'hi' } };

describe('replayDeadLetter', () => {
  it('resolves the row when the webhook returns 2xx', async () => {
    mockedDb.abWebhookDeadLetter.findFirst.mockResolvedValue({
      id: ROW_ID,
      tenantId: 'T1',
      payload: PAYLOAD,
      error: 'old error',
      attempts: 3,
      resolvedAt: null,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    } as Response);
    mockedDb.abWebhookDeadLetter.update.mockResolvedValue({});

    const r = await replayDeadLetter(ROW_ID, {
      webhookUrl: 'http://localhost:3000/api/v1/agentbook/telegram/webhook',
    });

    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    const updateArgs = mockedDb.abWebhookDeadLetter.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: ROW_ID });
    expect(updateArgs.data.resolvedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.attempts).toBe(4);
  });

  it('returns ok:false and bumps attempts on a non-2xx response', async () => {
    mockedDb.abWebhookDeadLetter.findFirst.mockResolvedValue({
      id: ROW_ID,
      tenantId: 'T1',
      payload: PAYLOAD,
      error: 'old',
      attempts: 3,
      resolvedAt: null,
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'still broken',
    } as Response);

    const r = await replayDeadLetter(ROW_ID, {
      webhookUrl: 'http://localhost/webhook',
    });

    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
    expect(r.error).toMatch(/HTTP 503/);
    const updateArgs = mockedDb.abWebhookDeadLetter.update.mock.calls[0][0];
    expect(updateArgs.data.resolvedAt).toBeUndefined();
    expect(updateArgs.data.attempts).toBe(4);
    expect(updateArgs.data.error).toMatch(/HTTP 503/);
  });

  it('returns not-found when the row is gone or already resolved', async () => {
    mockedDb.abWebhookDeadLetter.findFirst.mockResolvedValue(null);

    const r = await replayDeadLetter('missing', {
      webhookUrl: 'http://localhost/webhook',
    });

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedDb.abWebhookDeadLetter.update).not.toHaveBeenCalled();
  });

  it('scopes lookup by tenantId when provided', async () => {
    mockedDb.abWebhookDeadLetter.findFirst.mockResolvedValue(null);

    await replayDeadLetter(ROW_ID, {
      webhookUrl: 'http://localhost/webhook',
      tenantId: 'T1',
    });

    const findArgs = mockedDb.abWebhookDeadLetter.findFirst.mock.calls[0][0];
    expect(findArgs.where.id).toBe(ROW_ID);
    expect(findArgs.where.tenantId).toBe('T1');
    expect(findArgs.where.resolvedAt).toBeNull();
  });
});

describe('replayOpenDeadLetters', () => {
  it('walks every open row and aggregates results', async () => {
    mockedDb.abWebhookDeadLetter.findMany.mockResolvedValue([
      { id: 'a', tenantId: 'T1', payload: PAYLOAD, error: '', attempts: 1, resolvedAt: null },
      { id: 'b', tenantId: null, payload: PAYLOAD, error: '', attempts: 1, resolvedAt: null },
    ]);
    // findFirst is called once per row by replayDeadLetter.
    mockedDb.abWebhookDeadLetter.findFirst
      .mockResolvedValueOnce({ id: 'a', tenantId: 'T1', payload: PAYLOAD, error: '', attempts: 1, resolvedAt: null })
      .mockResolvedValueOnce({ id: 'b', tenantId: null, payload: PAYLOAD, error: '', attempts: 1, resolvedAt: null });
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' } as Response);
    mockedDb.abWebhookDeadLetter.update.mockResolvedValue({});

    const r = await replayOpenDeadLetters({
      webhookUrl: 'http://localhost/webhook',
    });

    expect(r.total).toBe(2);
    expect(r.resolved).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.results).toHaveLength(2);
  });

  it('honours the limit option', async () => {
    mockedDb.abWebhookDeadLetter.findMany.mockResolvedValue([]);

    await replayOpenDeadLetters({
      webhookUrl: 'http://localhost/webhook',
      limit: 5,
    });

    const args = mockedDb.abWebhookDeadLetter.findMany.mock.calls[0][0];
    expect(args.take).toBe(5);
    expect(args.where.resolvedAt).toBeNull();
  });
});
