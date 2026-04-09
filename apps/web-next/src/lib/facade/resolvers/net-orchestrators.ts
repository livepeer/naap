/**
 * Shared net/orchestrators fetch — single cached call used by both
 * the KPI resolver (time-scoped count when `LastSeen` is present) and the
 * orchestrator-table resolver (multi-URI enrichment).
 *
 * Source: GET /v1/net/orchestrators?active_only=false&limit=…&offset=… (paged until exhausted)
 */

import type { DashboardPipelineModelOffer } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

/** Per-page `limit` for net/orchestrators (registry supports `offset` pagination). */
export const NET_ORCHESTRATORS_PAGE_SIZE = '1000';

const MAX_NET_ORCHESTRATOR_PAGES = 500;

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
  const t = Date.parse(raw.trim());
  return Number.isFinite(t) ? t : undefined;
}

export interface NetOrchestratorData {
  /** Distinct addresses where at least one entry has IsActive === true. */
  activeCount: number;
  /**
   * Distinct addresses with at least one non-blank service URI — same inclusion rule as
   * the orchestrator table (`resolveOrchestrators` after `rowHasNonBlankServiceUri`).
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
  /** Per-address pipeline/model offers parsed from RawCapabilities.hardware. */
  pipelineModelsByAddress: Map<string, DashboardPipelineModelOffer[]>;
}

/** True if this URI list would produce a row in the overview orchestrator table. */
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
  pipelineModelsByAddress: new Map(),
};

async function fetchAllNetOrchestratorRows(): Promise<NaapNetOrchestrator[]> {
  const pageSize = Number.parseInt(NET_ORCHESTRATORS_PAGE_SIZE, 10);
  const revalidateSec = Math.floor(TTL.NET_MODELS / 1000);
  const fetchOptions = {
    next: { revalidate: revalidateSec },
    errorLabel: 'net-orchestrators',
  } as const;
  const all: NaapNetOrchestrator[] = [];

  for (let page = 0; page < MAX_NET_ORCHESTRATOR_PAGES; page++) {
    const offset = String(page * pageSize);
    const rows = await naapGet<NaapNetOrchestrator[]>('net/orchestrators', {
      active_only: 'false',
      limit: NET_ORCHESTRATORS_PAGE_SIZE,
      offset,
    }, fetchOptions);
    all.push(...rows);
    if (rows.length < pageSize) {
      break;
    }
  }

  return all;
}

export function getNetOrchestratorData(): Promise<NetOrchestratorData> {
  const cacheKey = `facade:net-orchestrators:paged&pageSize=${NET_ORCHESTRATORS_PAGE_SIZE}`;
  return cachedFetch(cacheKey, TTL.NET_MODELS, async () => {
    const rows = await fetchAllNetOrchestratorRows();

    const urisByAddress = new Map<string, string[]>();
    const displayAddressByLower = new Map<string, string>();
    const activeAddresses = new Set<string>();
    const lastSeenMsByAddress = new Map<string, number>();
    const pipelineModelsByAddress = new Map<string, DashboardPipelineModelOffer[]>();
    let hasLastSeenData = false;

    for (const r of rows) {
      const addr = r.Address.toLowerCase();
      if (!displayAddressByLower.has(addr)) {
        displayAddressByLower.set(addr, r.Address.trim());
        const offers = parseRawCapabilities(r.RawCapabilities);
        if (offers.length > 0) {
          pipelineModelsByAddress.set(addr, offers);
        }
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
        const prev = lastSeenMsByAddress.get(addr);
        if (prev === undefined || ls > prev) {
          lastSeenMsByAddress.set(addr, ls);
        }
      }
    }

    let listedCount = 0;
    for (const uris of urisByAddress.values()) {
      if (hasNonBlankServiceUri(uris)) {
        listedCount++;
      }
    }

    return {
      activeCount: activeAddresses.size,
      listedCount,
      urisByAddress,
      displayAddressByLower,
      hasLastSeenData,
      lastSeenMsByAddress,
      pipelineModelsByAddress,
    };
  });
}

export function getNetOrchestratorDataSafe(): Promise<NetOrchestratorData> {
  return getNetOrchestratorData().catch(() => EMPTY);
}
