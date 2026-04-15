import { prisma } from '@naap/database';
import type { EnrichedCapability, CategoryInfo, ExplorerStats, CapabilityCategory } from './types.js';
import { CATEGORY_LABELS, CATEGORY_ICONS, CAPABILITY_CATEGORIES } from './types.js';
import type { SourceContext, PartialCapability } from './sources/interface.js';
import { ensureDefaultSources, getCoreSources, getEnrichmentSources, HuggingFaceSource } from './sources/index.js';

export interface RefreshResult {
  refreshedAt: string;
  sources: Array<{ id: string; status: string; count: number; durationMs: number; error?: string }>;
  totalCapabilities: number;
}

function mergePartials(
  base: Map<string, Partial<EnrichedCapability>>,
  partials: PartialCapability[],
): void {
  for (const p of partials) {
    const existing = base.get(p.id) || {};
    base.set(p.id, { ...existing, ...p.fields });
  }
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
 */
export async function refreshCapabilities(ctx: SourceContext): Promise<RefreshResult> {
  ensureDefaultSources();

  const config = await prisma.capabilityExplorerConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', enabledSources: { clickhouse: true, huggingface: true } },
  });

  const enabledMap = (config.enabledSources as Record<string, boolean>) ?? {};
  const sourceResults: RefreshResult['sources'] = [];
  const merged = new Map<string, Partial<EnrichedCapability>>();

  // Phase 1: run core sources
  const coreSources = getCoreSources(enabledMap);
  for (const source of coreSources) {
    const result = await source.fetch(ctx);
    mergePartials(merged, result.capabilities);

    await prisma.capabilitySnapshot.create({
      data: {
        sourceId: source.id,
        data: result.capabilities as unknown as Record<string, unknown>,
        status: result.status,
        errorMessage: result.errorMessage ?? null,
        durationMs: result.durationMs,
      },
    });

    sourceResults.push({
      id: source.id,
      status: result.status,
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

    const result = await source.fetch(ctx);
    mergePartials(merged, result.capabilities);

    await prisma.capabilitySnapshot.create({
      data: {
        sourceId: source.id,
        data: result.capabilities as unknown as Record<string, unknown>,
        status: result.status,
        errorMessage: result.errorMessage ?? null,
        durationMs: result.durationMs,
      },
    });

    sourceResults.push({
      id: source.id,
      status: result.status,
      count: result.capabilities.length,
      durationMs: result.durationMs,
      error: result.errorMessage,
    });
  }

  // Build final capabilities array with defaults for missing fields
  const capabilities: EnrichedCapability[] = Array.from(merged.entries()).map(([id, fields]) => ({
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
    bestLatencyMs: fields.bestLatencyMs ?? null,
    avgFps: fields.avgFps ?? null,
    meanPriceUsd: fields.meanPriceUsd ?? null,
    minPriceUsd: fields.minPriceUsd ?? null,
    maxPriceUsd: fields.maxPriceUsd ?? null,
    priceUnit: fields.priceUnit || 'pixel',
    sdkSnippet: fields.sdkSnippet || { curl: '', python: '', javascript: '' },
    models: fields.models || [],
    lastUpdated: new Date().toISOString(),
  }));

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

  // Upsert the singleton merged view
  await prisma.capabilityMergedView.upsert({
    where: { id: 'singleton' },
    update: {
      capabilities: capabilities as unknown as Record<string, unknown>[],
      stats: stats as unknown as Record<string, unknown>,
      categories: categories as unknown as Record<string, unknown>[],
      mergedAt: new Date(),
      sourceIds,
    },
    create: {
      id: 'singleton',
      capabilities: capabilities as unknown as Record<string, unknown>[],
      stats: stats as unknown as Record<string, unknown>,
      categories: categories as unknown as Record<string, unknown>[],
      sourceIds,
    },
  });

  // Update config with refresh status
  await prisma.capabilityExplorerConfig.update({
    where: { id: 'default' },
    data: {
      lastRefreshAt: new Date(),
      lastRefreshStatus: sourceResults.every((s) => s.status === 'success') ? 'success' : 'partial',
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
