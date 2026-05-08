/**
 * Tests for the voice-transcript cache helper (PR 19).
 *
 * The Telegram voice handler used to send every voice note through
 * Gemini, even when the same `file_id` showed up twice (replay,
 * accidental double-submit, retry after a transient network blip).
 * The cache stores transcripts keyed by `(tenantId, file_id)` so we
 * skip the Gemini audio bill on the second hit.
 *
 * These tests pin three guarantees:
 *   1. Cache miss → caller-supplied transcriber runs, result is upserted.
 *   2. Cache hit  → transcriber is NOT called; cached text returned.
 *   3. Tenant scoping — same fileId, different tenant, must NOT hit.
 *   4. A transcriber that returns null does not write a row (we don't
 *      want to cache failures and lock the user out of retries).
 *
 * Pure unit-style: the Prisma client is mocked at the module boundary.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@naap/database', () => {
  return {
    prisma: {
      abVoiceTranscript: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
    },
  };
});

import { prisma as db } from '@naap/database';
import {
  getOrTranscribeVoice,
  pruneVoiceTranscripts,
} from './agentbook-voice-cache';

const mockedDb = db as unknown as {
  abVoiceTranscript: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};

const TENANT_A = 'tenant-A';
const TENANT_B = 'tenant-B';
const FILE_ID = 'AwACAgEAAxkBAAIB';

beforeEach(() => {
  mockedDb.abVoiceTranscript.findUnique.mockReset();
  mockedDb.abVoiceTranscript.upsert.mockReset();
  mockedDb.abVoiceTranscript.deleteMany.mockReset();
});

describe('getOrTranscribeVoice — cache miss', () => {
  it('calls the transcriber and upserts the result', async () => {
    mockedDb.abVoiceTranscript.findUnique.mockResolvedValue(null);
    mockedDb.abVoiceTranscript.upsert.mockResolvedValue({});

    const transcriber = vi.fn().mockResolvedValue('hello world');

    const result = await getOrTranscribeVoice({
      tenantId: TENANT_A,
      fileId: FILE_ID,
      model: 'gemini-2.5-flash',
      transcribe: transcriber,
    });

    expect(result).toEqual({ transcript: 'hello world', cached: false });
    expect(transcriber).toHaveBeenCalledTimes(1);
    expect(mockedDb.abVoiceTranscript.upsert).toHaveBeenCalledTimes(1);
    const args = mockedDb.abVoiceTranscript.upsert.mock.calls[0][0];
    expect(args.where).toEqual({
      tenantId_fileId: { tenantId: TENANT_A, fileId: FILE_ID },
    });
    expect(args.create).toMatchObject({
      tenantId: TENANT_A,
      fileId: FILE_ID,
      transcript: 'hello world',
      model: 'gemini-2.5-flash',
    });
    expect(args.update).toMatchObject({
      transcript: 'hello world',
      model: 'gemini-2.5-flash',
    });
  });

  it('does NOT write a row when the transcriber returns null', async () => {
    mockedDb.abVoiceTranscript.findUnique.mockResolvedValue(null);
    const transcriber = vi.fn().mockResolvedValue(null);

    const result = await getOrTranscribeVoice({
      tenantId: TENANT_A,
      fileId: FILE_ID,
      model: 'gemini-2.5-flash',
      transcribe: transcriber,
    });

    expect(result).toEqual({ transcript: null, cached: false });
    expect(transcriber).toHaveBeenCalledTimes(1);
    expect(mockedDb.abVoiceTranscript.upsert).not.toHaveBeenCalled();
  });

  it('does NOT write a row when the transcriber returns an empty string', async () => {
    mockedDb.abVoiceTranscript.findUnique.mockResolvedValue(null);
    const transcriber = vi.fn().mockResolvedValue('');

    const result = await getOrTranscribeVoice({
      tenantId: TENANT_A,
      fileId: FILE_ID,
      model: 'gemini-2.5-flash',
      transcribe: transcriber,
    });

    expect(result).toEqual({ transcript: null, cached: false });
    expect(mockedDb.abVoiceTranscript.upsert).not.toHaveBeenCalled();
  });

  it('still returns the transcript if the upsert throws (cache write best-effort)', async () => {
    mockedDb.abVoiceTranscript.findUnique.mockResolvedValue(null);
    mockedDb.abVoiceTranscript.upsert.mockRejectedValue(new Error('db down'));
    const transcriber = vi.fn().mockResolvedValue('still works');

    const result = await getOrTranscribeVoice({
      tenantId: TENANT_A,
      fileId: FILE_ID,
      model: 'gemini-2.5-flash',
      transcribe: transcriber,
    });

    expect(result).toEqual({ transcript: 'still works', cached: false });
    expect(transcriber).toHaveBeenCalledTimes(1);
  });
});

describe('getOrTranscribeVoice — cache hit', () => {
  it('returns the cached transcript without calling the transcriber', async () => {
    mockedDb.abVoiceTranscript.findUnique.mockResolvedValue({
      id: 'row-1',
      tenantId: TENANT_A,
      fileId: FILE_ID,
      transcript: 'cached hello',
      model: 'gemini-2.5-flash',
      createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    const transcriber = vi.fn();

    const result = await getOrTranscribeVoice({
      tenantId: TENANT_A,
      fileId: FILE_ID,
      model: 'gemini-2.5-flash',
      transcribe: transcriber,
    });

    expect(result).toEqual({ transcript: 'cached hello', cached: true });
    expect(transcriber).not.toHaveBeenCalled();
    expect(mockedDb.abVoiceTranscript.upsert).not.toHaveBeenCalled();
  });

  it('looks up the cache scoped by tenantId — distinct tenants do NOT share a row', async () => {
    // Tenant A has the row…
    mockedDb.abVoiceTranscript.findUnique.mockImplementation(
      ({ where }: { where: { tenantId_fileId: { tenantId: string; fileId: string } } }) => {
        if (where.tenantId_fileId.tenantId === TENANT_A) {
          return Promise.resolve({
            id: 'row-A',
            tenantId: TENANT_A,
            fileId: FILE_ID,
            transcript: 'tenant-A note',
            model: 'gemini-2.5-flash',
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      },
    );
    const transcriberB = vi.fn().mockResolvedValue('tenant-B note');

    // Tenant B asks for the SAME fileId — must miss, must call transcriber.
    const r = await getOrTranscribeVoice({
      tenantId: TENANT_B,
      fileId: FILE_ID,
      model: 'gemini-2.5-flash',
      transcribe: transcriberB,
    });

    expect(r).toEqual({ transcript: 'tenant-B note', cached: false });
    expect(transcriberB).toHaveBeenCalledTimes(1);

    // Verify the query was tenant-scoped (no cross-tenant short circuit).
    const calls = mockedDb.abVoiceTranscript.findUnique.mock.calls;
    expect(calls[0][0].where.tenantId_fileId).toEqual({
      tenantId: TENANT_B,
      fileId: FILE_ID,
    });
  });
});

describe('pruneVoiceTranscripts', () => {
  it('deletes rows older than the cutoff (default 30 days) and returns the count', async () => {
    mockedDb.abVoiceTranscript.deleteMany.mockResolvedValue({ count: 7 });

    const before = Date.now();
    const r = await pruneVoiceTranscripts();
    const after = Date.now();

    expect(r).toEqual({ deleted: 7 });
    expect(mockedDb.abVoiceTranscript.deleteMany).toHaveBeenCalledTimes(1);
    const args = mockedDb.abVoiceTranscript.deleteMany.mock.calls[0][0];
    const cutoff: Date = args.where.createdAt.lt;
    // Cutoff should be roughly 30 days before "now". Allow generous slack.
    const expectedMin = before - 30 * 86_400_000 - 1000;
    const expectedMax = after - 30 * 86_400_000 + 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it('honours a custom retention window (in days)', async () => {
    mockedDb.abVoiceTranscript.deleteMany.mockResolvedValue({ count: 3 });

    const r = await pruneVoiceTranscripts({ olderThanDays: 7 });

    expect(r).toEqual({ deleted: 3 });
    const args = mockedDb.abVoiceTranscript.deleteMany.mock.calls[0][0];
    const cutoff: Date = args.where.createdAt.lt;
    const sevenDaysAgo = Date.now() - 7 * 86_400_000;
    expect(Math.abs(cutoff.getTime() - sevenDaysAgo)).toBeLessThan(2_000);
  });
});
