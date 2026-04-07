/**
 * Shared net/orchestrators fetch — single cached call used by both
 * the KPI resolver (distinct-address count) and the orchestrator-table
 * resolver (multi-URI enrichment).
 *
 * Source: GET /v1/net/orchestrators?active_only=false&limit=2000
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

interface NaapNetOrchestrator {
  Address: string;
  URI: string;
  IsActive: boolean;
}

export interface NetOrchestratorData {
  /** Distinct addresses where at least one entry has IsActive === true. */
  activeCount: number;
  /** Address (lower-cased) → deduplicated list of service URIs. */
  urisByAddress: Map<string, string[]>;
}

const EMPTY: NetOrchestratorData = { activeCount: 0, urisByAddress: new Map() };

export function getNetOrchestratorData(): Promise<NetOrchestratorData> {
  return cachedFetch('facade:net-orchestrators', TTL.NET_MODELS, async () => {
    const rows = await naapGet<NaapNetOrchestrator[]>('net/orchestrators', {
      active_only: 'false',
      limit: '2000',
    }, {
      next: { revalidate: Math.floor(TTL.NET_MODELS / 1000) },
      errorLabel: 'net-orchestrators',
    });

    const urisByAddress = new Map<string, string[]>();
    const activeAddresses = new Set<string>();

    for (const r of rows) {
      const addr = r.Address.toLowerCase();
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
    }

    return { activeCount: activeAddresses.size, urisByAddress };
  });
}

export function getNetOrchestratorDataSafe(): Promise<NetOrchestratorData> {
  return getNetOrchestratorData().catch(() => EMPTY);
}
