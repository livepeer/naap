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
 * Fallback: Livepeer `net.Capability` / protobuf enum **names** (SCREAMING_SNAKE), aligned with
 * go-livepeer generated code — not user-controlled strings. Slugs are derived with
 * {@link livepeerCapabilityEnumNameToPipelineSlug}.
 *
 * Prefer resolving pipeline from `hardware` on the same `RawCapabilities` object (model_id ↔
 * constraint); this table is only used when a price row has no matching hardware entry.
 *
 * @see https://github.com/livepeer/go-livepeer/blob/master/net/capabilities.go (Capability enum)
 */
const LIVEPEER_CAPABILITY_ENUM_NAME_BY_ID: Partial<Record<number, string>> = {
  27: 'TEXT_TO_IMAGE',
  28: 'IMAGE_TO_IMAGE',
  29: 'IMAGE_TO_VIDEO',
  30: 'UPSCALE',
  31: 'AUDIO_TO_TEXT',
  32: 'SEGMENT_ANYTHING_2',
  33: 'LLM',
  34: 'IMAGE_TO_TEXT',
  35: 'LIVE_VIDEO_TO_VIDEO',
  36: 'TEXT_TO_SPEECH',
  37: 'BYOC',
};

const LIVEPEER_ENUM_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

function livepeerCapabilityEnumNameToPipelineSlug(enumName: string): string | null {
  if (!LIVEPEER_ENUM_NAME_RE.test(enumName)) {
    return null;
  }
  return enumName.toLowerCase().replaceAll('_', '-');
}

function pipelineSlugFromCapabilityId(capId: number): string | null {
  const name = LIVEPEER_CAPABILITY_ENUM_NAME_BY_ID[capId];
  return name !== undefined ? livepeerCapabilityEnumNameToPipelineSlug(name) : null;
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

interface CapabilityFreshnessEntry {
  lastSeenMs: number;
  pricePerUnit?: number;
  pixelsPerUnit?: number;
}

interface DiscoveryAggRow {
  displayAddress: string;
  uris: string[];
  active: boolean;
  caps: Map<string, CapabilityFreshnessEntry>;
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

function parseRawCapabilities(raw: string | undefined): DashboardPipelineModelOffer[] {
  const parsed = parseRegistryRawCapabilities(raw);
  const byPipeline = new Map<string, Set<string>>();
  for (const h of parsed.hardware ?? []) {
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

/** Row-level merge: keep the entry tied to the greatest LastSeen; tie-break merges price. */
function mergeCapFreshness(
  existing: CapabilityFreshnessEntry | undefined,
  ls: number,
  price: { pricePerUnit: number; pixelsPerUnit: number } | undefined,
): CapabilityFreshnessEntry {
  if (existing === undefined) {
    return {
      lastSeenMs: ls,
      pricePerUnit: price?.pricePerUnit,
      pixelsPerUnit: price?.pixelsPerUnit,
    };
  }
  if (ls > existing.lastSeenMs) {
    return {
      lastSeenMs: ls,
      pricePerUnit: price?.pricePerUnit,
      pixelsPerUnit: price?.pixelsPerUnit,
    };
  }
  if (ls < existing.lastSeenMs) {
    return {
      lastSeenMs: existing.lastSeenMs,
      pricePerUnit: existing.pricePerUnit ?? price?.pricePerUnit,
      pixelsPerUnit: existing.pixelsPerUnit ?? price?.pixelsPerUnit,
    };
  }
  return {
    lastSeenMs: ls,
    pricePerUnit: existing.pricePerUnit ?? price?.pricePerUnit,
    pixelsPerUnit: existing.pixelsPerUnit ?? price?.pixelsPerUnit,
  };
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

/** Remote-signer-style discovery row; extra fields are NAAP extensions (ignored by strict clients). */
export interface OrchestratorDiscoveryEntry {
  /** Canonical service URI (row with latest LastSeen for this orchestrator). */
  address: string;
  /** On-chain orchestrator address (mixed-case from registry). */
  orchestrator_address: string;
  score: number;
  /** `pipeline-id/model` strings for `caps=` filtering (OR semantics). */
  capabilities: string[];
  /** All distinct service URIs seen for this orchestrator. */
  service_uris: string[];
  capability_details: Array<{
    capability: string;
    last_seen: string;
    last_seen_ms: number;
    price_per_unit?: number;
    pixels_per_unit?: number;
  }>;
}

export interface NetOrchestratorBundle {
  data: NetOrchestratorData;
  discoveryList: OrchestratorDiscoveryEntry[];
}

/** True if this URI list would produce a row in the overview orchestrator table. */
export function hasNonBlankServiceUri(uris: string[]): boolean {
  return uris.some((u) => typeof u === 'string' && u.trim().length > 0);
}

function discoveryEntryFromAgg(agg: DiscoveryAggRow): OrchestratorDiscoveryEntry | null {
  if (!hasNonBlankServiceUri(agg.uris)) {
    return null;
  }
  const address =
    (agg.canonicalUri.trim().length > 0 ? agg.canonicalUri : agg.uris.find((u) => u.trim().length > 0) ?? '').trim();
  if (!address) {
    return null;
  }
  const capability_details = [...agg.caps.entries()]
    .map(([capability, e]) => ({
      capability,
      last_seen: e.lastSeenMs > 0 ? new Date(e.lastSeenMs).toISOString() : '',
      last_seen_ms: e.lastSeenMs,
      ...(e.pricePerUnit !== undefined ? { price_per_unit: e.pricePerUnit } : {}),
      ...(e.pixelsPerUnit !== undefined ? { pixels_per_unit: e.pixelsPerUnit } : {}),
    }))
    .sort((a, b) => a.capability.localeCompare(b.capability));
  const capabilities = capability_details.map((d) => d.capability);
  return {
    address,
    orchestrator_address: agg.displayAddress,
    score: agg.active ? 1 : 0,
    capabilities,
    service_uris: [...agg.uris].sort((a, b) => a.localeCompare(b)),
    capability_details,
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
  const urisByAddress = new Map<string, string[]>();
  const displayAddressByLower = new Map<string, string>();
  const activeAddresses = new Set<string>();
  const lastSeenMsByAddress = new Map<string, number>();
  const pipelineModelsByAddress = new Map<string, DashboardPipelineModelOffer[]>();
  const discoveryByAddress = new Map<string, DiscoveryAggRow>();
  let hasLastSeenData = false;

  for (const r of rows) {
    const addr = r.Address.trim().toLowerCase();
    const lsRaw = parseOrchestratorLastSeenMs(r);
    const ls = lsRaw ?? 0;
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
        caps: new Map(),
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
    if (uri.length > 0 && !uris.includes(uri)) {
      uris.push(uri);
    }

    const reg = parseRegistryRawCapabilities(r.RawCapabilities);
    const pipelineByModel = pipelineSlugByModelFromHardware(reg);
    const priceByCapKey = new Map<string, { pricePerUnit: number; pixelsPerUnit: number }>();
    for (const pr of reg.capabilities_prices ?? []) {
      const constraint = pr.constraint?.trim();
      if (!constraint) {
        continue;
      }
      const slug =
        pipelineByModel.get(constraint) ?? pipelineSlugFromCapabilityId(pr.capability);
      if (!slug) {
        continue;
      }
      const k = `${slug}/${constraint}`;
      priceByCapKey.set(k, { pricePerUnit: pr.pricePerUnit, pixelsPerUnit: pr.pixelsPerUnit });
    }

    const keysThisRow = new Set<string>();
    for (const h of reg.hardware ?? []) {
      const p = sanitizeRegistryPipelineSlug(h.pipeline ?? '');
      const m = h.model_id?.trim();
      if (!p || !m) {
        continue;
      }
      keysThisRow.add(`${p}/${m}`);
    }
    for (const k of priceByCapKey.keys()) {
      keysThisRow.add(k);
    }

    for (const key of keysThisRow) {
      const price = priceByCapKey.get(key);
      const cur = disc.caps.get(key);
      disc.caps.set(key, mergeCapFreshness(cur, ls, price));
    }
  }

  let listedCount = 0;
  for (const uris of urisByAddress.values()) {
    if (hasNonBlankServiceUri(uris)) {
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
  for (const agg of discoveryByAddress.values()) {
    if (!hasNonBlankServiceUri(agg.uris)) {
      continue;
    }
    if (agg.canonicalUri.length === 0) {
      const first = agg.uris.find((u) => u.trim().length > 0);
      if (first) {
        agg.canonicalUri = first.trim();
      }
    }
    const entry = discoveryEntryFromAgg(agg);
    if (entry) {
      discoveryList.push(entry);
    }
  }
  discoveryList.sort((a, b) => a.address.localeCompare(b.address));

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
