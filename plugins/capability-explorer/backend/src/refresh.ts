import { prisma, Prisma } from '@naap/database';
import type { EnrichedCapability, EnrichedModel, CategoryInfo, ExplorerStats, CapabilityCategory } from './types.js';
import { CATEGORY_LABELS, CATEGORY_ICONS, CAPABILITY_CATEGORIES } from './types.js';
import type { SourceContext, PartialCapability, CapabilityDataSource } from './sources/interface.js';
import { ensureDefaultSources, getCoreSources, getEnrichmentSources, HuggingFaceSource } from './sources/index.js';

export interface RefreshResult {
  refreshedAt: string;
  sources: Array<{ id: string; status: string; count: number; durationMs: number; error?: string }>;
  totalCapabilities: number;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

const DEFAULT_REFRESH_INTERVALS: Record<string, number> = {
  clickhouse: 4,
  'onchain-registry': 12,
  'naap-orchestrators': 4,
  huggingface: 4,
};

function deduplicateModels(
  existing: EnrichedModel[] | undefined,
  incoming: EnrichedModel[] | undefined,
): EnrichedModel[] {
  if (!existing?.length) return incoming ?? [];
  if (!incoming?.length) return existing;
  const seen = new Map<string, EnrichedModel>();
  for (const m of existing) seen.set(m.modelId, m);
  for (const m of incoming) {
    if (!seen.has(m.modelId)) seen.set(m.modelId, m);
  }
  return Array.from(seen.values());
}

function mergePartials(
  base: Map<string, Partial<EnrichedCapability>>,
  partials: PartialCapability[],
): void {
  for (const p of partials) {
    const existing = base.get(p.id);
    if (!existing) {
      base.set(p.id, { ...p.fields });
      continue;
    }

    const existingUris = new Set(existing._orchestratorUris ?? []);
    const newUris = p.fields._orchestratorUris ?? [];
    for (const uri of newUris) existingUris.add(uri);

    const mergedModels = deduplicateModels(existing.models, p.fields.models);

    const hasUriTracking = existingUris.size > 0;

    base.set(p.id, {
      ...existing,
      ...p.fields,
      _orchestratorUris: hasUriTracking ? Array.from(existingUris) : undefined,
      orchestratorCount: hasUriTracking
        ? existingUris.size
        : Math.max(existing.orchestratorCount ?? 0, p.fields.orchestratorCount ?? 0),
      models: mergedModels,
      avgLatencyMs: existing.avgLatencyMs ?? p.fields.avgLatencyMs,
      meanPriceUsd: existing.meanPriceUsd ?? p.fields.meanPriceUsd,
      minPriceUsd: existing.minPriceUsd ?? p.fields.minPriceUsd,
      maxPriceUsd: existing.maxPriceUsd ?? p.fields.maxPriceUsd,
    });
  }
}

function stripTransientFields(cap: EnrichedCapability): EnrichedCapability {
  const { _orchestratorUris, ...clean } = cap;
  return clean;
}

async function isSourceRefreshDue(
  sourceId: string,
  intervalHours: number,
): Promise<boolean> {
  const latest = await prisma.capabilitySnapshot.findFirst({
    where: { sourceId, status: { in: ['success', 'partial'] } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (!latest) return true;
  return Date.now() - latest.createdAt.getTime() > intervalHours * 3_600_000;
}

async function loadCachedSnapshot(sourceId: string): Promise<PartialCapability[]> {
  const latest = await prisma.capabilitySnapshot.findFirst({
    where: { sourceId, status: { in: ['success', 'partial'] } },
    orderBy: { createdAt: 'desc' },
    select: { data: true },
  });
  if (!latest?.data) return [];
  return latest.data as unknown as PartialCapability[];
}

async function fetchOrUseCachedSnapshot(
  source: CapabilityDataSource,
  ctx: SourceContext,
  refreshIntervals: Record<string, number>,
  force = false,
): Promise<{
  result: { capabilities: PartialCapability[]; status: string; durationMs: number; errorMessage?: string };
  fromCache: boolean;
}> {
  const intervalHours = refreshIntervals[source.id] ?? DEFAULT_REFRESH_INTERVALS[source.id] ?? 4;
  const due = force || await isSourceRefreshDue(source.id, intervalHours);

  if (!due) {
    const start = Date.now();
    const cached = await loadCachedSnapshot(source.id);
    return {
      result: {
        capabilities: cached,
        status: 'cached',
        durationMs: Date.now() - start,
      },
      fromCache: true,
    };
  }

  const result = await source.fetch(ctx);
  return { result, fromCache: false };
}

function computeStats(caps: EnrichedCapability[]): ExplorerStats {
  const totalModels = caps.reduce((sum, c) => sum + c.models.length, 0);
  const totalGpus = caps.reduce((sum, c) => sum + c.gpuCount, 0);
  const totalOrchestrators = caps.reduce((sum, c) => sum + c.orchestratorCount, 0);
  const prices = caps.filter((c) => c.meanPriceUsd !== null).map((c) => c.meanPriceUsd!);
  const avgPriceUsd = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;

  return { totalCapabilities: caps.length, totalModels, totalGpus, totalOrchestrators, avgPriceUsd };
}

function computeCategories(caps: EnrichedCapability[]): CategoryInfo[] {
  const counts = new Map<CapabilityCategory, number>();
  for (const cap of caps) {
    counts.set(cap.category, (counts.get(cap.category) || 0) + 1);
  }
  return CAPABILITY_CATEGORIES
    .filter((cat) => (counts.get(cat) || 0) > 0)
    .map((cat) => ({
      id: cat,
      label: CATEGORY_LABELS[cat],
      count: counts.get(cat) || 0,
      icon: CATEGORY_ICONS[cat],
    }));
}

/**
 * Run all enabled sources, merge core + enrichment results, and
 * persist to CapabilityMergedView + CapabilitySnapshot.
 *
 * Slow sources (like on-chain registry) use per-source refresh intervals:
 * if their last snapshot is still within interval, the cached snapshot is
 * merged instead of re-fetching, keeping the cron cycle fast.
 */
export async function refreshCapabilities(ctx: SourceContext, opts?: { force?: boolean }): Promise<RefreshResult> {
  const force = opts?.force ?? false;
  ensureDefaultSources();

  const config = await prisma.capabilityExplorerConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      enabledSources: {
        clickhouse: true,
        'onchain-registry': true,
        'naap-orchestrators': true,
        huggingface: true,
      },
    },
  });

  const enabledMap = (config.enabledSources as Record<string, boolean>) ?? {};
  const refreshIntervals = (config as unknown as { refreshIntervals?: Record<string, number> })
    .refreshIntervals ?? {};
  const sourceResults: RefreshResult['sources'] = [];
  const merged = new Map<string, Partial<EnrichedCapability>>();

  // Phase 1: run core sources (with per-source caching for slow ones)
  const coreSources = getCoreSources(enabledMap);
  for (const source of coreSources) {
    const { result, fromCache } = await fetchOrUseCachedSnapshot(source, ctx, refreshIntervals, force);
    mergePartials(merged, result.capabilities);

    if (!fromCache) {
      await prisma.capabilitySnapshot.create({
        data: {
          sourceId: source.id,
          data: toJsonValue(result.capabilities),
          status: result.status,
          errorMessage: result.errorMessage ?? null,
          durationMs: result.durationMs,
        },
      });
    }

    sourceResults.push({
      id: source.id,
      status: fromCache ? 'cached' : result.status,
      count: result.capabilities.length,
      durationMs: result.durationMs,
      error: result.errorMessage,
    });
  }

  // Phase 2: run enrichment sources with merged core data
  const enrichmentSources = getEnrichmentSources(enabledMap);
  for (const source of enrichmentSources) {
    if (source instanceof HuggingFaceSource) {
      source.setCapabilitiesToEnrich(Array.from(merged.values()));
    }

    const { result, fromCache } = await fetchOrUseCachedSnapshot(source, ctx, refreshIntervals, force);
    mergePartials(merged, result.capabilities);

    if (!fromCache) {
      await prisma.capabilitySnapshot.create({
        data: {
          sourceId: source.id,
          data: toJsonValue(result.capabilities),
          status: result.status,
          errorMessage: result.errorMessage ?? null,
          durationMs: result.durationMs,
        },
      });
    }

    sourceResults.push({
      id: source.id,
      status: fromCache ? 'cached' : result.status,
      count: result.capabilities.length,
      durationMs: result.durationMs,
      error: result.errorMessage,
    });
  }

  // Build final capabilities array with defaults, then strip transient fields
  const capabilities: EnrichedCapability[] = Array.from(merged.entries()).map(([id, fields]) =>
    stripTransientFields({
      id,
      name: fields.name || id,
      category: fields.category || 'other',
      source: fields.source || 'unknown',
      version: fields.version || '1.0',
      description: fields.description || '',
      modelSourceUrl: fields.modelSourceUrl || '',
      thumbnail: fields.thumbnail ?? null,
      license: fields.license ?? null,
      tags: fields.tags || [],
      gpuCount: fields.gpuCount || 0,
      totalCapacity: fields.totalCapacity || 0,
      orchestratorCount: fields.orchestratorCount || 0,
      avgLatencyMs: fields.avgLatencyMs ?? null,
      avgFps: fields.avgFps ?? null,
      meanPriceUsd: fields.meanPriceUsd ?? null,
      minPriceUsd: fields.minPriceUsd ?? null,
      maxPriceUsd: fields.maxPriceUsd ?? null,
      priceUnit: fields.priceUnit || 'pixel',
      sdkSnippet: fields.sdkSnippet || { curl: '', python: '', javascript: '' },
      models: fields.models || [],
      lastUpdated: new Date().toISOString(),
      _orchestratorUris: fields._orchestratorUris,
    }),
  );

  const hasErrors = sourceResults.some((s) => s.status === 'error');
  if (capabilities.length === 0 && hasErrors) {
    console.warn('[capability-explorer] All sources failed or returned empty — preserving existing data');
    await prisma.capabilityExplorerConfig.update({
      where: { id: 'default' },
      data: {
        lastRefreshAt: new Date(),
        lastRefreshStatus: 'error',
      },
    });
    return {
      refreshedAt: new Date().toISOString(),
      sources: sourceResults,
      totalCapabilities: 0,
    };
  }

  const stats = computeStats(capabilities);
  const categories = computeCategories(capabilities);
  const sourceIds = sourceResults.map((s) => s.id);

  await prisma.capabilityMergedView.upsert({
    where: { id: 'singleton' },
    update: {
      capabilities: toJsonValue(capabilities),
      stats: toJsonValue(stats),
      categories: toJsonValue(categories),
      mergedAt: new Date(),
      sourceIds,
    },
    create: {
      id: 'singleton',
      capabilities: toJsonValue(capabilities),
      stats: toJsonValue(stats),
      categories: toJsonValue(categories),
      sourceIds,
    },
  });

  await prisma.capabilityExplorerConfig.update({
    where: { id: 'default' },
    data: {
      lastRefreshAt: new Date(),
      lastRefreshStatus: sourceResults.every((s) => s.status === 'success' || s.status === 'cached')
        ? 'success'
        : 'partial',
    },
  });

  return {
    refreshedAt: new Date().toISOString(),
    sources: sourceResults,
    totalCapabilities: capabilities.length,
  };
}

/**
 * Check if a refresh is due based on configured interval.
 */
export async function isRefreshDue(): Promise<boolean> {
  const config = await prisma.capabilityExplorerConfig.findUnique({ where: { id: 'default' } });
  if (!config || !config.lastRefreshAt) return true;

  const intervalMs = (config.refreshIntervalHours ?? 4) * 3_600_000;
  return Date.now() - config.lastRefreshAt.getTime() > intervalMs;
}
