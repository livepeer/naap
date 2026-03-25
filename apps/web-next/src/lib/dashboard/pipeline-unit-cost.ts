/**
 * Pipeline unit cost from ClickHouse `network_capabilities` events.
 *
 * Fetches raw rows via the `livepeer-naap-analytics` managed connector in the
 * Service Gateway, then aggregates into the DashboardPipelinePricing shape.
 *
 * Caching is handled by the gateway's per-endpoint cacheTtl (300s).
 */

import type { DashboardPipelinePricing } from '@naap/plugin-sdk';
import { queryManagedConnector } from '@/lib/gateway/internal-client';

export const PIPELINE_UNIT_COST_TTL_SECONDS = 5 * 60;

const CONNECTOR_SLUG = 'livepeer-naap-analytics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClickHousePricingRow {
  address: string;
  orch_uri: string;
  capability: string | number;
  constraint: string;
  avg_price: number;
  avg_pixels_per_unit: number;
  row_count: string | number;
}

function num(v: string | number | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

/** On-chain capability id -> pipeline id used elsewhere in the dashboard. */
const CAPABILITY_PIPELINE_LABEL: Record<string, string> = {
  '35': 'live-video-to-video',
};

export function capabilityToPipelineLabel(capability: string): string {
  return CAPABILITY_PIPELINE_LABEL[capability] ?? `cap ${capability}`;
}

/**
 * Weighted averages by (constraint, capability) across orchestrators.
 */
export function aggregatePipelineUnitCost(rows: ClickHousePricingRow[]): DashboardPipelinePricing[] {
  type Acc = { weight: number; priceSum: number; pixelsSum: number };
  const groups = new Map<string, Acc>();

  for (const r of rows) {
    const w = num(r.row_count);
    if (w <= 0) continue;
    const key = `${r.constraint}\0${String(r.capability)}`;
    const g = groups.get(key) ?? { weight: 0, priceSum: 0, pixelsSum: 0 };
    g.weight += w;
    g.priceSum += num(r.avg_price) * w;
    g.pixelsSum += num(r.avg_pixels_per_unit) * w;
    groups.set(key, g);
  }

  const out: DashboardPipelinePricing[] = [];

  for (const [key, g] of groups) {
    const [constraint, cap] = key.split('\0');
    const avgPrice = g.weight > 0 ? g.priceSum / g.weight : 0;
    const avgPx = g.weight > 0 ? g.pixelsSum / g.weight : 0;
    out.push({
      pipeline: constraint,
      unit: capabilityToPipelineLabel(cap),
      /** Weighted avg pricePerUnit (wei). */
      price: Math.round(avgPrice * 1000) / 1000,
      pixelsPerUnit: avgPx > 0 ? Math.round(avgPx * 1000) / 1000 : null,
      outputPerDollar: '—',
    });
  }

  out.sort((a, b) => a.pipeline.localeCompare(b.pipeline) || a.unit.localeCompare(b.unit));
  return out;
}

// ---------------------------------------------------------------------------
// Fetch via managed connector
// ---------------------------------------------------------------------------

export async function fetchPipelineUnitCostFromClickHouse(): Promise<DashboardPipelinePricing[]> {
  const t0 = Date.now();

  let response: Response;
  try {
    response = await queryManagedConnector(CONNECTOR_SLUG, '/pricing');
  } catch (err) {
    console.warn('[pipeline-unit-cost] Managed connector query failed:', err);
    return [];
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `[pipeline-unit-cost] ClickHouse HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`
    );
  }

  const body = (await response.json()) as { data?: ClickHousePricingRow[] };
  const data = body.data;
  if (!Array.isArray(data)) {
    throw new Error('[pipeline-unit-cost] ClickHouse response missing data array');
  }

  const result = aggregatePipelineUnitCost(data);
  console.log(`[pipeline-unit-cost] fetched ${data.length} rows → ${result.length} aggregated in ${Date.now() - t0}ms`);
  return result;
}
