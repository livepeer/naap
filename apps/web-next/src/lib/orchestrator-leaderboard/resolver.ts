/**
 * Orchestrator Leaderboard — Hybrid Conflict Resolver
 *
 * Merges NormalizedOrch rows from multiple sources into the canonical
 * ClickHouseLeaderboardRow shape. Uses two layers of resolution:
 *
 * 1. **Source-level membership** — orchestrators present in the
 *    highest-priority enabled source define the canonical set. Orchs
 *    from lower-priority sources that are absent from the membership
 *    source are dropped and recorded in the audit.
 *
 * 2. **Field-level priority** — for each orch, walk each field in
 *    the configured field-priority order; first source with a non-null
 *    value wins. Conflicts are recorded in the audit.
 */

import type { ClickHouseLeaderboardRow } from './types';
import type { SourceKind, NormalizedOrch } from './sources/types';

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface ResolverConfig {
  sources: { kind: SourceKind; priority: number; enabled: boolean }[];
  fieldPriority?: Partial<Record<string, SourceKind[]>>;
}

export interface ConflictEntry {
  orchKey: string;
  field: string;
  winner: SourceKind;
  losers: { source: SourceKind; value: unknown }[];
}

export interface DroppedEntry {
  orchKey: string;
  source: SourceKind;
  reason: string;
}

export interface AuditEntry {
  membershipSource: SourceKind;
  totalOrchestrators: number;
  totalCapabilities: number;
  conflicts: ConflictEntry[];
  dropped: DroppedEntry[];
  warnings: string[];
  perSourceCounts: Record<string, number>;
}

export interface ResolutionResult {
  capabilities: Record<string, ClickHouseLeaderboardRow[]>;
  audit: AuditEntry;
}

// ---------------------------------------------------------------------------
// Default field-priority: which source is preferred for each metric field
// ---------------------------------------------------------------------------

const DEFAULT_FIELD_PRIORITY: Record<string, SourceKind[]> = {
  orchUri: ['livepeer-subgraph', 'clickhouse-query', 'naap-discover', 'naap-pricing'],
  ethAddress: ['livepeer-subgraph', 'naap-pricing', 'clickhouse-query', 'naap-discover'],
  gpuName: ['clickhouse-query', 'naap-discover'],
  gpuGb: ['clickhouse-query', 'naap-discover'],
  avail: ['clickhouse-query'],
  totalCap: ['clickhouse-query'],
  pricePerUnit: ['clickhouse-query', 'naap-pricing'],
  bestLatMs: ['clickhouse-query'],
  avgLatMs: ['clickhouse-query'],
  swapRatio: ['clickhouse-query'],
  avgAvail: ['clickhouse-query'],
  capabilities: ['clickhouse-query', 'naap-discover'],
  score: ['naap-discover'],
  recentWork: ['naap-discover'],
  lastSeenMs: ['naap-discover'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OrchKey = string;

function orchKey(row: NormalizedOrch): OrchKey {
  if (row.ethAddress) return `eth:${row.ethAddress.toLowerCase()}`;
  if (row.orchUri) return `uri:${row.orchUri}`;
  return `unknown:${JSON.stringify(row).slice(0, 40)}`;
}

function normalizeKey(key: string): string {
  return key.startsWith('eth:') || key.startsWith('uri:') ? key : key;
}

/**
 * Build an index of orchKey → NormalizedOrch[] per source for fast lookup.
 * ClickHouse may return multiple rows for the same orch (one per capability),
 * so we group them.
 */
function indexByOrch(
  rows: NormalizedOrch[],
): Map<OrchKey, NormalizedOrch[]> {
  const map = new Map<OrchKey, NormalizedOrch[]>();
  for (const r of rows) {
    const k = orchKey(r);
    const existing = map.get(k);
    if (existing) {
      existing.push(r);
    } else {
      map.set(k, [r]);
    }
  }
  return map;
}

function isNonNull(v: unknown): boolean {
  return v !== undefined && v !== null;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export function resolve(
  perSource: Partial<Record<SourceKind, NormalizedOrch[]>>,
  cfg: ResolverConfig,
): ResolutionResult {
  const conflicts: ConflictEntry[] = [];
  const dropped: DroppedEntry[] = [];
  const warnings: string[] = [];
  const perSourceCounts: Record<string, number> = {};

  const enabled = cfg.sources
    .filter((s) => s.enabled)
    .sort((a, b) => a.priority - b.priority);

  if (enabled.length === 0) {
    warnings.push('No sources enabled — returning empty dataset');
    return {
      capabilities: {},
      audit: {
        membershipSource: 'clickhouse-query',
        totalOrchestrators: 0,
        totalCapabilities: 0,
        conflicts,
        dropped,
        warnings,
        perSourceCounts,
      },
    };
  }

  const membershipSource = enabled[0].kind;
  const fieldPriority = { ...DEFAULT_FIELD_PRIORITY, ...cfg.fieldPriority };

  // Index each source's rows by orchKey
  const sourceIndexes = new Map<SourceKind, Map<OrchKey, NormalizedOrch[]>>();
  for (const s of enabled) {
    const rows = perSource[s.kind] ?? [];
    perSourceCounts[s.kind] = rows.length;
    sourceIndexes.set(s.kind, indexByOrch(rows));
  }

  // Membership set = keys from the highest-priority source
  const membershipIndex = sourceIndexes.get(membershipSource)!;
  const membershipKeys = new Set(membershipIndex.keys());

  // Also build a cross-reference: orchUri <-> ethAddress for join
  const uriToEth = new Map<string, string>();
  const ethToUri = new Map<string, string>();
  for (const [, srcIndex] of sourceIndexes) {
    for (const [, rows] of srcIndex) {
      for (const r of rows) {
        if (r.ethAddress && r.orchUri) {
          uriToEth.set(r.orchUri, r.ethAddress.toLowerCase());
          ethToUri.set(r.ethAddress.toLowerCase(), r.orchUri);
        }
      }
    }
  }

  // Try to resolve orchKey across eth/uri cross-reference
  function resolveOrchKey(key: OrchKey): OrchKey | null {
    if (membershipKeys.has(key)) return key;
    const normalized = normalizeKey(key);
    if (normalized.startsWith('uri:')) {
      const uri = normalized.slice(4);
      const eth = uriToEth.get(uri);
      if (eth) {
        const ethKey: OrchKey = `eth:${eth}`;
        if (membershipKeys.has(ethKey)) return ethKey;
      }
    }
    if (normalized.startsWith('eth:')) {
      const eth = normalized.slice(4);
      const uri = ethToUri.get(eth);
      if (uri) {
        const uriKey: OrchKey = `uri:${uri}`;
        if (membershipKeys.has(uriKey)) return uriKey;
      }
    }
    return null;
  }

  // Record dropped from non-membership sources
  for (const s of enabled) {
    if (s.kind === membershipSource) continue;
    const srcIndex = sourceIndexes.get(s.kind)!;
    for (const key of srcIndex.keys()) {
      if (!resolveOrchKey(key)) {
        dropped.push({
          orchKey: key,
          source: s.kind,
          reason: `not present in membership source (${membershipSource})`,
        });
      }
    }
  }

  // Merge fields per orchestrator
  interface MergedOrch {
    orchUri: string;
    ethAddress: string;
    gpuName: string;
    gpuGb: number;
    avail: number;
    totalCap: number;
    pricePerUnit: number;
    bestLatMs: number | null;
    avgLatMs: number | null;
    swapRatio: number | null;
    avgAvail: number | null;
    capabilities: string[];
    score: number;
  }

  const mergedOrchs = new Map<OrchKey, MergedOrch>();

  for (const memberKey of membershipKeys) {
    const merged: MergedOrch = {
      orchUri: '',
      ethAddress: '',
      gpuName: '',
      gpuGb: 0,
      avail: 0,
      totalCap: 0,
      pricePerUnit: 0,
      bestLatMs: null,
      avgLatMs: null,
      swapRatio: null,
      avgAvail: null,
      capabilities: [],
      score: 0,
    };

    // Collect all source rows for this orch
    const sourceRows = new Map<SourceKind, NormalizedOrch[]>();
    for (const s of enabled) {
      const srcIndex = sourceIndexes.get(s.kind)!;
      const directRows = srcIndex.get(memberKey);
      if (directRows) {
        sourceRows.set(s.kind, directRows);
        continue;
      }
      // Try cross-reference join
      const mk = normalizeKey(memberKey);
      if (mk.startsWith('eth:')) {
        const eth = mk.slice(4);
        const uri = ethToUri.get(eth);
        if (uri) {
          const uriRows = srcIndex.get(`uri:${uri}`);
          if (uriRows) sourceRows.set(s.kind, uriRows);
        }
      } else if (mk.startsWith('uri:')) {
        const uri = mk.slice(4);
        const eth = uriToEth.get(uri);
        if (eth) {
          const ethRows = srcIndex.get(`eth:${eth}`);
          if (ethRows) sourceRows.set(s.kind, ethRows);
        }
      }
    }

    // Resolve each field using field priority
    const fieldsToResolve: (keyof NormalizedOrch)[] = [
      'orchUri', 'ethAddress', 'gpuName', 'gpuGb', 'avail', 'totalCap',
      'pricePerUnit', 'bestLatMs', 'avgLatMs', 'swapRatio', 'avgAvail', 'score',
    ];

    for (const field of fieldsToResolve) {
      const priority = (fieldPriority[field] ?? enabled.map(s => s.kind)) as SourceKind[];
      let winner: SourceKind | null = null;
      let winnerValue: unknown = null;
      const losers: { source: SourceKind; value: unknown }[] = [];

      for (const src of priority) {
        const rows = sourceRows.get(src);
        if (!rows) continue;
        const first = rows[0];
        const val = first[field];
        if (isNonNull(val)) {
          if (winner === null) {
            winner = src;
            winnerValue = val;
          } else {
            losers.push({ source: src, value: val });
          }
        }
      }

      if (winner && winnerValue !== null && winnerValue !== undefined) {
        (merged as unknown as Record<string, unknown>)[field] = winnerValue;
      }

      if (losers.length > 0 && winner) {
        conflicts.push({ orchKey: memberKey, field, winner, losers });
      }
    }

    // Merge capabilities from all sources
    const capSet = new Set<string>();
    for (const [, rows] of sourceRows) {
      for (const r of rows) {
        if (r.capabilities) {
          for (const c of r.capabilities) capSet.add(c);
        }
      }
    }
    merged.capabilities = Array.from(capSet);

    mergedOrchs.set(memberKey, merged);
  }

  // Explode orchs × capabilities into ClickHouseLeaderboardRow per-capability
  const capabilities: Record<string, ClickHouseLeaderboardRow[]> = {};
  let totalOrchestrators = 0;
  const seenOrchKeys = new Set<OrchKey>();

  for (const [key, merged] of mergedOrchs) {
    if (merged.capabilities.length === 0) {
      // Orch has no known capabilities — add a single row under the special "__uncategorized" cap
      const row: ClickHouseLeaderboardRow = {
        orch_uri: merged.orchUri,
        gpu_name: merged.gpuName,
        gpu_gb: merged.gpuGb,
        avail: merged.avail,
        total_cap: merged.totalCap,
        price_per_unit: merged.pricePerUnit,
        best_lat_ms: merged.bestLatMs,
        avg_lat_ms: merged.avgLatMs,
        swap_ratio: merged.swapRatio,
        avg_avail: merged.avgAvail,
      };
      if (!capabilities['__uncategorized']) capabilities['__uncategorized'] = [];
      capabilities['__uncategorized'].push(row);
      if (!seenOrchKeys.has(key)) {
        seenOrchKeys.add(key);
        totalOrchestrators++;
      }
      continue;
    }

    // For ClickHouse adapter, source rows already have per-cap rows.
    // For merged orchs, we may need to override from higher-priority fields.
    // Get all ClickHouse per-cap detail rows if available.
    for (const cap of merged.capabilities) {
      const row: ClickHouseLeaderboardRow = {
        orch_uri: merged.orchUri,
        gpu_name: merged.gpuName,
        gpu_gb: merged.gpuGb,
        avail: merged.avail,
        total_cap: merged.totalCap,
        price_per_unit: merged.pricePerUnit,
        best_lat_ms: merged.bestLatMs,
        avg_lat_ms: merged.avgLatMs,
        swap_ratio: merged.swapRatio,
        avg_avail: merged.avgAvail,
      };
      if (!capabilities[cap]) capabilities[cap] = [];
      capabilities[cap].push(row);
      if (!seenOrchKeys.has(key)) {
        seenOrchKeys.add(key);
        totalOrchestrators++;
      }
    }
  }

  // Remove __uncategorized if it's empty or if there are categorized capabilities
  if (capabilities['__uncategorized']?.length === 0) {
    delete capabilities['__uncategorized'];
  }

  return {
    capabilities,
    audit: {
      membershipSource,
      totalOrchestrators,
      totalCapabilities: Object.keys(capabilities).filter(k => k !== '__uncategorized').length,
      conflicts,
      dropped,
      warnings,
      perSourceCounts,
    },
  };
}
