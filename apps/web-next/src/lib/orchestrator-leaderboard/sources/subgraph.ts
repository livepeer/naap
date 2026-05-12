/**
 * Source Adapter: Livepeer Subgraph (on-chain registry)
 *
 * Queries The Graph for all active transcoders. This is the ground-truth
 * membership source — returns ethAddress + serviceURI + activation status.
 */

import type { SourceAdapter, FetchCtx, SourceFetchResult, NormalizedOrch } from './types';

const GW_PATH = '/api/v1/gw/livepeer-subgraph/transcoders';

const TRANSCODERS_QUERY = `{
  transcoders(
    first: 1000,
    where: { active: true },
    orderBy: totalStake,
    orderDirection: desc
  ) {
    id
    serviceURI
    activationRound
    deactivationRound
    totalStake
    active
  }
}`;

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
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ctx.authToken}`,
  };
  if (ctx.cookieHeader) headers['cookie'] = ctx.cookieHeader;
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypassSecret) headers['x-vercel-protection-bypass'] = bypassSecret;
  return headers;
}

interface SubgraphTranscoder {
  id: string;
  serviceURI: string | null;
  activationRound: string;
  deactivationRound: string;
  totalStake: string;
  active: boolean;
}

export const subgraphAdapter: SourceAdapter = {
  kind: 'livepeer-subgraph',

  async fetchAll(ctx: FetchCtx): Promise<SourceFetchResult> {
    const t0 = Date.now();
    const url = resolveUrl(ctx.requestUrl);

    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(ctx),
      body: JSON.stringify({ query: TRANSCODERS_QUERY }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Subgraph query failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const raw = json?.data?.data?.transcoders ?? json?.data?.transcoders ?? json?.transcoders ?? [];
    const transcoders: SubgraphTranscoder[] = Array.isArray(raw) ? raw : [];

    const rows: NormalizedOrch[] = transcoders
      .filter((t) => t.active && t.serviceURI)
      .map((t) => ({
        ethAddress: t.id.toLowerCase(),
        orchUri: t.serviceURI!,
        activationRound: parseInt(t.activationRound || '0', 10),
        deactivationRound: Math.min(parseInt(t.deactivationRound || '0', 10), 2_000_000_000),
      }));

    return {
      rows,
      raw: transcoders,
      stats: { ok: true, fetched: rows.length, durationMs: Date.now() - t0 },
    };
  },
};
