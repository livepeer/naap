// Service Gateway — Admin: Trigger Health Check
// POST /api/v1/gw/admin/health/check
//
// Runs a health check against all published connectors.
// Can be triggered manually or by Vercel Cron (every 5 minutes).
//
// For cron: uses CRON_SECRET for auth instead of JWT.

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { testUpstreamConnectivity } from '@/lib/gateway/admin/test-connectivity';

export async function POST(request: NextRequest) {
  // Cron auth: check for CRON_SECRET header
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  // For manual trigger, require JWT auth
  if (!isCron) {
    const { getAdminContext, isErrorResponse } = await import('@/lib/gateway/admin/team-guard');
    const ctx = await getAdminContext(request);
    if (isErrorResponse(ctx)) return ctx;
  }

  // Get all published connectors with health check paths
  // For cron: check ALL teams. For manual: would be team-scoped but we check all for simplicity.
  const connectors = await prisma.serviceConnector.findMany({
    where: { status: 'published' },
    select: {
      id: true,
      teamId: true,
      slug: true,
      upstreamBaseUrl: true,
      healthCheckPath: true,
      authType: true,
      authConfig: true,
      secretRefs: true,
      allowedHosts: true,
    },
  });

  const results = await Promise.allSettled(
    connectors.map(async (connector) => {
      const result = await testUpstreamConnectivity(
        connector.upstreamBaseUrl,
        connector.healthCheckPath,
        connector.authType,
        connector.authConfig as Record<string, unknown>,
        connector.secretRefs,
        connector.allowedHosts,
        connector.teamId,
        '' // Internal call — no user auth token needed for secrets
      );

      // Determine status
      let status = 'up';
      if (!result.success) {
        status = 'down';
      } else if (result.latencyMs > 2000) {
        status = 'degraded';
      }

      // Write health check record
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
    })
  );

  const data = results.map((r) =>
    r.status === 'fulfilled' ? r.value : { error: 'Check failed' }
  );

  return success({
    checked: connectors.length,
    results: data,
    timestamp: new Date().toISOString(),
  });
}
