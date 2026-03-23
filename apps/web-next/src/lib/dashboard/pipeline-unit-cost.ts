/**
 * Pipeline unit cost from ClickHouse `network_capabilities` events.
 *
 * Env (server-only): CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD
 */

import type { DashboardPipelinePricing } from '@naap/plugin-sdk';

const PIPELINE_UNIT_COST_SQL = `
SELECT
    address,
    orch_uri,
    capability,
    constraint,
    avg(price) AS avg_price,
    avg(pixels_per_unit) AS avg_pixels_per_unit,
    count() AS row_count
FROM
(
    SELECT
        timestamp,
        JSONExtractString(toString(node), 'address') AS address,
        JSONExtractString(toString(node), 'orch_uri') AS orch_uri,
        JSONExtractInt(toString(cp), 'capability') AS capability,
        JSONExtractString(toString(cp), 'constraint') AS constraint,
        JSONExtractInt(toString(cp), 'pricePerUnit') AS price,
        JSONExtractInt(toString(cp), 'pixelsPerUnit') AS pixels_per_unit
    FROM
    (
        SELECT
            timestamp,
            arrayJoin(JSONExtract(toString(data), 'Array(JSON)')) AS node
        FROM "network_events"."network_events"
        WHERE type = 'network_capabilities'
          AND isValidJSON(toString(data))
        LIMIT 5000
    ) t
    ARRAY JOIN JSONExtract(toString(node), 'capabilities_prices', 'Array(JSON)') AS cp
) subq
GROUP BY
    address,
    orch_uri,
    capability,
    constraint
ORDER BY
    orch_uri ASC,
    capability ASC,
    constraint ASC
FORMAT JSON
`.trim();

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

/** On-chain capability id → pipeline id used elsewhere in the dashboard. */
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

export async function fetchPipelineUnitCostFromClickHouse(): Promise<DashboardPipelinePricing[]> {
  const baseUrl = process.env.CLICKHOUSE_URL?.trim();
  const user = process.env.CLICKHOUSE_USER?.trim();
  const password = process.env.CLICKHOUSE_PASSWORD?.trim();

  if (!baseUrl || !user || !password) {
    return [];
  }

  const url = `${baseUrl.replace(/\/$/, '')}/`;
  const auth = Buffer.from(`${user}:${password}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body: PIPELINE_UNIT_COST_SQL,
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[pipeline-unit-cost] ClickHouse HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`
    );
  }

  const body = (await res.json()) as { data?: ClickHousePricingRow[] };
  const data = body.data;
  if (!Array.isArray(data)) {
    throw new Error('[pipeline-unit-cost] ClickHouse response missing data array');
  }

  return aggregatePipelineUnitCost(data);
}
