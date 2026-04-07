/**
 * Fees resolver — The Graph subgraph backed.
 *
 * Requires:
 *   SUBGRAPH_API_KEY — The Graph API key
 *   SUBGRAPH_ID     — Subgraph ID (default: FE63YgkzcpVocxdCEyEYbvjYqEf2kb1A6daMYRxmejYC)
 *
 * Source:
 *   The Graph subgraph → daily and weekly ETH/USD volume data
 */

import type { DashboardFeesInfo, DashboardFeeWeeklyData } from '@naap/plugin-sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSubgraphUrl(): string {
  const apiKey = process.env.SUBGRAPH_API_KEY;
  const subgraphId = process.env.SUBGRAPH_ID ?? 'FE63YgkzcpVocxdCEyEYbvjYqEf2kb1A6daMYRxmejYC';
  if (!apiKey) throw new Error('[facade/fees] SUBGRAPH_API_KEY is not set');
  return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentChange(current: number, previous: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

function getWeekStartTimestamp(dateS: number): number {
  const date = new Date(dateS * 1000);
  date.setUTCHours(0, 0, 0, 0);
  const dayOfWeek = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayOfWeek);
  return Math.floor(date.getTime() / 1000);
}

function clampDays(days?: number): number {
  if (days === undefined || days === null || typeof days !== 'number' || Number.isNaN(days)) {
    return 180;
  }
  return Math.min(Math.max(Math.floor(days), 7), 365);
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolveFees(opts: { days?: number }): Promise<DashboardFeesInfo> {
  const first = clampDays(opts.days);
  const subgraphUrl = getSubgraphUrl();

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

  const res = await fetch(subgraphUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { first } }),
    signal: AbortSignal.timeout(60_000),
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`[facade/fees] subgraph HTTP ${res.status}`);

  type SubgraphFeesResponse = {
    data?: {
      days?: Array<{ date: number; volumeETH: string; volumeUSD: string }>;
      protocol?: { totalVolumeETH: string; totalVolumeUSD: string } | null;
    };
    errors?: Array<{ message: string }>;
  };

  const body = (await res.json()) as SubgraphFeesResponse;
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  if (!body.data) throw new Error('[facade/fees] subgraph returned no data');

  const data = body.data;

  const dayData = (data.days ?? [])
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
    .map((w) => ({ ...w, weeklyVolumeEth: round2(w.weeklyVolumeEth), weeklyVolumeUsd: round2(w.weeklyVolumeUsd) }));

  const now = new Date();
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const weekStartOfToday = getWeekStartTimestamp(startOfTodayUtc);

  const latestDay = dayData.at(-1);
  const previousDay = dayData.at(-2);
  const dayBeforePrevious = dayData.at(-3);
  const currentWeek = weeklyData.at(-1);
  const previousWeek = weeklyData.at(-2);
  const twoWeeksBack = weeklyData.at(-3);

  const isLatestDayIncomplete = latestDay != null && latestDay.dateS >= startOfTodayUtc;
  const isLatestWeekIncomplete = currentWeek != null && currentWeek.date >= weekStartOfToday;

  const dayForDisplay = isLatestDayIncomplete ? previousDay : latestDay;
  const dayForDeltaBase = isLatestDayIncomplete ? dayBeforePrevious : previousDay;
  const weekForDisplay = isLatestWeekIncomplete ? previousWeek : currentWeek;
  const weekForDeltaBase = isLatestWeekIncomplete ? twoWeeksBack : previousWeek;

  const fallbackTotalEth = round2(dayData.reduce((sum, d) => sum + d.volumeEth, 0));
  const fallbackTotalUsd = round2(dayData.reduce((sum, d) => sum + d.volumeUsd, 0));

  const volumeChangeUsd = dayForDeltaBase != null && dayForDisplay != null
    ? round2(percentChange(dayForDisplay.volumeUsd, dayForDeltaBase.volumeUsd))
    : null;
  const volumeChangeEth = dayForDeltaBase != null && dayForDisplay != null
    ? round2(percentChange(dayForDisplay.volumeEth, dayForDeltaBase.volumeEth))
    : null;
  const weeklyVolumeChangeUsd = weekForDeltaBase != null && weekForDisplay != null
    ? round2(percentChange(weekForDisplay.weeklyVolumeUsd, weekForDeltaBase.weeklyVolumeUsd))
    : null;
  const weeklyVolumeChangeEth = weekForDeltaBase != null && weekForDisplay != null
    ? round2(percentChange(weekForDisplay.weeklyVolumeEth, weekForDeltaBase.weeklyVolumeEth))
    : null;

  return {
    totalEth: data.protocol?.totalVolumeETH != null
      ? round2(toNumber(data.protocol.totalVolumeETH))
      : fallbackTotalEth,
    totalUsd: data.protocol?.totalVolumeUSD != null
      ? round2(toNumber(data.protocol.totalVolumeUSD))
      : fallbackTotalUsd,
    oneDayVolumeUsd: round2(dayForDisplay?.volumeUsd ?? 0),
    oneDayVolumeEth: round2(dayForDisplay?.volumeEth ?? 0),
    oneWeekVolumeUsd: round2(weekForDisplay?.weeklyVolumeUsd ?? 0),
    oneWeekVolumeEth: round2(weekForDisplay?.weeklyVolumeEth ?? 0),
    volumeChangeUsd,
    volumeChangeEth,
    weeklyVolumeChangeUsd,
    weeklyVolumeChangeEth,
    dayData,
    weeklyData,
  };
}
