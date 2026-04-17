/**
 * Shared orchestrator inventory — streaming + requests (OpenAPI v1).
 *
 * Merges GET /v1/streaming/orchestrators and GET /v1/requests/orchestrators into
 * the same NetOrchestratorData shape the KPI and orchestrator table used with
 * legacy GET /v1/net/orchestrators.
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

interface DashboardPipelineModelOffer {
  pipelineId: string;
  modelIds: string[];
}

interface StreamingOrchestratorRow {
  address?: string;
  uri?: string;
  models?: string[];
  gpu_count?: number;
  last_seen?: string;
}

interface RequestsOrchestratorRow {
  address?: string;
  uri?: string;
  capabilities?: string[];
  gpu_count?: number;
  last_seen?: string;
}

function splitPipelineModel(s: string): { pipeline: string; model: string } | null {
  const t = s.trim();
  const idx = t.indexOf('/');
  if (idx <= 0 || idx >= t.length - 1) return null;
  return { pipeline: t.slice(0, idx).trim(), model: t.slice(idx + 1).trim() };
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

function offersFromStreamingModels(models: string[] | undefined): DashboardPipelineModelOffer[] {
  const LIVE = 'live-video-to-video';
  const byPipeline = new Map<string, Set<string>>();
  for (const raw of models ?? []) {
    const t = raw.trim();
    if (!t) continue;
    const sp = splitPipelineModel(t);
    if (sp) {
      let set = byPipeline.get(sp.pipeline);
      if (!set) {
        set = new Set();
        byPipeline.set(sp.pipeline, set);
      }
      set.add(sp.model);
    } else {
      let set = byPipeline.get(LIVE);
      if (!set) {
        set = new Set();
        byPipeline.set(LIVE, set);
      }
      set.add(t);
    }
  }
  return [...byPipeline.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pipelineId, modelSet]) => ({
      pipelineId,
      modelIds: [...modelSet].sort((a, b) => a.localeCompare(b)),
    }));
}

function offersFromRequestCapabilities(caps: string[] | undefined): DashboardPipelineModelOffer[] {
  const byPipeline = new Map<string, Set<string>>();
  for (const raw of caps ?? []) {
    const sp = splitPipelineModel(raw);
    if (!sp || !sp.pipeline || !sp.model) continue;
    let set = byPipeline.get(sp.pipeline);
    if (!set) {
      set = new Set();
      byPipeline.set(sp.pipeline, set);
    }
    set.add(sp.model);
  }
  return [...byPipeline.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pipelineId, modelSet]) => ({
      pipelineId,
      modelIds: [...modelSet].sort((a, b) => a.localeCompare(b)),
    }));
}

function parseLastSeenMs(raw: string | undefined): number | undefined {
  if (raw == null || typeof raw !== 'string') return undefined;
  const t = Date.parse(raw.trim());
  return Number.isFinite(t) ? t : undefined;
}

export interface NetOrchestratorData {
  activeCount: number;
  listedCount: number;
  urisByAddress: Map<string, string[]>;
  displayAddressByLower: Map<string, string>;
  hasLastSeenData: boolean;
  lastSeenMsByAddress: Map<string, number>;
  pipelineModelsByAddress: Map<string, DashboardPipelineModelOffer[]>;
}

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

async function fetchStreamingOrchestrators(): Promise<StreamingOrchestratorRow[]> {
  const revalidateSec = Math.floor(TTL.NET_MODELS / 1000);
  return naapGet<StreamingOrchestratorRow[]>('streaming/orchestrators', undefined, {
    next: { revalidate: revalidateSec },
    errorLabel: 'streaming-orchestrators',
  });
}

async function fetchRequestsOrchestrators(): Promise<RequestsOrchestratorRow[]> {
  const revalidateSec = Math.floor(TTL.NET_MODELS / 1000);
  return naapGet<RequestsOrchestratorRow[]>('requests/orchestrators', undefined, {
    next: { revalidate: revalidateSec },
    errorLabel: 'requests-orchestrators',
  });
}

function ingestRow(
  r: StreamingOrchestratorRow | RequestsOrchestratorRow,
  source: 'streaming' | 'requests',
  urisByAddress: Map<string, string[]>,
  displayAddressByLower: Map<string, string>,
  activeAddresses: Set<string>,
  lastSeenMsByAddress: Map<string, number>,
  pipelineModelsByAddress: Map<string, DashboardPipelineModelOffer[]>,
): { hasLastSeen: boolean } {
  const addrRaw = typeof r.address === 'string' ? r.address.trim() : '';
  if (!addrRaw) return { hasLastSeen: false };
  const addr = addrRaw.toLowerCase();
  if (!displayAddressByLower.has(addr)) {
    displayAddressByLower.set(addr, addrRaw);
  }

  const uri = typeof r.uri === 'string' ? r.uri.trim() : '';
  let uris = urisByAddress.get(addr);
  if (!uris) {
    uris = [];
    urisByAddress.set(addr, uris);
  }
  if (uri.length > 0 && !uris.includes(uri)) {
    uris.push(uri);
  }

  if (r.gpu_count != null && r.gpu_count > 0) {
    activeAddresses.add(addr);
  }

  let offers: DashboardPipelineModelOffer[] = [];
  if (source === 'streaming') {
    const sr = r as StreamingOrchestratorRow;
    offers = offersFromStreamingModels(sr.models);
  } else {
    const rr = r as RequestsOrchestratorRow;
    offers = offersFromRequestCapabilities(rr.capabilities);
  }
  if (offers.length > 0) {
    pipelineModelsByAddress.set(
      addr,
      mergePipelineModelOffers(pipelineModelsByAddress.get(addr), offers),
    );
  }

  const ls = parseLastSeenMs(r.last_seen);
  if (ls !== undefined) {
    const prev = lastSeenMsByAddress.get(addr);
    if (prev === undefined || ls > prev) {
      lastSeenMsByAddress.set(addr, ls);
    }
    return { hasLastSeen: true };
  }
  return { hasLastSeen: false };
}

export function getNetOrchestratorData(): Promise<NetOrchestratorData> {
  const cacheKey = 'facade:net-orchestrators:streaming+requests:v1';
  return cachedFetch(cacheKey, TTL.NET_MODELS, async () => {
    let streamRows: StreamingOrchestratorRow[] = [];
    let reqRows: RequestsOrchestratorRow[] = [];
    try {
      [streamRows, reqRows] = await Promise.all([
        fetchStreamingOrchestrators().catch(() => []),
        fetchRequestsOrchestrators().catch(() => []),
      ]);
    } catch {
      return EMPTY;
    }

    const urisByAddress = new Map<string, string[]>();
    const displayAddressByLower = new Map<string, string>();
    const activeAddresses = new Set<string>();
    const lastSeenMsByAddress = new Map<string, number>();
    const pipelineModelsByAddress = new Map<string, DashboardPipelineModelOffer[]>();
    let hasLastSeenData = false;

    for (const r of streamRows) {
      const { hasLastSeen } = ingestRow(
        r,
        'streaming',
        urisByAddress,
        displayAddressByLower,
        activeAddresses,
        lastSeenMsByAddress,
        pipelineModelsByAddress,
      );
      if (hasLastSeen) hasLastSeenData = true;
    }
    for (const r of reqRows) {
      const { hasLastSeen } = ingestRow(
        r,
        'requests',
        urisByAddress,
        displayAddressByLower,
        activeAddresses,
        lastSeenMsByAddress,
        pipelineModelsByAddress,
      );
      if (hasLastSeen) hasLastSeenData = true;
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
