import type { DashboardFeesInfo, DashboardFeeWeeklyData } from '@naap/plugin-sdk';

const DEFAULT_SUBGRAPH_ID = 'FE63YgkzcpVocxdCEyEYbvjYqEf2kb1A6daMYRxmejYC';

type SubgraphDay = {
  date: number;
  volumeETH: string;
  volumeUSD: string;
};

type SubgraphProtocol = {
  totalVolumeETH: string;
  totalVolumeUSD: string;
};

type SubgraphResponse = {
  data?: {
    days?: SubgraphDay[];
    protocol?: SubgraphProtocol | null;
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
 * Resolve subgraph URL using the same convention as explorer (lib/chains.ts):
 * - Prefer VITE_SUBGRAPH_ENDPOINT if set
 * - Else build: https://gateway.thegraph.com/api/${key}/subgraphs/id/${id}
 */
function getSubgraphUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const endpoint = env.VITE_SUBGRAPH_ENDPOINT;
  const apiKey = env.VITE_SUBGRAPH_API_KEY;
  const subgraphId = env.VITE_SUBGRAPH_ID || DEFAULT_SUBGRAPH_ID;

  if (endpoint) return endpoint;
  if (apiKey) return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;
  throw new Error(
    'VITE_SUBGRAPH_ENDPOINT or VITE_SUBGRAPH_API_KEY must be set (see .env.example)'
  );
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

  const currentDay = dayData.at(-1);
  const previousDay = dayData.at(-2);
  const currentWeek = weeklyData.at(-1);
  const previousWeek = weeklyData.at(-2);
  const twoWeeksBack = weeklyData.at(-3);

  const fallbackTotalEth = round2(dayData.reduce((sum, d) => sum + d.volumeEth, 0));
  const fallbackTotalUsd = round2(dayData.reduce((sum, d) => sum + d.volumeUsd, 0));

  return {
    totalEth: round2(toNumber(data?.protocol?.totalVolumeETH) || fallbackTotalEth),
    totalUsd: round2(toNumber(data?.protocol?.totalVolumeUSD) || fallbackTotalUsd),
    oneDayVolumeUsd: round2(currentDay?.volumeUsd ?? 0),
    oneDayVolumeEth: round2(currentDay?.volumeEth ?? 0),
    oneWeekVolumeUsd: round2(previousWeek?.weeklyVolumeUsd ?? currentWeek?.weeklyVolumeUsd ?? 0),
    oneWeekVolumeEth: round2(previousWeek?.weeklyVolumeEth ?? currentWeek?.weeklyVolumeEth ?? 0),
    volumeChangeUsd: round2(percentChange(currentDay?.volumeUsd ?? 0, previousDay?.volumeUsd ?? 0)),
    volumeChangeEth: round2(percentChange(currentDay?.volumeEth ?? 0, previousDay?.volumeEth ?? 0)),
    weeklyVolumeChangeUsd: round2(
      percentChange(previousWeek?.weeklyVolumeUsd ?? 0, twoWeeksBack?.weeklyVolumeUsd ?? 0)
    ),
    weeklyVolumeChangeEth: round2(
      percentChange(previousWeek?.weeklyVolumeEth ?? 0, twoWeeksBack?.weeklyVolumeEth ?? 0)
    ),
    dayData,
    weeklyData,
  };
}
