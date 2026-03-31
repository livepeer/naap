/**
 * KPI resolver — NAAP API backed.
 *
 * Fetches four endpoints in parallel and maps them to DashboardKPI.
 *
 * Known limitations (Phase 1):
 *   - dailyUsageMins: 0 — no minutes metric in NAAP API summary endpoints
 *   - dailyNetworkFeesEth: 0 — Phase 4 (The Graph)
 *   - orchestratorsOnline.delta: 0 — not derivable from available endpoints
 *
 * Sources:
 *   GET /v1/net/summary     → orchestrators online (point-in-time)
 *   GET /v1/streams/history → hourly buckets; sliced to requested timeframe
 *                             for session count, success rate, and delta
 */

import type { DashboardKPI } from '@naap/plugin-sdk';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch, TTL } from '../cache.js';

// ---------------------------------------------------------------------------
// Raw NAAP API types
// ---------------------------------------------------------------------------

interface NaapNetSummary {
  TotalActive: number;
  TotalRegistered: number;
}

interface NaapStreamsHistoryItem {
  Timestamp: string;
  RequestedSessions: number;
  StartupSuccessSessions: number;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function naapGet<T>(path: string): Promise<T> {
  const url = naapApiUpstreamUrl(path);
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/kpi] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Delta helpers
// ---------------------------------------------------------------------------

function sum(items: number[]): number {
  return items.reduce((a, b) => a + b, 0);
}

function percentDelta(current: number, previous: number): number {
  if (!previous) return 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function computeDeltas(history: NaapStreamsHistoryItem[]): {
  sessionDelta: number;
  successRateDelta: number;
} {
  if (history.length < 2) return { sessionDelta: 0, successRateDelta: 0 };

  const mid = Math.floor(history.length / 2);
  const prev = history.slice(0, mid);
  const curr = history.slice(mid);

  const prevRequested = sum(prev.map((h) => h.RequestedSessions));
  const currRequested = sum(curr.map((h) => h.RequestedSessions));
  const sessionDelta = percentDelta(currRequested, prevRequested);

  const prevSuccesses = sum(prev.map((h) => h.StartupSuccessSessions));
  const currSuccesses = sum(curr.map((h) => h.StartupSuccessSessions));
  const prevRate = prevRequested ? prevSuccesses / prevRequested : 0;
  const currRate = currRequested ? currSuccesses / currRequested : 0;
  // Delta in percentage points
  const successRateDelta = Math.round((currRate - prevRate) * 1000) / 10;

  return { sessionDelta, successRateDelta };
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolveKPI(opts: { timeframe?: string }): Promise<DashboardKPI> {
  const hours = Math.min(parseInt(opts.timeframe ?? '24', 10) || 24, 24);
  // Cache per timeframe so a 1h request does not serve 24h data
  return cachedFetch(`facade:kpi:${hours}`, TTL.KPI * 1000, async () => {
    const [net, history] = await Promise.all([
      naapGet<NaapNetSummary>('net/summary'),
      naapGet<NaapStreamsHistoryItem[]>('streams/history'),
    ]);

    // The NAAP API always returns ~24h of hourly buckets regardless of any
    // query params. Slice the tail to compute metrics for the requested window.
    const sliced = history.slice(-hours);

    const totalRequested = sum(sliced.map((h) => h.RequestedSessions));
    const totalSuccesses = sum(sliced.map((h) => h.StartupSuccessSessions));
    const successRatePct =
      totalRequested > 0 ? Math.round((totalSuccesses / totalRequested) * 1000) / 10 : 0;

    const { sessionDelta, successRateDelta } = computeDeltas(sliced);

    return {
      successRate: {
        value: successRatePct,
        delta: successRateDelta,
      },
      orchestratorsOnline: {
        value: net.TotalActive,
        delta: 0,
      },
      dailyUsageMins: {
        // Not available from NAAP API — Phase 3 may address
        value: 0,
        delta: 0,
      },
      dailySessionCount: {
        value: totalRequested,
        delta: sessionDelta,
      },
      dailyNetworkFeesEth: {
        // Phase 4 — The Graph
        value: 0,
        delta: 0,
      },
      timeframeHours: hours,
      hourlySessions: sliced.map((h) => ({ hour: h.Timestamp, value: h.RequestedSessions })),
      hourlyUsage: sliced.map((h) => ({ hour: h.Timestamp, value: h.StartupSuccessSessions })),
    };
  });
}
