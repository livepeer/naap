import type { DashboardFeesInfo, DashboardFeeWeeklyData } from '@naap/plugin-sdk';

type SubgraphDay = {
  date: number;
  volumeETH: string;
  volumeUSD: string;
};

type SubgraphProtocol = {
  totalVolumeETH: string;
  totalVolumeUSD: string;
};

type SubgraphRound = {
  id: string;
  startBlock: string;
  initialized: boolean;
};

type SubgraphProtocolOverview = {
  roundLength: string;
  totalActiveStake: string;
  currentRound: SubgraphRound | null;
};

type SubgraphResponse = {
  data?: {
    days?: SubgraphDay[];
    protocol?: SubgraphProtocol | null;
  };
  errors?: Array<{ message: string }>;
};

type SubgraphProtocolResponse = {
  data?: {
    protocol?: SubgraphProtocolOverview | null;
  };
  errors?: Array<{ message: string }>;
};

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampDays(days?: number): number {
  if (!days || Number.isNaN(days)) return 180;
  return Math.min(Math.max(Math.floor(days), 7), 365);
}

function percentChange(current: number, previous: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function getWeekStartTimestamp(dateS: number): number {
  const date = new Date(dateS * 1000);
  date.setUTCHours(0, 0, 0, 0);
  const dayOfWeek = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayOfWeek);
  return Math.floor(date.getTime() / 1000);
}

/**
 * Resolve subgraph URL.
 *
 * Default path proxies through the shell server so the API key stays server-side.
 * VITE_SUBGRAPH_ENDPOINT is kept as an override for standalone plugin development.
 */
function getSubgraphUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const endpoint = env.VITE_SUBGRAPH_ENDPOINT;

  if (endpoint) return endpoint;
  return '/api/v1/subgraph';
}

async function fetchFromSubgraph(days: number): Promise<SubgraphResponse['data']> {
  const query = /* GraphQL */ `
    query FeesOverview($first: Int!) {
      days(first: $first, orderBy: date, orderDirection: desc) {
        date
        volumeETH
        volumeUSD
      }
      protocol(id: "0") {
        totalVolumeETH
        totalVolumeUSD
      }
    }
  `;

  const url = getSubgraphUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { first: days } }),
  });

  if (!res.ok) {
    throw new Error(`subgraph HTTP ${res.status}: ${url}`);
  }

  const body = (await res.json()) as SubgraphResponse;
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }
  if (!body.data) {
    throw new Error('subgraph returned no data');
  }
  return body.data;
}

export async function fetchSubgraphFees(days?: number): Promise<DashboardFeesInfo> {
  const first = clampDays(days);
  const data = await fetchFromSubgraph(first);

  const dayData = (data?.days ?? [])
    .map((row) => ({
      dateS: Number(row.date),
      volumeEth: toNumber(row.volumeETH),
      volumeUsd: toNumber(row.volumeUSD),
    }))
    .filter((row) => Number.isFinite(row.dateS))
    .sort((a, b) => a.dateS - b.dateS);

  const weeklyMap = new Map<number, DashboardFeeWeeklyData>();
  for (const day of dayData) {
    const weekStart = getWeekStartTimestamp(day.dateS);
    const existing = weeklyMap.get(weekStart);
    if (existing) {
      existing.weeklyVolumeEth += day.volumeEth;
      existing.weeklyVolumeUsd += day.volumeUsd;
    } else {
      weeklyMap.set(weekStart, {
        date: weekStart,
        weeklyVolumeEth: day.volumeEth,
        weeklyVolumeUsd: day.volumeUsd,
      });
    }
  }

  const weeklyData = [...weeklyMap.values()]
    .sort((a, b) => a.date - b.date)
    .map((w) => ({
      ...w,
      weeklyVolumeEth: round2(w.weeklyVolumeEth),
      weeklyVolumeUsd: round2(w.weeklyVolumeUsd),
    }));

  const latestDay = dayData.at(-1);
  const previousDay = dayData.at(-2);
  const dayBeforePrevious = dayData.at(-3);
  const currentWeek = weeklyData.at(-1);
  const previousWeek = weeklyData.at(-2);
  const twoWeeksBack = weeklyData.at(-3);

  const fallbackTotalEth = round2(dayData.reduce((sum, d) => sum + d.volumeEth, 0));
  const fallbackTotalUsd = round2(dayData.reduce((sum, d) => sum + d.volumeUsd, 0));

  const now = new Date();
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0) / 1000;
  const weekStartOfToday = getWeekStartTimestamp(startOfTodayUtc);
  const isLatestDayIncomplete = latestDay != null && latestDay.dateS >= startOfTodayUtc;
  const isLatestWeekIncomplete =
    currentWeek != null && currentWeek.date >= weekStartOfToday;

  const dayForDisplay = isLatestDayIncomplete ? previousDay : latestDay;
  const dayForDeltaBase = isLatestDayIncomplete ? dayBeforePrevious : previousDay;
  const weekForDisplay = isLatestWeekIncomplete ? previousWeek : currentWeek;
  const weekForDeltaBase = isLatestWeekIncomplete ? twoWeeksBack : previousWeek;

  const protocolTotalEth = data?.protocol?.totalVolumeETH;
  const protocolTotalUsd = data?.protocol?.totalVolumeUSD;

  return {
    totalEth: protocolTotalEth != null ? round2(toNumber(protocolTotalEth)) : fallbackTotalEth,
    totalUsd: protocolTotalUsd != null ? round2(toNumber(protocolTotalUsd)) : fallbackTotalUsd,
    oneDayVolumeUsd: round2(dayForDisplay?.volumeUsd ?? 0),
    oneDayVolumeEth: round2(dayForDisplay?.volumeEth ?? 0),
    oneWeekVolumeUsd: round2(weekForDisplay?.weeklyVolumeUsd ?? 0),
    oneWeekVolumeEth: round2(weekForDisplay?.weeklyVolumeEth ?? 0),
    volumeChangeUsd: round2(percentChange(dayForDisplay?.volumeUsd ?? 0, dayForDeltaBase?.volumeUsd ?? 0)),
    volumeChangeEth: round2(percentChange(dayForDisplay?.volumeEth ?? 0, dayForDeltaBase?.volumeEth ?? 0)),
    weeklyVolumeChangeUsd: round2(
      percentChange(weekForDisplay?.weeklyVolumeUsd ?? 0, weekForDeltaBase?.weeklyVolumeUsd ?? 0)
    ),
    weeklyVolumeChangeEth: round2(
      percentChange(weekForDisplay?.weeklyVolumeEth ?? 0, weekForDeltaBase?.weeklyVolumeEth ?? 0)
    ),
    dayData,
    weeklyData,
  };
}

export async function fetchSubgraphProtocol(): Promise<{
  currentRound: number;
  startBlock: number;
  initialized: boolean;
  totalBlocks: number;
  totalStakedLPT: number;
}> {
  const query = /* GraphQL */ `
    query ProtocolOverview {
      protocol(id: "0") {
        roundLength
        totalActiveStake
        currentRound {
          id
          startBlock
          initialized
        }
      }
    }
  `;

  const url = getSubgraphUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`subgraph HTTP ${res.status}: ${url}`);
  }

  const body = (await res.json()) as SubgraphProtocolResponse;
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }

  const protocol = body.data?.protocol;
  if (!protocol || !protocol.currentRound) {
    throw new Error('subgraph returned no protocol currentRound data');
  }

  return {
    currentRound: Math.floor(toNumber(protocol.currentRound.id)),
    startBlock: Math.floor(toNumber(protocol.currentRound.startBlock)),
    initialized: Boolean(protocol.currentRound.initialized),
    totalBlocks: Math.floor(toNumber(protocol.roundLength)),
    totalStakedLPT: toNumber(protocol.totalActiveStake),
  };
}
