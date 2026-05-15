/**
 * GET /api/v1/orchestrator-leaderboard/dataset
 *
 * Returns the persisted global dataset (all capabilities + orchestrator rows)
 * along with metadata. Any authenticated user can read it.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { success, errors } from '@/lib/api/response';
import { getGlobalDatasetStats, getDatasetCapabilities, getRowsForCapability } from '@/lib/orchestrator-leaderboard/global-dataset';
import { getConfig } from '@/lib/orchestrator-leaderboard/config';
import { mapRow } from '@/lib/orchestrator-leaderboard/ranking';

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) return errors.unauthorized('Missing or invalid authentication');

  const stats = await getGlobalDatasetStats();
  const config = await getConfig();

  if (!stats.populated) {
    const response = success({
      populated: false,
      capabilities: {},
      meta: {
        totalOrchestrators: 0,
        capabilityCount: 0,
        refreshIntervalHours: config.refreshIntervalHours,
        lastRefreshedAt: config.lastRefreshedAt,
        lastRefreshedBy: config.lastRefreshedBy,
      },
    });
    response.headers.set('Cache-Control', 'private, max-age=10');
    return response;
  }

  const capNames = await getDatasetCapabilities();
  const mapped: Record<string, ReturnType<typeof mapRow>[]> = {};
  for (const cap of capNames) {
    const rows = await getRowsForCapability(cap);
    mapped[cap] = rows.map(mapRow);
  }

  const response = success({
    populated: true,
    capabilities: mapped,
    meta: {
      totalOrchestrators: stats.totalOrchestrators,
      capabilityCount: stats.capabilityCount,
      refreshedAt: stats.refreshedAt
        ? new Date(stats.refreshedAt).toISOString()
        : null,
      refreshedBy: stats.refreshedBy,
      refreshIntervalHours: config.refreshIntervalHours,
      lastRefreshedAt: config.lastRefreshedAt,
      lastRefreshedBy: config.lastRefreshedBy,
    },
  });
  response.headers.set('Cache-Control', 'private, max-age=60');
  return response;
}
