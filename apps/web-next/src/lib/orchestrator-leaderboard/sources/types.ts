/**
 * Orchestrator Leaderboard — Source Adapter Contracts
 *
 * Shared types for the pluggable data-source pipeline: every source implements
 * SourceAdapter, returns NormalizedOrch rows, and the resolver merges them into
 * the canonical ClickHouseLeaderboardRow shape used by downstream consumers.
 */

export const SOURCE_KINDS = [
  'livepeer-subgraph',
  'clickhouse-query',
  'naap-discover',
  'naap-pricing',
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface FetchCtx {
  authToken: string;
  requestUrl?: string;
  cookieHeader?: string | null;
  /** When true, adapters resolve connector secrets via Prisma and call upstream directly. */
  internal?: boolean;
}

export interface SourceStats {
  ok: boolean;
  fetched: number;
  durationMs: number;
  errorMessage?: string;
}

export interface NormalizedOrch {
  ethAddress?: string;
  orchUri?: string;
  capabilities?: string[];
  score?: number;
  recentWork?: boolean;
  lastSeenMs?: number;
  gpuName?: string;
  gpuGb?: number;
  avail?: number;
  totalCap?: number;
  pricePerUnit?: number;
  bestLatMs?: number | null;
  avgLatMs?: number | null;
  swapRatio?: number | null;
  avgAvail?: number | null;
  activationRound?: number;
  deactivationRound?: number;
  isWarm?: boolean;
  pipeline?: string;
  model?: string;
}

export interface SourceFetchResult {
  rows: NormalizedOrch[];
  raw: unknown;
  stats: SourceStats;
}

export interface SourceAdapter {
  kind: SourceKind;
  fetchAll(ctx: FetchCtx): Promise<SourceFetchResult>;
}
