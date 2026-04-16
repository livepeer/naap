/**
 * Orchestrator Leaderboard — Global Dataset Refresh
 *
 * Fetches all warm capabilities from ClickHouse, then fetches leaderboard
 * rows for each capability and stores the result as the global dataset
 * (full replace). Also clears plan caches so they re-evaluate lazily.
 */

import type { ClickHouseJSONResponse } from './types';
import { fetchLeaderboard, resolveClickhouseGatewayQueryUrl } from './query';
import { setGlobalDataset } from './global-dataset';
import { getRefreshIntervalMs, markRefreshed } from './config';
import { clearPlanCache } from './refresh';

const CAPABILITIES_SQL = `SELECT DISTINCT capability_name
FROM semantic.network_capabilities
WHERE timestamp_ts >= now() - INTERVAL 1 HOUR
  AND warm_bool = 1
ORDER BY capability_name
FORMAT JSON`;

const FALLBACK_CAPABILITIES = [
  'noop',
  'streamdiffusion',
  'streamdiffusion-sdxl',
  'streamdiffusion-sdxl-v2v',
];

/**
 * Fetch all warm capability names from ClickHouse.
 */
async function fetchCapabilities(
  authToken: string,
  requestUrl?: string,
  cookieHeader?: string | null,
): Promise<string[]> {
  const url = resolveClickhouseGatewayQueryUrl(requestUrl);

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
    Authorization: `Bearer ${authToken}`,
  };

  if (cookieHeader) headers['cookie'] = cookieHeader;

  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypassSecret) headers['x-vercel-protection-bypass'] = bypassSecret;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: CAPABILITIES_SQL,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`ClickHouse query failed (${res.status})`);

    const json = await res.json();
    const chData = (json.data ?? json) as {
      data?: Array<{ capability_name: string }>;
    };
    return (chData.data ?? []).map(
      (row: { capability_name: string }) => row.capability_name,
    );
  } catch {
    return FALLBACK_CAPABILITIES;
  }
}

/**
 * Full refresh: fetch all capabilities, fetch rows for each, store as
 * the global dataset (full replace). Returns summary stats.
 */
export async function refreshGlobalDataset(
  refreshedBy: string,
  authToken: string,
  requestUrl?: string,
  cookieHeader?: string | null,
): Promise<{
  refreshed: boolean;
  capabilities: number;
  orchestrators: number;
}> {
  const capabilities = await fetchCapabilities(authToken, requestUrl, cookieHeader);

  const capData: Record<string, import('./types').ClickHouseLeaderboardRow[]> = {};
  let totalOrchestrators = 0;

  for (const capability of capabilities) {
    try {
      const { rows } = await fetchLeaderboard(
        capability,
        authToken,
        requestUrl,
        cookieHeader,
      );
      capData[capability] = rows;
      totalOrchestrators += rows.length;
    } catch {
      capData[capability] = [];
    }
  }

  const intervalMs = await getRefreshIntervalMs();

  setGlobalDataset(
    {
      capabilities: capData,
      refreshedAt: Date.now(),
      refreshedBy,
      totalOrchestrators,
    },
    intervalMs,
  );

  await markRefreshed(refreshedBy);

  clearPlanCache();

  return {
    refreshed: true,
    capabilities: capabilities.length,
    orchestrators: totalOrchestrators,
  };
}
