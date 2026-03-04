// Service Gateway — Admin: Trigger Health Check
// GET|POST /api/v1/gw/admin/health/check
//
// Runs a health check against published connectors.
// - Manual (POST): team-scoped, uses JWT auth, passes user token for secret resolution
// - Cron (GET): all teams, uses CRON_SECRET auth, skips connectors requiring auth secrets

export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success } from '@/lib/api/response';
import { testUpstreamConnectivity } from '@/lib/gateway/admin/test-connectivity';

const CONCURRENCY_LIMIT = 5;

interface HealthCheckContext {
  isCron: boolean;
  teamId?: string;
  authToken: string;
}

async function resolveContext(request: NextRequest): Promise<HealthCheckContext | Response> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const isCron = !!(cronSecret && authHeader === `Bearer ${cronSecret}`);

  if (isCron) {
    return { isCron: true, authToken: '' };
  }

  const { getAdminContext, isErrorResponse } = await import('@/lib/gateway/admin/team-guard');
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  return { isCron: false, teamId: ctx.teamId, authToken: ctx.token };
}

async function runHealthCheck(request: NextRequest) {
  const ctxOrResponse = await resolveContext(request);
  if (ctxOrResponse instanceof Response) return ctxOrResponse;

  const ctx = ctxOrResponse;

  const connectors = await prisma.serviceConnector.findMany({
    where: {
      status: 'published',
      ...(ctx.teamId ? { teamId: ctx.teamId } : {}),
    },
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
        const result = await testUpstreamConnectivity(
          connector.upstreamBaseUrl,
          connector.healthCheckPath,
          connector.authType,
          connector.authConfig as Record<string, unknown>,
          connector.secretRefs,
          connector.allowedHosts,
          connector.teamId,
          ctx.authToken
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
          slug: ctx.isCron ? connector.slug : connector.slug,
          status,
          latencyMs: result.latencyMs,
          error: result.error,
        };
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
