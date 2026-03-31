/**
 * Shared raw data layer — two master NAAP API endpoints fetched once and
 * cached in memory. Multiple resolvers read from these caches instead of
 * making independent HTTP calls for the same data.
 *
 * Sources:
 *   GET /v1/net/models?limit=200                           → NetworkModel[]
 *   GET /v1/net/orchestrators?active_only=false&limit=200  → NaapOrchestrator[]
 */

import type { NetworkModel } from './types.js';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch, TTL } from './cache.js';

// ---------------------------------------------------------------------------
// Raw NAAP API types — Orchestrators
// ---------------------------------------------------------------------------

export interface NaapGPUInfo {
  id: string;
  name: string;
  major: number;
  memory_free: number;
  memory_total: number;
}

export interface NaapHardwareEntry {
  pipeline: string;
  model_id: string;
  gpu_info: Record<string, NaapGPUInfo>;
}

interface NaapParsedCapabilities {
  hardware?: NaapHardwareEntry[];
}

export interface NaapOrchestrator {
  Address: string;
  Org: string;
  Name: string;
  URI: string;
  Version: string;
  LastSeen: string;
  IsActive: boolean;
  RawCapabilities: string;
  /** Parsed from RawCapabilities — always present after getRawOrchestrators() resolves. */
  capabilities: NaapParsedCapabilities;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function naapGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(naapApiUpstreamUrl(path));
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/network-data] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Shared data fetchers
// ---------------------------------------------------------------------------

/**
 * All pipeline/model rows from /v1/net/models.
 * Shared by network-models, pipeline-catalog, and pricing resolvers.
 * Callers coalesce onto a single in-flight request within the TTL window.
 */
export function getRawNetModels(): Promise<NetworkModel[]> {
  return cachedFetch('facade:raw:net-models', TTL.NET_MODELS * 1000, () =>
    naapGet<NetworkModel[]>('net/models', { limit: '200' })
  );
}

/**
 * All orchestrators from /v1/net/orchestrators with RawCapabilities JSON parsed
 * into the `.capabilities` field. Shared by gpu-capacity and any future resolver
 * needing per-orchestrator hardware inventory.
 */
export function getRawOrchestrators(): Promise<NaapOrchestrator[]> {
  return cachedFetch('facade:raw:orchestrators', TTL.NET_ORCHESTRATORS * 1000, async () => {
    const rows = await naapGet<Array<Omit<NaapOrchestrator, 'capabilities'>>>(
      'net/orchestrators',
      { active_only: 'false', limit: '200' }
    );
    return rows.map((row) => {
      let capabilities: NaapParsedCapabilities = {};
      try {
        capabilities = JSON.parse(row.RawCapabilities) as NaapParsedCapabilities;
      } catch {
        // malformed JSON — treat as no hardware info
      }
      return { ...row, capabilities };
    });
  });
}

/**
 * Pre-warm both network data caches. Called from instrumentation.ts on startup
 * so the first real request is never cold.
 */
export async function warmNetworkData(): Promise<{ models: number; orchestrators: number }> {
  const [models, orchs] = await Promise.all([getRawNetModels(), getRawOrchestrators()]);
  return { models: models.length, orchestrators: orchs.length };
}
