// Service Gateway — Admin: Trigger Health Check
// GET|POST /api/v1/gw/admin/health/check
//
// Runs a health check against all published connectors.
// Can be triggered manually (POST) or by Vercel Cron (GET, every 5 minutes).
//
// For cron: uses CRON_SECRET for auth instead of JWT.

export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success } from '@/lib/api/response';
import { testUpstreamConnectivity } from '@/lib/gateway/admin/test-connectivity';

const CONCURRENCY_LIMIT = 5;
const PER_CONNECTOR_TIMEOUT_MS = 10_000;

async function runHealthCheck(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    const { getAdminContext, isErrorResponse } = await import('@/lib/gateway/admin/team-guard');
    const ctx = await getAdminContext(request);
    if (isErrorResponse(ctx)) return ctx;
  }

  const connectors = await prisma.serviceConnector.findMany({
    where: { status: 'published' },
    select: {
      id: true,
      teamId: true,
      ownerUserId: true,
      slug: true,
      upstreamBaseUrl: true,
      healthCheckPath: true,
      authType: true,
      authConfig: true,
      secretRefs: true,
      allowedHosts: true,
    },
  });

  const allResults: PromiseSettledResult<{
    connectorId: string;
    slug: string;
    status: string;
    latencyMs: number;
    error: string | null;
  }>[] = [];

  for (let i = 0; i < connectors.length; i += CONCURRENCY_LIMIT) {
    const batch = connectors.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.allSettled(
      batch.map(async (connector) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PER_CONNECTOR_TIMEOUT_MS);

        try {
          const scopeId = connector.teamId ?? `personal:${connector.ownerUserId}`;
          const result = await testUpstreamConnectivity(
            connector.upstreamBaseUrl,
            connector.healthCheckPath,
            connector.authType,
            connector.authConfig as Record<string, unknown>,
            connector.secretRefs,
            connector.allowedHosts,
            scopeId,
            ''
          );

          let status = 'up';
          if (!result.success) {
            status = 'down';
          } else if (result.latencyMs > 2000) {
            status = 'degraded';
          }

          await prisma.gatewayHealthCheck.create({
            data: {
              connectorId: connector.id,
              status,
              latencyMs: result.latencyMs,
              statusCode: result.statusCode,
              error: result.error,
            },
          });

          return {
            connectorId: connector.id,
            slug: connector.slug,
            status,
            latencyMs: result.latencyMs,
            error: result.error,
          };
        } finally {
          clearTimeout(timer);
        }
      })
    );
    allResults.push(...batchResults);
  }

  const data = allResults.map((r) =>
    r.status === 'fulfilled' ? r.value : { error: 'Check failed' }
  );

  return success({
    checked: connectors.length,
    results: data,
    timestamp: new Date().toISOString(),
  });
}

export async function GET(request: NextRequest) {
  return runHealthCheck(request);
}

export async function POST(request: NextRequest) {
  return runHealthCheck(request);
}
