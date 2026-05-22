/**
 * Source Adapter: NaaP Dashboard Pricing API
 *
 * Fetches from https://naap-api.cloudspe.com/v1/dashboard/pricing
 * via the gateway proxy. Returns per-orchestrator pricing (wei/unit)
 * keyed by ethAddress, along with pipeline/model and warmth status.
 */

import type { SourceAdapter, FetchCtx, SourceFetchResult, NormalizedOrch } from './types';

const GW_PATH = '/api/v1/gw/naap-pricing/pricing';

function resolveUrl(requestUrl?: string): string {
  const origin =
    (requestUrl ? new URL(requestUrl).origin : undefined) ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    'http://localhost:3000';
  return new URL(GW_PATH, origin).toString();
}

function buildHeaders(ctx: FetchCtx): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ctx.authToken}`,
  };
  if (ctx.cookieHeader) headers['cookie'] = ctx.cookieHeader;
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypassSecret) headers['x-vercel-protection-bypass'] = bypassSecret;
  return headers;
}

interface PricingRow {
  orchAddress: string;
  orchName: string;
  pipeline: string;
  model: string;
  priceWeiPerUnit: number;
  pixelsPerUnit: number;
  isWarm: boolean;
}

export const naapPricingAdapter: SourceAdapter = {
  kind: 'naap-pricing',

  async fetchAll(ctx: FetchCtx): Promise<SourceFetchResult> {
    const t0 = Date.now();
    const url = resolveUrl(ctx.requestUrl);

    const res = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(ctx),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Pricing API failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const rawRows: PricingRow[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
        ? json.data
        : [];

    const rows: NormalizedOrch[] = rawRows.map((r) => ({
      ethAddress: r.orchAddress.toLowerCase(),
      orchUri: undefined,
      pricePerUnit: r.priceWeiPerUnit,
      pipeline: r.pipeline,
      model: r.model,
      isWarm: r.isWarm,
      capabilities: [`${r.model}`],
    }));

    return {
      rows,
      raw: rawRows,
      stats: { ok: true, fetched: rows.length, durationMs: Date.now() - t0 },
    };
  },
};
