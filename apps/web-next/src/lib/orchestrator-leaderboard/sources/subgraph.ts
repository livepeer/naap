/**
 * Source Adapter: Livepeer Subgraph (on-chain registry)
 *
 * Queries The Graph for all active transcoders. This is the ground-truth
 * membership source — returns ethAddress + serviceURI + activation status.
 *
 * Supports two modes:
 *   - Gateway mode (default): routes through /api/v1/gw/livepeer-subgraph/*
 *   - Internal mode (ctx.internal): resolves connector secrets via Prisma
 *     and calls The Graph upstream directly (for cron jobs).
 */

import type { SourceAdapter, FetchCtx, SourceFetchResult, NormalizedOrch } from './types';
import { resolveConnectorAuth } from './internal-resolve';

const GW_PATH = '/api/v1/gw/livepeer-subgraph/transcoders';
const DEFAULT_SUBGRAPH_ID = 'FE63YgkzcpVocxdCEyEYbvjYqEf2kb1A6daMYRxmejYC';

function getUpstreamPath(): string {
  const id = process.env.SUBGRAPH_ID || DEFAULT_SUBGRAPH_ID;
  return `/api/subgraphs/id/${id}`;
}

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

function resolveGatewayUrl(requestUrl?: string): string {
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

function parseTranscoders(json: unknown): NormalizedOrch[] {
  const raw =
    (json as any)?.data?.data?.transcoders ??
    (json as any)?.data?.transcoders ??
    (json as any)?.transcoders ??
    [];
  const transcoders: SubgraphTranscoder[] = Array.isArray(raw) ? raw : [];

  return transcoders
    .filter((t) => t.active && t.serviceURI)
    .map((t) => ({
      ethAddress: t.id.toLowerCase(),
      orchUri: t.serviceURI!,
      activationRound: parseInt(t.activationRound || '0', 10),
      deactivationRound: Math.min(parseInt(t.deactivationRound || '0', 10), 2_000_000_000),
    }));
}

export const subgraphAdapter: SourceAdapter = {
  kind: 'livepeer-subgraph',

  async fetchAll(ctx: FetchCtx): Promise<SourceFetchResult> {
    const t0 = Date.now();
    let url: string;
    let headers: Record<string, string>;

    if (ctx.internal) {
      const auth = await resolveConnectorAuth('livepeer-subgraph');
      if (!auth) throw new Error('livepeer-subgraph connector not found or not published');
      url = `${auth.upstreamBaseUrl}${getUpstreamPath()}`;
      headers = auth.headers;
    } else {
      url = resolveGatewayUrl(ctx.requestUrl);
      headers = buildHeaders(ctx);
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: TRANSCODERS_QUERY }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Subgraph query failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const rows = parseTranscoders(json);

    return {
      rows,
      raw: json,
      stats: { ok: true, fetched: rows.length, durationMs: Date.now() - t0 },
    };
  },
};
