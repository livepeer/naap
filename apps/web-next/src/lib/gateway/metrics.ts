/**
 * Service Gateway — Metrics Helper
 *
 * Retrieves and summarizes connector performance metrics
 * for catalog descriptors and the metrics API.
 */

import { prisma } from '@/lib/db';
import type { PerformanceMetrics } from './catalog';

/**
 * Get the latest aggregated metrics for a connector.
 */
export async function getLatestMetrics(
  connectorId: string,
  window: '1h' | '24h' | '7d' = '24h'
): Promise<PerformanceMetrics | null> {
  if (window === '7d') {
    const rows = await prisma.connectorMetrics.findMany({
      where: { connectorId, period: 'daily' },
      orderBy: { periodStart: 'desc' },
      take: 7,
    });
    if (rows.length === 0) return null;
    return aggregateMetrics(rows, '7d');
  }

  if (window === '24h') {
    const rows = await prisma.connectorMetrics.findMany({
      where: { connectorId, period: 'hourly' },
      orderBy: { periodStart: 'desc' },
      take: 24,
    });
    if (rows.length === 0) return null;
    if (rows.length === 1) return summarizeMetricsForDescriptor(rows[0]);
    return aggregateMetrics(rows, '24h');
  }

  const row = await prisma.connectorMetrics.findFirst({
    where: { connectorId, period: 'hourly' },
    orderBy: { periodStart: 'desc' },
  });

  if (!row) return null;
  return summarizeMetricsForDescriptor(row);
}

/**
 * Map a ConnectorMetrics DB row to the PerformanceMetrics shape.
 */
export function summarizeMetricsForDescriptor(
  metrics: Record<string, unknown> | null
): PerformanceMetrics | null {
  if (!metrics) return null;

  const m = metrics as {
    totalRequests: number;
    errorRate: number;
    successRate: number;
    latencyMeanMs: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
    latencyP99Ms: number;
    upstreamLatencyMeanMs: number;
    gatewayOverheadMs: number;
    availabilityPercent: number;
    throughputRpm: number;
    period: string;
  };

  return {
    errorRate: m.errorRate,
    successRate: m.successRate,
    latencyMeanMs: m.latencyMeanMs,
    latencyP50Ms: m.latencyP50Ms,
    latencyP95Ms: m.latencyP95Ms,
    latencyP99Ms: m.latencyP99Ms,
    upstreamLatencyMeanMs: m.upstreamLatencyMeanMs,
    gatewayOverheadMs: m.gatewayOverheadMs,
    availabilityPercent: m.availabilityPercent,
    throughputRpm: m.throughputRpm,
    period: m.period === 'hourly' ? '1h' : '24h',
    sampleSize: m.totalRequests,
  };
}

function aggregateMetrics(
  rows: Array<Record<string, unknown>>,
  period: '24h' | '7d'
): PerformanceMetrics {
  const typed = rows as Array<{
    totalRequests: number;
    errorCount: number;
    latencyMeanMs: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
    latencyP99Ms: number;
    upstreamLatencyMeanMs: number;
    gatewayOverheadMs: number;
    availabilityPercent: number;
    healthCheckCount: number;
    healthChecksPassed: number;
    throughputRpm: number;
  }>;

  const totalRequests = typed.reduce((sum, r) => sum + r.totalRequests, 0);
  const totalErrors = typed.reduce((sum, r) => sum + r.errorCount, 0);
  const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

  const weightedAvg = (field: keyof typeof typed[0]) => {
    if (totalRequests === 0) return 0;
    return typed.reduce((sum, r) => sum + (r[field] as number) * r.totalRequests, 0) / totalRequests;
  };

  const totalHC = typed.reduce((sum, r) => sum + r.healthCheckCount, 0);
  const passedHC = typed.reduce((sum, r) => sum + r.healthChecksPassed, 0);

  return {
    errorRate: Math.round(errorRate * 10000) / 10000,
    successRate: Math.round((1 - errorRate) * 10000) / 10000,
    latencyMeanMs: Math.round(weightedAvg('latencyMeanMs')),
    latencyP50Ms: null,
    latencyP95Ms: null,
    latencyP99Ms: null,
    upstreamLatencyMeanMs: Math.round(weightedAvg('upstreamLatencyMeanMs')),
    gatewayOverheadMs: Math.round(weightedAvg('gatewayOverheadMs')),
    availabilityPercent: totalHC > 0 ? Math.round((passedHC / totalHC) * 10000) / 100 : 100,
    throughputRpm: Math.round(typed.reduce((sum, r) => sum + r.throughputRpm, 0) / typed.length * 100) / 100,
    period,
    sampleSize: totalRequests,
  };
}
