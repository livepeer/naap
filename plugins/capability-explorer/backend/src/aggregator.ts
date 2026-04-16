import { prisma } from '@naap/database';
import type {
  EnrichedCapability,
  HandlerContext,
  CapabilityCategory,
  CategoryInfo,
  ExplorerStats,
  ListCapabilitiesParams,
  CapabilityConnection,
} from './types.js';
import {
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  CAPABILITY_CATEGORIES,
} from './types.js';
import { getCached, setCached } from './cache.js';

const WARM_CACHE_TTL_MS = 60_000; // 60-second in-memory TTL
const WARM_CACHE_KEY = 'explorer:warm:capabilities';
const WARM_STATS_KEY = 'explorer:warm:stats';
const WARM_CATEGORIES_KEY = 'explorer:warm:categories';

/**
 * Load capabilities from the Postgres-backed warm cache.
 * 1. Check in-memory cache (60s TTL)
 * 2. If miss, read CapabilityMergedView from Postgres (~50ms)
 * 3. Populate in-memory cache
 * Never touches ClickHouse or HuggingFace.
 */
export async function getCapabilities(_ctx?: HandlerContext): Promise<EnrichedCapability[]> {
  const cached = getCached<EnrichedCapability[]>(WARM_CACHE_KEY);
  if (cached) return cached;

  const view = await prisma.capabilityMergedView.findUnique({
    where: { id: 'singleton' },
  });

  if (!view) return [];

  const capabilities = view.capabilities as unknown as EnrichedCapability[];
  setCached(WARM_CACHE_KEY, capabilities, WARM_CACHE_TTL_MS);

  if (view.stats) {
    setCached(WARM_STATS_KEY, view.stats as unknown as ExplorerStats, WARM_CACHE_TTL_MS);
  }
  if (view.categories) {
    setCached(WARM_CATEGORIES_KEY, view.categories as unknown as CategoryInfo[], WARM_CACHE_TTL_MS);
  }

  return capabilities;
}

export async function getCapability(
  id: string,
  ctx?: HandlerContext,
): Promise<EnrichedCapability | null> {
  const all = await getCapabilities(ctx);
  return all.find((c) => c.id === id) ?? null;
}

export function filterCapabilities(
  caps: EnrichedCapability[],
  params: ListCapabilitiesParams,
): CapabilityConnection {
  let filtered = [...caps];

  if (params.category) {
    filtered = filtered.filter((c) => c.category === params.category);
  }

  if (params.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.models.some((m) => m.modelId.toLowerCase().includes(q)),
    );
  }

  if (params.minGpuCount !== undefined) {
    filtered = filtered.filter((c) => c.gpuCount >= params.minGpuCount!);
  }
  if (params.maxPriceUsd !== undefined) {
    filtered = filtered.filter(
      (c) => c.meanPriceUsd === null || c.meanPriceUsd <= params.maxPriceUsd!,
    );
  }
  if (params.minCapacity !== undefined) {
    filtered = filtered.filter((c) => c.totalCapacity >= params.minCapacity!);
  }

  const sortBy = params.sortBy || 'name';
  const sortOrder = params.sortOrder || 'asc';
  const multiplier = sortOrder === 'desc' ? -1 : 1;

  filtered.sort((a, b) => {
    switch (sortBy) {
      case 'gpuCount':
        return (a.gpuCount - b.gpuCount) * multiplier;
      case 'price':
        return ((a.meanPriceUsd ?? Infinity) - (b.meanPriceUsd ?? Infinity)) * multiplier;
      case 'latency':
        return ((a.avgLatencyMs ?? Infinity) - (b.avgLatencyMs ?? Infinity)) * multiplier;
      case 'capacity':
        return (a.totalCapacity - b.totalCapacity) * multiplier;
      default:
        return a.name.localeCompare(b.name) * multiplier;
    }
  });

  const total = filtered.length;
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 50;
  const items = filtered.slice(offset, offset + limit);

  return {
    items,
    total,
    hasMore: offset + limit < total,
  };
}

export async function getCategories(ctx?: HandlerContext): Promise<CategoryInfo[]> {
  const cached = getCached<CategoryInfo[]>(WARM_CATEGORIES_KEY);
  if (cached) return cached;

  const all = await getCapabilities(ctx);
  const counts = new Map<CapabilityCategory, number>();

  for (const cap of all) {
    counts.set(cap.category, (counts.get(cap.category) || 0) + 1);
  }

  const categories = CAPABILITY_CATEGORIES
    .filter((cat) => (counts.get(cat) || 0) > 0)
    .map((cat) => ({
      id: cat,
      label: CATEGORY_LABELS[cat],
      count: counts.get(cat) || 0,
      icon: CATEGORY_ICONS[cat],
    }));

  setCached(WARM_CATEGORIES_KEY, categories, WARM_CACHE_TTL_MS);
  return categories;
}

export async function getStats(ctx?: HandlerContext): Promise<ExplorerStats> {
  const cached = getCached<ExplorerStats>(WARM_STATS_KEY);
  if (cached) return cached;

  const all = await getCapabilities(ctx);

  const totalModels = all.reduce((sum, c) => sum + c.models.length, 0);
  const totalGpus = all.reduce((sum, c) => sum + c.gpuCount, 0);
  const totalOrchestrators = all.reduce((sum, c) => sum + c.orchestratorCount, 0);
  const prices = all.filter((c) => c.meanPriceUsd !== null).map((c) => c.meanPriceUsd!);
  const avgPriceUsd = prices.length > 0
    ? prices.reduce((a, b) => a + b, 0) / prices.length
    : null;

  const stats: ExplorerStats = {
    totalCapabilities: all.length,
    totalModels,
    totalGpus,
    totalOrchestrators,
    avgPriceUsd,
  };

  setCached(WARM_STATS_KEY, stats, WARM_CACHE_TTL_MS);
  return stats;
}

export async function getFilters(
  _ctx?: HandlerContext,
): Promise<{ categories: CapabilityCategory[]; capabilities: string[] }> {
  const all = await getCapabilities(_ctx);
  const capabilities = all.map((c) => c.id);
  const categories = [...new Set(all.map((c) => c.category))];
  return { categories, capabilities };
}
