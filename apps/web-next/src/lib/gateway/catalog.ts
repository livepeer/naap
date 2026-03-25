/**
 * Service Gateway — Tool Catalog Builder
 *
 * Builds a structured catalog of tools (connectors + endpoints) for
 * agent discovery. Supports native, OpenAI, and MCP output formats.
 */

import { prisma } from '@/lib/db';
import { summarizeMetricsForDescriptor } from './metrics';

// ── Types ──

export interface EndpointDescriptor {
  name: string;
  description: string;
  method: string;
  path: string;
  inputSchema?: object;
  outputSchema?: object;
  rateLimit?: number;
  timeout?: number;
  streaming: boolean;
  examples?: EndpointExample[];
}

export interface EndpointExample {
  description: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface CapabilityRanking {
  category: string;
  modelName?: string;
  qualityRank: number;
  qualityScore?: number;
  speedRank?: number;
  costEfficiencyRank?: number;
  totalRanked: number;
  benchmarkSource?: string;
  benchmarkScore?: number;
  benchmarkUrl?: string;
  capabilityTags: string[];
  notes?: string;
}

export interface PerformanceMetrics {
  errorRate: number;
  successRate: number;
  latencyMeanMs: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
  upstreamLatencyMeanMs: number;
  gatewayOverheadMs: number;
  availabilityPercent: number;
  throughputRpm: number;
  period: '1h' | '24h' | '7d';
  sampleSize: number;
}

export interface ToolDescriptor {
  name: string;
  displayName: string;
  description: string;
  agentDescription?: string;
  agentNotFor?: string;
  category: string;
  tags: string[];
  status: string;
  endpoints: EndpointDescriptor[];
  pricing: PricingSummary | null;
  performance: PerformanceMetrics | null;
  rankings: CapabilityRanking[];
  auth: { type: string; headerName: string; prefix: string };
  baseUrl: string;
  healthStatus: string;
}

interface PricingSummary {
  billingModel: string;
  costPerUnit: number;
  unit: string;
  currency: string;
  freeQuota?: number;
  volumeTiers?: unknown[];
  featurePricing?: unknown[];
  upstreamCost?: { costPerUnit: number; unit: string; notes?: string } | null;
}

interface CatalogOptions {
  category?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Build a paginated tool catalog from all published connectors in scope.
 */
export async function buildToolCatalog(
  teamId: string,
  options?: CatalogOptions
): Promise<{ tools: ToolDescriptor[]; total: number }> {
  const { category, page = 1, pageSize = 50 } = options || {};
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {
    status: 'published',
    OR: [{ visibility: 'public' }, { teamId }],
  };
  if (category) where.category = category;

  const [connectors, total] = await Promise.all([
    prisma.serviceConnector.findMany({
      where,
      include: {
        endpoints: { where: { enabled: true }, orderBy: { createdAt: 'asc' } },
        pricing: true,
        healthChecks: { orderBy: { checkedAt: 'desc' }, take: 1 },
        metrics: { where: { period: 'hourly' }, orderBy: { periodStart: 'desc' }, take: 1 },
        rankings: { orderBy: { qualityRank: 'asc' } },
      },
      orderBy: { displayName: 'asc' },
      skip,
      take: pageSize,
    }),
    prisma.serviceConnector.count({ where }),
  ]);

  const baseUrl = '/api/v1/gw';

  const tools = connectors.map((c) => buildToolDescriptor(c, baseUrl));

  return { tools, total };
}

/**
 * Build a single tool descriptor for a connector with all its relations.
 */
export function buildToolDescriptor(
  connector: {
    slug: string;
    displayName: string;
    description: string | null;
    agentDescription?: string | null;
    agentNotFor?: string | null;
    inputSchema?: unknown;
    outputSchema?: unknown;
    category: string;
    tags: string[];
    status: string;
    authType: string;
    streamingEnabled: boolean;
    endpoints: Array<{
      name: string;
      description: string | null;
      method: string;
      path: string;
      bodySchema: unknown;
      requiredHeaders: string[];
      rateLimit: number | null;
      timeout: number | null;
      examples?: unknown;
    }>;
    pricing?: {
      costPerUnit: number;
      unit: string;
      currency: string;
      billingModel: string;
      freeQuota: number | null;
      volumeTiers: unknown;
      featurePricing: unknown;
      upstreamCostPerUnit: number | null;
      upstreamUnit: string | null;
      upstreamNotes: string | null;
    } | null;
    healthChecks?: Array<{ status: string }>;
    metrics?: Array<Record<string, unknown>>;
    rankings?: Array<{
      category: string;
      modelName: string | null;
      qualityRank: number;
      qualityScore: number | null;
      speedRank: number | null;
      costEfficiencyRank: number | null;
      totalRanked: number;
      benchmarkSource: string | null;
      benchmarkScore: number | null;
      benchmarkUrl?: string | null;
      capabilityTags: string[];
      notes: string | null;
    }>;
  },
  baseUrl: string
): ToolDescriptor {
  const endpoints: EndpointDescriptor[] = connector.endpoints.map((ep) => {
    const inputSchema = (ep.bodySchema as object) || (connector.inputSchema as object) || undefined;
    const outputSchema = (connector.outputSchema as object) || undefined;
    const examples = Array.isArray(ep.examples) ? (ep.examples as EndpointExample[]) : undefined;

    return {
      name: ep.name,
      description: ep.description || '',
      method: ep.method,
      path: ep.path,
      ...(inputSchema ? { inputSchema } : {}),
      ...(outputSchema ? { outputSchema } : {}),
      ...(ep.rateLimit ? { rateLimit: ep.rateLimit } : {}),
      ...(ep.timeout ? { timeout: ep.timeout } : {}),
      streaming: connector.streamingEnabled,
      ...(examples ? { examples } : {}),
    };
  });

  const pricing = connector.pricing
    ? {
        billingModel: connector.pricing.billingModel,
        costPerUnit: connector.pricing.costPerUnit,
        unit: connector.pricing.unit,
        currency: connector.pricing.currency,
        ...(connector.pricing.freeQuota != null ? { freeQuota: connector.pricing.freeQuota } : {}),
        volumeTiers: connector.pricing.volumeTiers as unknown[],
        featurePricing: connector.pricing.featurePricing as unknown[],
        ...(connector.pricing.upstreamCostPerUnit != null
          ? {
              upstreamCost: {
                costPerUnit: connector.pricing.upstreamCostPerUnit,
                unit: connector.pricing.upstreamUnit || connector.pricing.unit,
                ...(connector.pricing.upstreamNotes ? { notes: connector.pricing.upstreamNotes } : {}),
              },
            }
          : {}),
      }
    : null;

  const healthStatus = connector.healthChecks?.[0]?.status || 'unknown';

  const performance = connector.metrics?.[0]
    ? summarizeMetricsForDescriptor(connector.metrics[0])
    : null;

  const rankings: CapabilityRanking[] = (connector.rankings || []).map((r) => ({
    category: r.category,
    ...(r.modelName ? { modelName: r.modelName } : {}),
    qualityRank: r.qualityRank,
    ...(r.qualityScore != null ? { qualityScore: r.qualityScore } : {}),
    ...(r.speedRank != null ? { speedRank: r.speedRank } : {}),
    ...(r.costEfficiencyRank != null ? { costEfficiencyRank: r.costEfficiencyRank } : {}),
    totalRanked: r.totalRanked,
    ...(r.benchmarkSource ? { benchmarkSource: r.benchmarkSource } : {}),
    ...(r.benchmarkScore != null ? { benchmarkScore: r.benchmarkScore } : {}),
    ...(r.benchmarkUrl ? { benchmarkUrl: r.benchmarkUrl } : {}),
    capabilityTags: r.capabilityTags,
    ...(r.notes ? { notes: r.notes } : {}),
  }));

  const authInfo = {
    type: connector.authType === 'none' ? 'none' : 'bearer',
    headerName: 'Authorization',
    prefix: 'Bearer',
  };

  return {
    name: connector.slug,
    displayName: connector.displayName,
    description: connector.description || '',
    ...(connector.agentDescription ? { agentDescription: connector.agentDescription } : {}),
    ...(connector.agentNotFor ? { agentNotFor: connector.agentNotFor } : {}),
    category: connector.category,
    tags: connector.tags,
    status: connector.status,
    endpoints,
    pricing,
    performance,
    rankings,
    auth: authInfo,
    baseUrl: `${baseUrl}/${connector.slug}`,
    healthStatus,
  };
}
