/**
 * Shared net/orchestrators fetch — single cached call used by both
 * the KPI resolver (time-scoped count when `LastSeen` is present) and the
 * orchestrator-table resolver (multi-URI enrichment).
 *
 * Source: GET /v1/net/orchestrators?active_only=false&limit=1000&offset=0
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

/** Single-request `limit` for net/orchestrators. */
export const NET_ORCHESTRATORS_PAGE_SIZE = '1000';

/**
 * Orchestrator `hardware[].pipeline` values should already be Livepeer-style slugs.
 * Reject unexpected shapes so registry blobs cannot inject odd capability path segments.
 */
const REGISTRY_PIPELINE_SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;

function sanitizeRegistryPipelineSlug(raw: string): string | null {
  const s = raw.trim();
  return REGISTRY_PIPELINE_SLUG_RE.test(s) ? s : null;
}

/**
 * Fallback: Livepeer `net.Capability` protobuf enum IDs → pipeline slugs.
 * Prefer resolving pipeline from `hardware` on the same `RawCapabilities` object;
 * this table is only used when a price row has no matching hardware entry.
 *
 * @see https://github.com/livepeer/go-livepeer/blob/master/net/capabilities.go (Capability enum)
 */
const LIVEPEER_CAPABILITY_SLUG_BY_ID: Partial<Record<number, string>> = {
  27: 'text-to-image',
  28: 'image-to-image',
  29: 'image-to-video',
  30: 'upscale',
  31: 'audio-to-text',
  32: 'segment-anything-2',
  33: 'llm',
  34: 'image-to-text',
  35: 'live-video-to-video',
  36: 'text-to-speech',
  37: 'byoc',
};

function pipelineSlugFromCapabilityId(capId: number): string | null {
  return LIVEPEER_CAPABILITY_SLUG_BY_ID[capId] ?? null;
}

/** model_id / price constraint → pipeline slug from the same registry JSON (dynamic, no ID table). */
function pipelineSlugByModelFromHardware(reg: RegistryRawCapabilities): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of reg.hardware ?? []) {
    const model = h.model_id?.trim();
    const pipe = sanitizeRegistryPipelineSlug(h.pipeline ?? '');
    if (!model || !pipe) {
      continue;
    }
    if (!m.has(model)) {
      m.set(model, pipe);
    }
  }
  return m;
}

interface NaapNetOrchestrator {
  Address: string;
  URI: string;
  IsActive: boolean;
  LastSeen?: string | number;
  lastSeen?: string | number;
  last_seen?: string | number;
  RawCapabilities?: string;
}

interface RegistryRawCapabilities {
  hardware?: Array<{ pipeline?: string; model_id?: string }>;
  capabilities_prices?: Array<{
    pricePerUnit: number;
    pixelsPerUnit: number;
    capability: number;
    constraint: string;
  }>;
}

interface DashboardPipelineModelOffer {
  pipelineId: string;
  modelIds: string[];
}

interface DiscoveryAggRow {
  displayAddress: string;
  uris: string[];
  active: boolean;
  caps: Set<string>;
  bestLastSeenMs: number;
  canonicalUri: string;
}

function parseRegistryRawCapabilities(raw: string | undefined): RegistryRawCapabilities {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as RegistryRawCapabilities;
  } catch {
    return {};
  }
}

function pipelineModelOffersFromRegistry(reg: RegistryRawCapabilities): DashboardPipelineModelOffer[] {
  const byPipeline = new Map<string, Set<string>>();
  for (const h of reg.hardware ?? []) {
    const pipeline = sanitizeRegistryPipelineSlug(h.pipeline ?? '');
    const model = h.model_id?.trim();
    if (!pipeline || !model) {
      continue;
    }
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
    if (raw <= 0) {
      return undefined;
    }
    return raw >= 1e12 ? raw : raw * 1000;
  }
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const epoch = Number(trimmed);
    if (Number.isFinite(epoch) && epoch > 0) {
      return epoch >= 1e12 ? epoch : epoch * 1000;
    }
  }
  const t = Date.parse(trimmed);
  return Number.isFinite(t) ? t : undefined;
}

export interface NetOrchestratorData {
  activeCount: number;
  /** Lower-cased on-chain addresses with at least one `IsActive` registry row. */
  activeAddresses: Set<string>;
  listedCount: number;
  urisByAddress: Map<string, string[]>;
  displayAddressByLower: Map<string, string>;
  hasLastSeenData: boolean;
  lastSeenMsByAddress: Map<string, number>;
  pipelineModelsByAddress: Map<string, DashboardPipelineModelOffer[]>;
}

/** Remote-signer-style discovery row. */
export interface OrchestratorDiscoveryEntry {
  /** Canonical service URI (row with latest LastSeen for this orchestrator). */
  address: string;
  score: number;
  /** `pipeline-id/model` strings for `caps=` filtering (OR semantics). */
  capabilities: string[];
  /**
   * Latest registry `LastSeen` for this orchestrator (max across its URI rows), ms since epoch.
   * Response list is sorted by this field descending (newest first); `0` means unknown/missing.
   */
  last_seen_ms: number;
  /** Present when {@link last_seen_ms} &gt; 0. */
  last_seen?: string;
}

export interface NetOrchestratorBundle {
  data: NetOrchestratorData;
  discoveryList: OrchestratorDiscoveryEntry[];
}

/** True if this URI list would produce a row in the overview orchestrator table. */
export function hasNonBlankServiceUri(uris: string[]): boolean {
  return uris.some((u) => typeof u === 'string' && u.trim().length > 0);
}

function discoveryEntryFromAgg(
  addrLower: string,
  agg: DiscoveryAggRow,
  lastSeenMsByAddress: Map<string, number>,
): OrchestratorDiscoveryEntry | null {
  if (!hasNonBlankServiceUri(agg.uris)) {
    return null;
  }
  const address =
    (agg.canonicalUri.trim().length > 0 ? agg.canonicalUri : agg.uris.find((u) => u.trim().length > 0) ?? '').trim();
  if (!address) {
    return null;
  }
  const fromMap = lastSeenMsByAddress.get(addrLower);
  const rawMs = Math.max(
    agg.bestLastSeenMs,
    fromMap ?? -1,
  );
  const last_seen_ms = rawMs < 0 ? 0 : rawMs;
  return {
    address,
    score: agg.active ? 1 : 0,
    capabilities: [...agg.caps].sort((a, b) => a.localeCompare(b)),
    last_seen_ms,
    ...(last_seen_ms > 0 ? { last_seen: new Date(last_seen_ms).toISOString() } : {}),
  };
}

const EMPTY: NetOrchestratorData = {
  activeCount: 0,
  activeAddresses: new Set(),
  listedCount: 0,
  urisByAddress: new Map(),
  displayAddressByLower: new Map(),
  hasLastSeenData: false,
  lastSeenMsByAddress: new Map(),
  pipelineModelsByAddress: new Map(),
};

const EMPTY_DISCOVERY: OrchestratorDiscoveryEntry[] = [];

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

function aggregateNetOrchestratorBundleFromRows(rows: NaapNetOrchestrator[]): NetOrchestratorBundle {
  const displayAddressByLower = new Map<string, string>();
  const activeAddresses = new Set<string>();
  const lastSeenMsByAddress = new Map<string, number>();
  const pipelineModelsByAddress = new Map<string, DashboardPipelineModelOffer[]>();
  const discoveryByAddress = new Map<string, DiscoveryAggRow>();
  let hasLastSeenData = false;

  for (const r of rows) {
    const addr = r.Address.trim().toLowerCase();
    const lsRaw = parseOrchestratorLastSeenMs(r);
    if (lsRaw !== undefined) {
      hasLastSeenData = true;
    }

    if (!displayAddressByLower.has(addr)) {
      displayAddressByLower.set(addr, r.Address.trim());
    }

    let disc = discoveryByAddress.get(addr);
    if (!disc) {
      disc = {
        displayAddress: r.Address.trim(),
        uris: [],
        active: false,
        caps: new Set(),
        bestLastSeenMs: -1,
        canonicalUri: '',
      };
      discoveryByAddress.set(addr, disc);
    }

    const uri = typeof r.URI === 'string' ? r.URI.trim() : '';
    if (uri.length > 0 && !disc.uris.includes(uri)) {
      disc.uris.push(uri);
    }
    if (r.IsActive) {
      activeAddresses.add(addr);
      disc.active = true;
    }
    if (lsRaw !== undefined) {
      const prevAddrLs = lastSeenMsByAddress.get(addr);
      if (prevAddrLs === undefined || lsRaw > prevAddrLs) {
        lastSeenMsByAddress.set(addr, lsRaw);
      }
    }
    if (lsRaw !== undefined && uri.length > 0) {
      if (lsRaw > disc.bestLastSeenMs) {
        disc.bestLastSeenMs = lsRaw;
        disc.canonicalUri = uri;
      } else if (lsRaw === disc.bestLastSeenMs && disc.canonicalUri.length === 0) {
        disc.canonicalUri = uri;
      }
    }

    const reg = parseRegistryRawCapabilities(r.RawCapabilities);

    const offers = pipelineModelOffersFromRegistry(reg);
    if (offers.length > 0) {
      pipelineModelsByAddress.set(
        addr,
        mergePipelineModelOffers(pipelineModelsByAddress.get(addr), offers),
      );
    }

    const pipelineByModel = pipelineSlugByModelFromHardware(reg);

    // Collect capability keys from hardware entries.
    for (const h of reg.hardware ?? []) {
      const p = sanitizeRegistryPipelineSlug(h.pipeline ?? '');
      const m = h.model_id?.trim();
      if (p && m) {
        disc.caps.add(`${p}/${m}`);
      }
    }

    // Collect capability keys from price entries (fallback via capability ID when no hardware match).
    for (const pr of reg.capabilities_prices ?? []) {
      const constraint = pr.constraint?.trim();
      if (!constraint) {
        continue;
      }
      const slug =
        pipelineByModel.get(constraint) ?? pipelineSlugFromCapabilityId(pr.capability);
      if (slug) {
        disc.caps.add(`${slug}/${constraint}`);
      }
    }
  }

  // Derive urisByAddress from the single-source discoveryByAddress map.
  const urisByAddress = new Map<string, string[]>();
  let listedCount = 0;
  for (const [addr, disc] of discoveryByAddress) {
    urisByAddress.set(addr, disc.uris);
    if (hasNonBlankServiceUri(disc.uris)) {
      listedCount++;
    }
  }

  const data: NetOrchestratorData = {
    activeCount: activeAddresses.size,
    activeAddresses,
    listedCount,
    urisByAddress,
    displayAddressByLower,
    hasLastSeenData,
    lastSeenMsByAddress,
    pipelineModelsByAddress,
  };

  const discoveryList: OrchestratorDiscoveryEntry[] = [];
  for (const [addrLower, agg] of discoveryByAddress) {
    if (!hasNonBlankServiceUri(agg.uris)) {
      continue;
    }
    if (agg.canonicalUri.length === 0) {
      const first = agg.uris.find((u) => u.trim().length > 0);
      if (first) {
        agg.canonicalUri = first.trim();
      }
    }
    const entry = discoveryEntryFromAgg(addrLower, agg, lastSeenMsByAddress);
    if (entry) {
      discoveryList.push(entry);
    }
  }
  discoveryList.sort((a, b) => {
    const byScore = b.score - a.score;
    if (byScore !== 0) {
      return byScore;
    }
    const bySeen = b.last_seen_ms - a.last_seen_ms;
    if (bySeen !== 0) {
      return bySeen;
    }
    return a.address.localeCompare(b.address);
  });

  return { data, discoveryList };
}

const NET_ORCHESTRATORS_CACHE_KEY = `facade:net-orchestrators:single-request&limit=${NET_ORCHESTRATORS_PAGE_SIZE}`;

export function getNetOrchestratorBundle(): Promise<NetOrchestratorBundle> {
  return cachedFetch(NET_ORCHESTRATORS_CACHE_KEY, TTL.NET_MODELS, async () => {
    const rows = await fetchAllNetOrchestratorRows();
    return aggregateNetOrchestratorBundleFromRows(rows);
  });
}

export function getNetOrchestratorData(): Promise<NetOrchestratorData> {
  return getNetOrchestratorBundle().then((b) => b.data);
}

export function getOrchestratorDiscoveryList(): Promise<OrchestratorDiscoveryEntry[]> {
  return getNetOrchestratorBundle().then((b) => b.discoveryList);
}

export function getNetOrchestratorDataSafe(): Promise<NetOrchestratorData> {
  return getNetOrchestratorData().catch(() => EMPTY);
}

export function getOrchestratorDiscoveryListSafe(): Promise<OrchestratorDiscoveryEntry[]> {
  return getOrchestratorDiscoveryList().catch(() => EMPTY_DISCOVERY);
}
