/**
 * Shared net/orchestrators fetch — single cached call used by both
 * the KPI resolver (time-scoped count when `LastSeen` is present) and the
 * orchestrator-table resolver (multi-URI enrichment).
 *
 * Source: GET /v1/net/orchestrators?active_only=false&limit=1000
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

/** Must match Overview / KPI registry query (`limit` on net/orchestrators). */
export const NET_ORCHESTRATORS_FETCH_LIMIT = '1000';

interface NaapNetOrchestrator {
  Address: string;
  URI: string;
  IsActive: boolean;
  LastSeen?: string;
  lastSeen?: string;
  last_seen?: string;
}

function parseOrchestratorLastSeenMs(row: NaapNetOrchestrator): number | undefined {
  const raw = row.LastSeen ?? row.lastSeen ?? row.last_seen;
  if (raw == null || typeof raw !== 'string') {
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
};

export function getNetOrchestratorData(): Promise<NetOrchestratorData> {
  const cacheKey = `facade:net-orchestrators:limit=${NET_ORCHESTRATORS_FETCH_LIMIT}`;
  return cachedFetch(cacheKey, TTL.NET_MODELS, async () => {
    const rows = await naapGet<NaapNetOrchestrator[]>('net/orchestrators', {
      active_only: 'false',
      limit: NET_ORCHESTRATORS_FETCH_LIMIT,
    }, {
      next: { revalidate: Math.floor(TTL.NET_MODELS / 1000) },
      errorLabel: 'net-orchestrators',
    });

    const urisByAddress = new Map<string, string[]>();
    const displayAddressByLower = new Map<string, string>();
    const activeAddresses = new Set<string>();
    const lastSeenMsByAddress = new Map<string, number>();
    let hasLastSeenData = false;

    for (const r of rows) {
      const addr = r.Address.toLowerCase();
      if (!displayAddressByLower.has(addr)) {
        displayAddressByLower.set(addr, r.Address.trim());
      }
      let uris = urisByAddress.get(addr);
      if (!uris) {
        uris = [];
        urisByAddress.set(addr, uris);
      }
      if (!uris.includes(r.URI)) {
        uris.push(r.URI);
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
    };
  });
}

export function getNetOrchestratorDataSafe(): Promise<NetOrchestratorData> {
  return getNetOrchestratorData().catch(() => EMPTY);
}
