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
  const index = Math.min(
    Math.floor((p / 100) * (sorted.length - 1)),
    sorted.length - 1
  );
  return sorted[index] ?? 0;
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
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

  const connectorIds = connectors.map((c) => c.id);

  const [allRecords, allHealthChecks] = await Promise.all([
    prisma.gatewayUsageRecord.findMany({
      where: {
        connectorId: { in: connectorIds },
        timestamp: { gte: periodStart, lt: periodEnd },
      },
      select: { connectorId: true, statusCode: true, latencyMs: true, upstreamLatencyMs: true },
    }),
    prisma.gatewayHealthCheck.findMany({
      where: {
        connectorId: { in: connectorIds },
        checkedAt: { gte: periodStart, lt: periodEnd },
      },
      select: { connectorId: true, status: true },
    }),
  ]);

  const recordsByConnector = new Map<string, typeof allRecords>();
  for (const r of allRecords) {
    const arr = recordsByConnector.get(r.connectorId) || [];
    arr.push(r);
    recordsByConnector.set(r.connectorId, arr);
  }
  const healthByConnector = new Map<string, typeof allHealthChecks>();
  for (const h of allHealthChecks) {
    const arr = healthByConnector.get(h.connectorId) || [];
    arr.push(h);
    healthByConnector.set(h.connectorId, arr);
  }

  const CONCURRENCY = 5;

  async function processConnector(connector: { id: string; slug: string }) {
    const records = recordsByConnector.get(connector.id) || [];

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

    const healthChecks = healthByConnector.get(connector.id) || [];
    const healthCheckCount = healthChecks.length;
    const healthChecksPassed = healthChecks.filter((h) => h.status === 'up').length;
    const availabilityPercent = healthCheckCount > 0
      ? (healthChecksPassed / healthCheckCount) * 100
      : 100;

    const periodMinutes = 60;
    const throughputRpm = periodMinutes > 0 ? (totalRequests / periodMinutes) : 0;

    const hourlyData = {
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
    };

    await prisma.connectorMetrics.upsert({
      where: {
        connectorId_period_periodStart: {
          connectorId: connector.id,
          period: 'hourly',
          periodStart,
        },
      },
      create: { connectorId: connector.id, period: 'hourly', periodStart, ...hourlyData },
      update: hourlyData,
    });

    // ── Daily rollup: aggregate all hourly rows for the calendar day ──
    const dayStart = new Date(periodStart);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const hourlyRows = await prisma.connectorMetrics.findMany({
      where: {
        connectorId: connector.id,
        period: 'hourly',
        periodStart: { gte: dayStart, lt: dayEnd },
      },
    });

    if (hourlyRows.length > 0) {
      const dayTotalRequests = hourlyRows.reduce((s, r) => s + r.totalRequests, 0);
      const dayErrorCount = hourlyRows.reduce((s, r) => s + r.errorCount, 0);
      const dayErrorRate = dayTotalRequests > 0 ? dayErrorCount / dayTotalRequests : 0;
      const daySuccessRate = 1 - dayErrorRate;

      const dayWeightedAvg = (field: 'latencyMeanMs' | 'upstreamLatencyMeanMs' | 'gatewayOverheadMs') => {
        if (dayTotalRequests === 0) return 0;
        return hourlyRows.reduce((s, r) => s + r[field] * r.totalRequests, 0) / dayTotalRequests;
      };

      const dayHCCount = hourlyRows.reduce((s, r) => s + r.healthCheckCount, 0);
      const dayHCPassed = hourlyRows.reduce((s, r) => s + r.healthChecksPassed, 0);
      const dayAvailability = dayHCCount > 0 ? (dayHCPassed / dayHCCount) * 100 : 100;
      const dayThroughput = hourlyRows.reduce((s, r) => s + r.throughputRpm, 0) / hourlyRows.length;

      const dailyData = {
        totalRequests: dayTotalRequests,
        errorCount: dayErrorCount,
        errorRate: dayErrorRate,
        successRate: daySuccessRate,
        latencyMeanMs: dayWeightedAvg('latencyMeanMs'),
        latencyP50Ms: 0,
        latencyP95Ms: 0,
        latencyP99Ms: 0,
        upstreamLatencyMeanMs: dayWeightedAvg('upstreamLatencyMeanMs'),
        gatewayOverheadMs: dayWeightedAvg('gatewayOverheadMs'),
        availabilityPercent: dayAvailability,
        healthCheckCount: dayHCCount,
        healthChecksPassed: dayHCPassed,
        throughputRpm: dayThroughput,
      };

      await prisma.connectorMetrics.upsert({
        where: {
          connectorId_period_periodStart: {
            connectorId: connector.id,
            period: 'daily',
            periodStart: dayStart,
          },
        },
        create: { connectorId: connector.id, period: 'daily', periodStart: dayStart, ...dailyData },
        update: dailyData,
      });
    }

    return { slug: connector.slug, requests: totalRequests, errorCount };
  }

  const aggregated: { slug: string; requests: number; errorCount: number }[] = [];

  for (let i = 0; i < connectors.length; i += CONCURRENCY) {
    const batch = connectors.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(processConnector));
    for (const result of results) {
      if (result.status === 'fulfilled') {
        aggregated.push(result.value);
      }
    }
  }

  return success({
    aggregated: connectors.length,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    connectors: aggregated,
  });
}
