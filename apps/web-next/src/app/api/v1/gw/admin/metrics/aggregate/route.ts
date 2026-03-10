/**
 * Service Gateway — Admin: Metrics Aggregation (Cron)
 * GET /api/v1/gw/admin/metrics/aggregate
 *
 * Cron job for aggregating GatewayUsageRecord into ConnectorMetrics.
 * Aggregates the last full hour for each published connector.
 *
 * Auth: CRON_SECRET header OR getAdminContext.
 */

export const runtime = 'nodejs';
export const maxDuration = 120;

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success } from '@/lib/api/response';
import { getAdminContext, isErrorResponse } from '@/lib/gateway/admin/team-guard';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    Math.floor((p / 100) * sorted.length),
    sorted.length - 1
  );
  return sorted[idx] ?? 0;
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    const ctx = await getAdminContext(request);
    if (isErrorResponse(ctx)) return ctx;
  }

  const connectors = await prisma.serviceConnector.findMany({
    where: { status: 'published' },
    select: { id: true, slug: true },
  });

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setUTCMinutes(0, 0, 0);
  const periodStart = new Date(periodEnd);
  periodStart.setUTCHours(periodStart.getUTCHours() - 1);

  const aggregated: { slug: string; requests: number; errorCount: number }[] = [];

  for (const connector of connectors) {
    const records = await prisma.gatewayUsageRecord.findMany({
      where: {
        connectorId: connector.id,
        timestamp: {
          gte: periodStart,
          lt: periodEnd,
        },
      },
      select: { statusCode: true, latencyMs: true, upstreamLatencyMs: true },
    });

    const totalRequests = records.length;
    const errorCount = records.filter((r) => r.statusCode >= 500).length;
    const errorRate = totalRequests > 0 ? errorCount / totalRequests : 0;
    const successRate = 1 - errorRate;

    const latencies = records.map((r) => r.latencyMs).filter((l) => l >= 0).sort((a, b) => a - b);
    const upstreamLatencies = records.map((r) => r.upstreamLatencyMs).filter((l) => l >= 0);

    const latencyMeanMs = latencies.length > 0
      ? latencies.reduce((s, v) => s + v, 0) / latencies.length
      : 0;
    const upstreamLatencyMeanMs = upstreamLatencies.length > 0
      ? upstreamLatencies.reduce((s, v) => s + v, 0) / upstreamLatencies.length
      : 0;
    const gatewayOverheadMs = Math.max(0, latencyMeanMs - upstreamLatencyMeanMs);

    const healthChecks = await prisma.gatewayHealthCheck.findMany({
      where: {
        connectorId: connector.id,
        checkedAt: {
          gte: periodStart,
          lt: periodEnd,
        },
      },
      select: { status: true },
    });
    const healthCheckCount = healthChecks.length;
    const healthChecksPassed = healthChecks.filter((h) => h.status === 'up').length;
    const availabilityPercent = healthCheckCount > 0
      ? (healthChecksPassed / healthCheckCount) * 100
      : 100;

    const periodMinutes = 60;
    const throughputRpm = periodMinutes > 0 ? (totalRequests / periodMinutes) : 0;

    await prisma.connectorMetrics.upsert({
      where: {
        connectorId_period_periodStart: {
          connectorId: connector.id,
          period: 'hourly',
          periodStart,
        },
      },
      create: {
        connectorId: connector.id,
        period: 'hourly',
        periodStart,
        totalRequests,
        errorCount,
        errorRate,
        successRate,
        latencyMeanMs,
        latencyP50Ms: percentile(latencies, 50),
        latencyP95Ms: percentile(latencies, 95),
        latencyP99Ms: percentile(latencies, 99),
        upstreamLatencyMeanMs,
        gatewayOverheadMs,
        availabilityPercent,
        healthCheckCount,
        healthChecksPassed,
        throughputRpm,
      },
      update: {
        totalRequests,
        errorCount,
        errorRate,
        successRate,
        latencyMeanMs,
        latencyP50Ms: percentile(latencies, 50),
        latencyP95Ms: percentile(latencies, 95),
        latencyP99Ms: percentile(latencies, 99),
        upstreamLatencyMeanMs,
        gatewayOverheadMs,
        availabilityPercent,
        healthCheckCount,
        healthChecksPassed,
        throughputRpm,
      },
    });

    aggregated.push({ slug: connector.slug, requests: totalRequests, errorCount });
  }

  return success({
    aggregated: connectors.length,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    connectors: aggregated,
  });
}
