/**
 * Orchestrator capability discovery.
 *
 * Strategy (in priority order):
 * 1. Livepeer AI Leaderboard API — returns per-pipeline performance for
 *    orchestrators that successfully ran AI jobs.
 * 2. Port heuristic — orchestrators with serviceURI on port 8936 typically
 *    expose the AI Runner and support AI pipelines.
 * 3. Baseline — every active orchestrator with a serviceURI is assumed to
 *    support transcoding.
 *
 * The old HTTP probe approach (getBroadcasterInfo / capabilities endpoints)
 * is removed because orchestrator serviceURIs speak gRPC, not HTTP.
 */

import { prisma } from '../db/client.js';
import { cacheGetOrSet } from '@naap/cache';

export type CapabilityCategory = 'transcoding' | 'realtime_ai' | 'ai_batch' | 'agent' | 'other';

const AI_REALTIME_PIPELINES = ['video-to-video', 'live-video-to-video', 'segment-anything-2'];
const AI_BATCH_PIPELINES = [
  'text-to-image', 'image-to-image', 'image-to-video', 'text-to-video',
  'upscale', 'audio-to-text', 'text-to-speech', 'llm',
];

const LEADERBOARD_BASE = 'https://leaderboard-api.livepeer.cloud/api';

// -------------------------------------------------------------------------
// Pipeline categorisation (unchanged)
// -------------------------------------------------------------------------

interface CapabilityResult {
  category: CapabilityCategory;
  pipelineId: string | null;
}

export function categorizePipeline(pipelineId: string): CapabilityCategory {
  if (AI_REALTIME_PIPELINES.includes(pipelineId)) return 'realtime_ai';
  if (AI_BATCH_PIPELINES.includes(pipelineId)) return 'ai_batch';
  if (pipelineId.includes('agent') || pipelineId.includes('tool')) return 'agent';
  return 'other';
}

// -------------------------------------------------------------------------
// Leaderboard API — discover which orchestrators support which AI pipelines
// -------------------------------------------------------------------------

interface PipelineInfo {
  id: string;
  models: string[];
}

/**
 * Fetch the leaderboard across all pipeline/model combos and build
 * address → pipelines map.  Cached for 1 hour.
 *
 * The API works as:
 *   GET /api/pipelines → { pipelines: [{ id, models, regions }] }
 *   GET /api/aggregated_stats?pipeline=X&model=Y → { "0xaddr": { region: { success_rate, ... } } }
 */
export async function fetchLeaderboardCapabilities(): Promise<
  Map<string, string[]>
> {
  return cacheGetOrSet(
    'leaderboard-capabilities',
    async () => {
      const map = new Map<string, string[]>();

      try {
        // 1. Discover available pipelines and models
        const pipelinesRes = await fetchWithTimeout(`${LEADERBOARD_BASE}/pipelines`, 10000);
        if (!pipelinesRes.ok) {
          console.warn(`[capabilityService] Leaderboard pipelines API returned ${pipelinesRes.status}`);
          return map;
        }
        const { pipelines } = await pipelinesRes.json() as { pipelines: PipelineInfo[] };
        if (!pipelines?.length) return map;

        console.log(`[capabilityService] Leaderboard has ${pipelines.length} pipelines: ${pipelines.map(p => p.id).join(', ')}`);

        // 2. Query each pipeline/model combo for orchestrator performance
        for (const pipeline of pipelines) {
          const model = pipeline.models?.[0];
          if (!model) continue;

          try {
            const statsRes = await fetchWithTimeout(
              `${LEADERBOARD_BASE}/aggregated_stats?pipeline=${encodeURIComponent(pipeline.id)}&model=${encodeURIComponent(model)}`,
              10000,
            );
            if (!statsRes.ok) continue;

            const stats = await statsRes.json() as Record<string, Record<string, { success_rate: number }>>;

            for (const [addr, regions] of Object.entries(stats)) {
              const hasSuccess = Object.values(regions).some(r => r.success_rate > 0);
              if (!hasSuccess) continue;

              const lower = addr.toLowerCase();
              if (!map.has(lower)) map.set(lower, []);
              const list = map.get(lower)!;
              if (!list.includes(pipeline.id)) {
                list.push(pipeline.id);
              }
            }
          } catch {
            // Skip individual pipeline failures
          }
        }

        console.log(`[capabilityService] Leaderboard: ${map.size} orchestrators with AI capabilities`);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn('[capabilityService] Leaderboard fetch failed:', err.message);
        }
      }

      return map;
    },
    { ttl: 3600, prefix: 'wallet' },
  );
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// -------------------------------------------------------------------------
// Capability discovery for a single orchestrator
// -------------------------------------------------------------------------

/**
 * Determine capabilities for a single orchestrator.
 * Uses leaderboard data (if available) + port heuristic.
 */
export async function probeCapabilities(
  serviceURI: string,
  address?: string,
  leaderboardMap?: Map<string, string[]>,
): Promise<CapabilityResult[]> {
  const results: CapabilityResult[] = [];

  // Every active orchestrator has transcoding
  results.push({ category: 'transcoding', pipelineId: null });

  const addr = address?.toLowerCase();

  // 1. Check leaderboard for verified AI pipelines
  if (addr && leaderboardMap) {
    const pipelines = leaderboardMap.get(addr);
    if (pipelines) {
      for (const pipelineId of pipelines) {
        const category = categorizePipeline(pipelineId);
        results.push({ category, pipelineId });
      }
    }
  }

  // 2. Port heuristic — port 8936 is the conventional AI Runner port
  if (results.length === 1 && serviceURI) {
    try {
      const url = new URL(serviceURI);
      if (url.port === '8936') {
        results.push({ category: 'ai_batch', pipelineId: 'ai-runner-inferred' });
      }
    } catch {
      // Invalid serviceURI — skip heuristic
    }
  }

  return results;
}

// -------------------------------------------------------------------------
// Sync capabilities for a single orchestrator into DB
// -------------------------------------------------------------------------

export async function syncCapabilitiesForOrchestrator(
  orchestratorId: string,
  address: string,
  serviceURI: string,
  leaderboardMap?: Map<string, string[]>,
): Promise<void> {
  const capabilities = await probeCapabilities(serviceURI, address, leaderboardMap);

  for (const cap of capabilities) {
    try {
      await prisma.walletOrchestratorCapability.upsert({
        where: {
          address_category_pipelineId: {
            address: address.toLowerCase(),
            category: cap.category,
            pipelineId: cap.pipelineId ?? '',
          },
        },
        update: {
          serviceURI,
          lastChecked: new Date(),
        },
        create: {
          orchestratorId,
          address: address.toLowerCase(),
          category: cap.category,
          pipelineId: cap.pipelineId,
          serviceURI,
        },
      });
    } catch (err: any) {
      if (err.code !== 'P2002') {
        console.warn(`[capabilityService] Error for ${address}:`, err.message);
      }
    }
  }
}

// -------------------------------------------------------------------------
// Retrieve all capabilities (read path — unchanged)
// -------------------------------------------------------------------------

export async function getCapabilitiesByAddress(): Promise<
  Record<string, { categories: string[]; pipelines: string[]; lastChecked: string }>
> {
  const caps = await prisma.walletOrchestratorCapability.findMany({
    orderBy: { lastChecked: 'desc' },
  });

  const result: Record<string, { categories: string[]; pipelines: string[]; lastChecked: string }> = {};

  for (const cap of caps) {
    if (!result[cap.address]) {
      result[cap.address] = { categories: [], pipelines: [], lastChecked: cap.lastChecked.toISOString() };
    }
    if (!result[cap.address].categories.includes(cap.category)) {
      result[cap.address].categories.push(cap.category);
    }
    if (cap.pipelineId && !result[cap.address].pipelines.includes(cap.pipelineId)) {
      result[cap.address].pipelines.push(cap.pipelineId);
    }
  }

  return result;
}
