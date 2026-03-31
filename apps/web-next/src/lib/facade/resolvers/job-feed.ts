/**
 * Job feed resolver — NAAP API backed.
 *
 * Fetches GET /v1/streams/samples and maps the most-recent sample per
 * StreamID to a JobFeedItem. Samples are health snapshots emitted by
 * active streams every ~10 s; this endpoint returns the latest batch.
 *
 * Source:
 *   GET /v1/streams/samples → per-stream health snapshots
 */

import type { JobFeedItem } from '../types.js';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch } from '../cache.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NaapStreamSample {
  SampleTS: string;
  Org: string;
  StreamID: string;
  Gateway: string;
  OrchAddress: string;
  Pipeline: string;
  State: string;
  OutputFPS: number;
  InputFPS: number;
  E2ELatencyMS: number;
  IsAttributed: boolean;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolveJobFeed(opts: { limit?: number }): Promise<JobFeedItem[]> {
  return cachedFetch('facade:job-feed', 15 * 1000, async () => {
    const limit = opts.limit ?? 200;
    const url = new URL(naapApiUpstreamUrl('streams/samples'));
    url.searchParams.set('limit', String(limit));

    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`[facade/job-feed] /streams/samples returned HTTP ${res.status}`);

    const rows = (await res.json()) as NaapStreamSample[];

    // Deduplicate by StreamID — keep the most recent sample per stream.
    const byStream = new Map<string, NaapStreamSample>();
    for (const row of rows) {
      const existing = byStream.get(row.StreamID);
      if (!existing || row.SampleTS > existing.SampleTS) {
        byStream.set(row.StreamID, row);
      }
    }

    return Array.from(byStream.values())
      .sort((a, b) => b.SampleTS.localeCompare(a.SampleTS))
      .map((row): JobFeedItem => ({
        id: row.StreamID,
        pipeline: row.Pipeline,
        gateway: row.Gateway,
        orchestratorUrl: row.OrchAddress,
        state: row.State,
        inputFps: row.InputFPS,
        outputFps: row.OutputFPS,
        firstSeen: row.SampleTS,
        lastSeen: row.SampleTS,
      }));
  });
}
