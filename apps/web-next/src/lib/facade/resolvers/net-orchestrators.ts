/**
 * Shared net/orchestrators fetch — single cached call used by both
 * the KPI resolver (time-scoped count when `LastSeen` is present) and the
 * orchestrator-table resolver (one row per Address+URI endpoint).
 *
 * Source: GET /v1/net/orchestrators?active_only=false&limit=1000&offset=0
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

/** Single-request `limit` for net/orchestrators. */
export const NET_ORCHESTRATORS_PAGE_SIZE = '1000';

interface NaapNetOrchestrator {
  Address: string;
  URI: string;
  IsActive: boolean;
  LastSeen?: string | number;
  lastSeen?: string | number;
  last_seen?: string | number;
  RawCapabilities?: string;
}

interface RawCapabilitiesJson {
  hardware?: Array<{ pipeline?: string; model_id?: string }>;
}

interface DashboardPipelineModelOffer {
  pipelineId: string;
  modelIds: string[];
}

function parseRawCapabilities(raw: string | undefined): DashboardPipelineModelOffer[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RawCapabilitiesJson;
    const byPipeline = new Map<string, Set<string>>();
    for (const h of parsed.hardware ?? []) {
      const pipeline = h.pipeline?.trim();
      const model = h.model_id?.trim();
      if (!pipeline || !model) continue;
      let models = byPipeline.get(pipeline);
      if (!models) {
        models = new Set();
        byPipeline.set(pipeline, models);
      }
      models.add(model);
    }
    return [...byPipeline.entries()].map(([pipelineId, modelSet]) => ({
      pipelineId,
      modelIds: [...modelSet].sort((a, b) => a.localeCompare(b)),
    }));
  } catch {
    return [];
  }
}

function mergePipelineModelOffers(
  existing: DashboardPipelineModelOffer[] | undefined,
  incoming: DashboardPipelineModelOffer[],
): DashboardPipelineModelOffer[] {
  const byPipeline = new Map<string, Set<string>>();

  for (const offer of existing ?? []) {
    let models = byPipeline.get(offer.pipelineId);
    if (!models) {
      models = new Set();
      byPipeline.set(offer.pipelineId, models);
    }
    for (const modelId of offer.modelIds) {
      models.add(modelId);
    }
  }

  for (const offer of incoming) {
    let models = byPipeline.get(offer.pipelineId);
    if (!models) {
      models = new Set();
      byPipeline.set(offer.pipelineId, models);
    }
    for (const modelId of offer.modelIds) {
      models.add(modelId);
    }
  }

  return [...byPipeline.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pipelineId, modelSet]) => ({
      pipelineId,
      modelIds: [...modelSet].sort((a, b) => a.localeCompare(b)),
    }));
}

function parseOrchestratorLastSeenMs(row: NaapNetOrchestrator): number | undefined {
  const raw = row.LastSeen ?? row.lastSeen ?? row.last_seen;
  if (raw == null) {
    return undefined;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw <= 0) return undefined;
    // Unix ms (e.g. 1.7e12) vs seconds (e.g. 1.7e9)
    return raw >= 1e12 ? raw : raw * 1000;
  }
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const epoch = Number(trimmed);
    if (Number.isFinite(epoch) && epoch > 0) {
      // Unix ms (e.g. 1.7e12) vs seconds (e.g. 1.7e9)
      return epoch >= 1e12 ? epoch : epoch * 1000;
    }
  }
  const t = Date.parse(trimmed);
  return Number.isFinite(t) ? t : undefined;
}

/** Stable map key for a (address, service URI) pair; both sides should be trimmed. */
export function orchestratorPairKey(addrLower: string, uri: string): string {
  return `${addrLower}\0${uri}`;
}

export interface NetOrchestratorData {
  /** Distinct addresses where at least one entry has IsActive === true. */
  activeCount: number;
  /**
   * Distinct (Address, service URI) pairs with non-blank URI — same row count as the
   * orchestrator table (`resolveOrchestrators`).
   */
  listedCount: number;
  /** Address (lower-cased) → deduplicated list of service URIs. */
  urisByAddress: Map<string, string[]>;
  /** First-seen casing of each address (for display / merge rows). */
  displayAddressByLower: Map<string, string>;
  /**
   * True when the upstream registry returned at least one parseable `LastSeen` timestamp.
   * Used by the KPI panel to scope orchestrator counts to the overview timeframe.
   */
  hasLastSeenData: boolean;
  /** Per-address max `LastSeen` (ms) across URI rows; only addresses with a seen timestamp appear. */
  lastSeenMsByAddress: Map<string, number>;
  /**
   * Per (address, URI) max `LastSeen` (ms) across registry rows for that endpoint.
   * Keys from {@link orchestratorPairKey}.
   */
  lastSeenMsByPair: Map<string, number>;
  /**
   * Oldest parseable `LastSeen` (ms) across all registry rows. `undefined` when the
   * registry had no parseable timestamps. Used to label the effective window of the
   * snapshot the orchestrator count is derived from.
   */
  oldestLastSeenMs?: number;
  /** Per-address pipeline/model offers parsed from RawCapabilities.hardware. */
  pipelineModelsByAddress: Map<string, DashboardPipelineModelOffer[]>;
}

/** True if this URI list would produce at least one row in the overview orchestrator table. */
export function hasNonBlankServiceUri(uris: string[]): boolean {
  return uris.some((u) => typeof u === 'string' && u.trim().length > 0);
}

const EMPTY: NetOrchestratorData = {
  activeCount: 0,
  listedCount: 0,
  urisByAddress: new Map(),
  displayAddressByLower: new Map(),
  hasLastSeenData: false,
  lastSeenMsByAddress: new Map(),
  lastSeenMsByPair: new Map(),
  pipelineModelsByAddress: new Map(),
};

async function fetchAllNetOrchestratorRows(): Promise<NaapNetOrchestrator[]> {
  const revalidateSec = Math.floor(TTL.NET_MODELS / 1000);
  const fetchOptions = {
    next: { revalidate: revalidateSec },
    errorLabel: 'net-orchestrators',
  } as const;
  return naapGet<NaapNetOrchestrator[]>('net/orchestrators', {
    active_only: 'false',
    limit: NET_ORCHESTRATORS_PAGE_SIZE,
    offset: '0',
  }, fetchOptions);
}

export function getNetOrchestratorData(): Promise<NetOrchestratorData> {
  const cacheKey = `facade:net-orchestrators:single-request&limit=${NET_ORCHESTRATORS_PAGE_SIZE}`;
  return cachedFetch(cacheKey, TTL.NET_MODELS, async () => {
    const rows = await fetchAllNetOrchestratorRows();

    const urisByAddress = new Map<string, string[]>();
    const displayAddressByLower = new Map<string, string>();
    const activeAddresses = new Set<string>();
    const lastSeenMsByAddress = new Map<string, number>();
    const lastSeenMsByPair = new Map<string, number>();
    const pipelineModelsByAddress = new Map<string, DashboardPipelineModelOffer[]>();
    let hasLastSeenData = false;
    let oldestLastSeenMs: number | undefined;

    for (const r of rows) {
      const addr = r.Address.trim().toLowerCase();
      if (!displayAddressByLower.has(addr)) {
        displayAddressByLower.set(addr, r.Address.trim());
      }
      const offers = parseRawCapabilities(r.RawCapabilities);
      if (offers.length > 0) {
        pipelineModelsByAddress.set(
          addr,
          mergePipelineModelOffers(pipelineModelsByAddress.get(addr), offers),
        );
      }
      let uris = urisByAddress.get(addr);
      if (!uris) {
        uris = [];
        urisByAddress.set(addr, uris);
      }
      const uri =
        typeof r.URI === 'string' ? r.URI.trim() : '';
      if (uri.length > 0 && !uris.includes(uri)) {
        uris.push(uri);
      }
      if (r.IsActive) {
        activeAddresses.add(addr);
      }
      const ls = parseOrchestratorLastSeenMs(r);
      if (ls !== undefined) {
        hasLastSeenData = true;
        if (oldestLastSeenMs === undefined || ls < oldestLastSeenMs) {
          oldestLastSeenMs = ls;
        }
        const prev = lastSeenMsByAddress.get(addr);
        if (prev === undefined || ls > prev) {
          lastSeenMsByAddress.set(addr, ls);
        }
        if (uri.length > 0) {
          const pk = orchestratorPairKey(addr, uri);
          const prevPair = lastSeenMsByPair.get(pk);
          if (prevPair === undefined || ls > prevPair) {
            lastSeenMsByPair.set(pk, ls);
          }
        }
      }
    }

    let listedCount = 0;
    for (const uris of urisByAddress.values()) {
      for (const u of uris) {
        if (typeof u === 'string' && u.trim().length > 0) {
          listedCount++;
        }
      }
    }

    return {
      activeCount: activeAddresses.size,
      listedCount,
      urisByAddress,
      displayAddressByLower,
      hasLastSeenData,
      lastSeenMsByAddress,
      lastSeenMsByPair,
      oldestLastSeenMs,
      pipelineModelsByAddress,
    };
  });
}

export function getNetOrchestratorDataSafe(): Promise<NetOrchestratorData> {
  return getNetOrchestratorData().catch(() => EMPTY);
}
