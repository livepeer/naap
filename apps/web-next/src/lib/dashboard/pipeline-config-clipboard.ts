import type { DashboardPipelinePricing } from '@naap/plugin-sdk';

const ONE_GWEI_WEI = 10n ** 9n;
const ONE_ETH_WEI = 10n ** 18n;

/** Tab-separated pipeline id and model id (developer-friendly paste into sheets / env). */
export function buildPipelineModelCopyText(pipelineId: string, modelId: string): string {
  return `${pipelineId}\t${modelId}`;
}

/**
 * Canonical wei string for clipboard: prefer lossless API string when present;
 * else same rounding as UI (`Math.round(price * 1e12)`), which can lose precision for huge integers.
 */
export function weiPerUnitString(pricing: DashboardPipelinePricing | undefined): string {
  if (!pricing || !(pricing.price > 0)) return '';
  const s = pricing.avgWeiPerUnit?.trim();
  if (s) return s;
  return String(Math.round(pricing.price * 1e12));
}

/**
 * Include gwei only when wei is in a readable band: ≥ 1 gwei and &lt; 1 ETH in wei
 * (so gwei is ≥ 1 and &lt; 1e9).
 */
export function gweiPerUnitIfNominal(weiPerUnitStr: string): number | undefined {
  const w = weiPerUnitStr.trim();
  if (!w || !/^\d+$/.test(w)) return undefined;
  let wei: bigint;
  try {
    wei = BigInt(w);
  } catch {
    return undefined;
  }
  if (wei < ONE_GWEI_WEI || wei >= ONE_ETH_WEI) return undefined;
  return Number(wei) / 1e9;
}

export type PipelineModelConfigClipboard = Record<string, unknown>;

export function buildPipelineModelConfigJson(input: {
  pipelineId: string;
  modelId: string;
  pricing: DashboardPipelinePricing | undefined;
  capacity: number | '—';
}): PipelineModelConfigClipboard {
  const { pipelineId, modelId, pricing, capacity } = input;
  const base: PipelineModelConfigClipboard = {
    pipeline: pipelineId,
    model_id: modelId,
  };
  if (pricing?.unit) {
    base.unit = pricing.unit;
  }
  if (pricing?.pixelsPerUnit != null && Number.isFinite(pricing.pixelsPerUnit)) {
    base.pixels_per_unit = pricing.pixelsPerUnit;
  }
  if (capacity !== '—' && typeof capacity === 'number') {
    base.capacity = capacity;
  }
  const wei = weiPerUnitString(pricing);
  if (wei) {
    base.wei_per_unit = wei;
    const gwei = gweiPerUnitIfNominal(wei);
    if (gwei !== undefined) {
      base.gwei_per_unit = gwei;
    }
  }
  return base;
}

export function formatPipelineModelConfigJson(config: PipelineModelConfigClipboard): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}
