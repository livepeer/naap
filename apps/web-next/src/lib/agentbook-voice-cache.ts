/**
 * Voice-transcript cache helper (PR 19).
 *
 * Telegram delivers a stable `file_id` for every voice note, so when
 * the same note is processed more than once (replay, retries, accidental
 * double-submit) we can skip the Gemini audio bill. This module owns
 * the cache read/write/prune contract:
 *
 *   - getOrTranscribeVoice — lookup → transcribe-and-cache fallback.
 *   - pruneVoiceTranscripts — daily housekeeping (drops rows >30d).
 *
 * Cross-tenant cache hits are impossible by design: the unique key on
 * `AbVoiceTranscript` is `(tenantId, fileId)`, and every read/write
 * here threads the tenantId through.
 *
 * Cache writes are best-effort: if the upsert throws (db hiccup), we
 * still return the live transcript so the user gets their reply. We
 * never cache a null/empty transcript — those represent failures the
 * user might retry, and pinning the failure would make retries useless.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface VoiceCacheLookup {
  /** Tenant the voice note belongs to (cache scope). */
  tenantId: string;
  /** Telegram `file_id` — unique-per-file across the bot. */
  fileId: string;
  /** The Gemini model used to transcribe — recorded so future
   *  invalidations (e.g. moving to a higher-quality model) can be
   *  surgical instead of nuking everything. */
  model: string;
  /** Performs the actual transcription on a cache miss. Returns the
   *  verbatim text or null if the call failed. */
  transcribe: () => Promise<string | null>;
}

export interface VoiceCacheResult {
  /** The transcript, or null if both cache and transcriber returned nothing. */
  transcript: string | null;
  /** True if served from cache (no Gemini bill). */
  cached: boolean;
}

/**
 * Look up a transcript in the cache; on miss, run the supplied
 * transcriber and write the result back. Tenant-scoped.
 */
export async function getOrTranscribeVoice(
  input: VoiceCacheLookup,
): Promise<VoiceCacheResult> {
  const { tenantId, fileId, model, transcribe } = input;

  // 1. Cache lookup — tenant-scoped via the composite unique key.
  try {
    const hit = await db.abVoiceTranscript.findUnique({
      where: { tenantId_fileId: { tenantId, fileId } },
    });
    if (hit && hit.transcript) {
      return { transcript: hit.transcript, cached: true };
    }
  } catch (err) {
    // Cache read failure shouldn't block transcription — fall through
    // and call Gemini.
    console.warn('[voice-cache] findUnique failed:', err);
  }

  // 2. Cache miss — call the live transcriber.
  const transcript = await transcribe();
  if (!transcript) {
    // Don't cache failures — the user might retry and we want them
    // to actually exercise Gemini again.
    return { transcript: null, cached: false };
  }

  // 3. Write-through. Best-effort: on DB error, return the live text
  // anyway so the user still gets their reply.
  try {
    await db.abVoiceTranscript.upsert({
      where: { tenantId_fileId: { tenantId, fileId } },
      create: { tenantId, fileId, transcript, model },
      update: { transcript, model },
    });
  } catch (err) {
    console.warn('[voice-cache] upsert failed:', err);
  }

  return { transcript, cached: false };
}

export interface PruneOptions {
  /** Retain rows newer than this many days. Defaults to 30. */
  olderThanDays?: number;
}

export interface PruneResult {
  deleted: number;
}

/**
 * Daily housekeeping — drop rows older than `olderThanDays` (default
 * 30). Called from the `/agentbook/cron/voice-cache-prune` endpoint.
 */
export async function pruneVoiceTranscripts(
  opts: PruneOptions = {},
): Promise<PruneResult> {
  const days = opts.olderThanDays ?? 30;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const res = await db.abVoiceTranscript.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deleted: res.count };
}
