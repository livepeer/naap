/**
 * Metrics Collector Service
 * Collects and aggregates plugin performance metrics
 *
 * Features:
 * - Request metrics collection (count, latency, errors)
 * - Time-series data storage
 * - Metric aggregation over configurable periods
 * - Active user tracking
 * - Resource usage metrics (memory, CPU)
 */

import { PrismaClient, PluginMetrics } from '@naap/database';
import { createBufferKey, parseBufferKey } from './deploymentTypes';

// =============================================================================
// Types
// =============================================================================

export interface RequestMetrics {
  deploymentId: string;
  slot?: string;
  path?: string;
  method?: string;
  statusCode: number;
  latencyMs: number;
  userId?: string;
  sessionId?: string;
  responseSize?: number;
  timestamp?: Date;
}

export interface ResourceMetrics {
  deploymentId: string;
  slot?: string;
  memoryUsageMb?: number;
  cpuUsagePercent?: number;
  timestamp?: Date;
}

export interface AggregatedMetrics {
  deploymentId: string;
  slot?: string;
  requestCount: number;
  errorCount: number;
  errorRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  latencyAvg: number;
  activeUsers: number;
  uniqueSessions: number;
  memoryUsageMb: number | null;
  cpuUsagePercent: number | null;
}

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface TimeSeriesPoint {
  timestamp: Date;
  requestCount: number;
  errorCount: number;
  latencyAvg: number;
  activeUsers: number;
}

// In-memory buffer for high-frequency metrics
interface MetricBuffer {
  latencies: number[];
  errorCount: number;
  requestCount: number;
  userIds: Set<string>;
  sessionIds: Set<string>;
  lastFlush: Date;
}

// =============================================================================
// Constants
// =============================================================================

const BUFFER_FLUSH_INTERVAL_MS = 60000; // 1 minute
const BUFFER_MAX_SIZE = 10000; // Max entries before forced flush
const RETENTION_DAYS = 90; // Keep metrics for 90 days

// =============================================================================
// Metrics Collector Service
// =============================================================================

export function createMetricsCollector(prisma: PrismaClient) {
  // In-memory buffers for high-frequency metric collection
  const buffers = new Map<string, MetricBuffer>();
  let flushInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Get buffer key for a deployment/slot combination
   * Uses safe encoding to handle special characters in deploymentId
   */
  function getBufferKey(deploymentId: string, slot?: string): string {
    return createBufferKey(deploymentId, slot);
  }

  /**
   * Get or create a metric buffer
   */
  function getBuffer(deploymentId: string, slot?: string): MetricBuffer {
    const key = getBufferKey(deploymentId, slot);
    let buffer = buffers.get(key);

    if (!buffer) {
      buffer = {
        latencies: [],
        errorCount: 0,
        requestCount: 0,
        userIds: new Set(),
        sessionIds: new Set(),
        lastFlush: new Date(),
      };
      buffers.set(key, buffer);
    }

    return buffer;
  }

  /**
   * Calculate percentile from sorted array
   */
  function calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;

    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
  }

  /**
   * Flush a single buffer to database
   */
  async function flushBuffer(
    key: string,
    buffer: MetricBuffer,
    periodSeconds: number = 60
  ): Promise<void> {
    if (buffer.requestCount === 0) {
      buffer.lastFlush = new Date();
      return;
    }

    // Use safe key parsing to handle special characters
    const { deploymentId, slot } = parseBufferKey(key);

    // Sort latencies for percentile calculation
    const sortedLatencies = [...buffer.latencies].sort((a, b) => a - b);

    // Calculate metrics
    const latencyP50 = calculatePercentile(sortedLatencies, 50);
    const latencyP95 = calculatePercentile(sortedLatencies, 95);
    const latencyP99 = calculatePercentile(sortedLatencies, 99);
    const latencyAvg =
      sortedLatencies.length > 0
        ? sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length
        : 0;

    // Store aggregated metrics
    await prisma.pluginMetrics.create({
      data: {
        deploymentId,
        slot: slot || null,
        requestCount: buffer.requestCount,
        errorCount: buffer.errorCount,
        latencyP50,
        latencyP95,
        latencyP99,
        latencyAvg,
        activeUsers: buffer.userIds.size,
        uniqueSessions: buffer.sessionIds.size,
        periodSeconds,
      },
    });

    // Reset buffer
    buffer.latencies = [];
    buffer.errorCount = 0;
    buffer.requestCount = 0;
    buffer.userIds.clear();
    buffer.sessionIds.clear();
    buffer.lastFlush = new Date();
  }

  /**
   * Flush all buffers to database
   */
  async function flushAllBuffers(): Promise<void> {
    const flushPromises: Promise<void>[] = [];

    Array.from(buffers.entries()).forEach(([key, buffer]) => {
      flushPromises.push(flushBuffer(key, buffer));
    });

    await Promise.all(flushPromises);
  }

  /**
   * Start automatic buffer flushing
   */
  function startAutoFlush(): void {
    if (flushInterval) return;

    flushInterval = setInterval(async () => {
      try {
        await flushAllBuffers();
      } catch (error) {
        console.error('Failed to flush metrics buffers:', error);
      }
    }, BUFFER_FLUSH_INTERVAL_MS);
  }

  /**
   * Stop automatic buffer flushing
   */
  function stopAutoFlush(): void {
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
  }

  // =============================================================================
  // Public API
  // =============================================================================

  return {
    /**
     * Record a request metric (high-frequency, buffered)
     */
    recordRequest(metrics: RequestMetrics): void {
      const buffer = getBuffer(metrics.deploymentId, metrics.slot);

      buffer.latencies.push(metrics.latencyMs);
      buffer.requestCount++;

      if (metrics.statusCode >= 400) {
        buffer.errorCount++;
      }

      if (metrics.userId) {
        buffer.userIds.add(metrics.userId);
      }

      if (metrics.sessionId) {
        buffer.sessionIds.add(metrics.sessionId);
      }

      // Force flush if buffer is too large
      if (buffer.latencies.length >= BUFFER_MAX_SIZE) {
        flushBuffer(getBufferKey(metrics.deploymentId, metrics.slot), buffer).catch(
          console.error
        );
      }
    },

    /**
     * Record resource usage metrics (lower frequency, direct write)
     */
    async recordResourceUsage(metrics: ResourceMetrics): Promise<void> {
      await prisma.pluginMetrics.create({
        data: {
          deploymentId: metrics.deploymentId,
          slot: metrics.slot,
          memoryUsageMb: metrics.memoryUsageMb,
          cpuUsagePercent: metrics.cpuUsagePercent,
          periodSeconds: 60,
        },
      });
    },

    /**
     * Get aggregated metrics for a time range
     */
    async getMetrics(
      deploymentId: string,
      timeRange: TimeRange,
      slot?: string
    ): Promise<AggregatedMetrics> {
      const where: {
        deploymentId: string;
        timestamp: { gte: Date; lte: Date };
        slot?: string | null;
      } = {
        deploymentId,
        timestamp: {
          gte: timeRange.start,
          lte: timeRange.end,
        },
      };

      if (slot) {
        where.slot = slot;
      }

      const metrics = await prisma.pluginMetrics.findMany({
        where,
        orderBy: { timestamp: 'asc' },
      });

      if (metrics.length === 0) {
        return {
          deploymentId,
          slot,
          requestCount: 0,
          errorCount: 0,
          errorRate: 0,
          latencyP50: 0,
          latencyP95: 0,
          latencyP99: 0,
          latencyAvg: 0,
          activeUsers: 0,
          uniqueSessions: 0,
          memoryUsageMb: null,
          cpuUsagePercent: null,
        };
      }

      // Aggregate metrics
      let totalRequests = 0;
      let totalErrors = 0;
      const allLatencyP50: number[] = [];
      const allLatencyP95: number[] = [];
      const allLatencyP99: number[] = [];
      const allLatencyAvg: number[] = [];
      let maxActiveUsers = 0;
      let maxUniqueSessions = 0;
      let lastMemory: number | null = null;
      let lastCpu: number | null = null;

      for (const m of metrics) {
        totalRequests += m.requestCount;
        totalErrors += m.errorCount;

        if (m.latencyP50) allLatencyP50.push(m.latencyP50);
        if (m.latencyP95) allLatencyP95.push(m.latencyP95);
        if (m.latencyP99) allLatencyP99.push(m.latencyP99);
        if (m.latencyAvg) allLatencyAvg.push(m.latencyAvg);

        maxActiveUsers = Math.max(maxActiveUsers, m.activeUsers);
        maxUniqueSessions = Math.max(maxUniqueSessions, m.uniqueSessions);

        if (m.memoryUsageMb !== null) lastMemory = m.memoryUsageMb;
        if (m.cpuUsagePercent !== null) lastCpu = m.cpuUsagePercent;
      }

      // Calculate averages
      const avgP50 =
        allLatencyP50.length > 0
          ? allLatencyP50.reduce((a, b) => a + b, 0) / allLatencyP50.length
          : 0;
      const avgP95 =
        allLatencyP95.length > 0
          ? allLatencyP95.reduce((a, b) => a + b, 0) / allLatencyP95.length
          : 0;
      const avgP99 =
        allLatencyP99.length > 0
          ? allLatencyP99.reduce((a, b) => a + b, 0) / allLatencyP99.length
          : 0;
      const avgLatency =
        allLatencyAvg.length > 0
          ? allLatencyAvg.reduce((a, b) => a + b, 0) / allLatencyAvg.length
          : 0;

      return {
        deploymentId,
        slot,
        requestCount: totalRequests,
        errorCount: totalErrors,
        errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
        latencyP50: avgP50,
        latencyP95: avgP95,
        latencyP99: avgP99,
        latencyAvg: avgLatency,
        activeUsers: maxActiveUsers,
        uniqueSessions: maxUniqueSessions,
        memoryUsageMb: lastMemory,
        cpuUsagePercent: lastCpu,
      };
    },

    /**
     * Get time-series data for charts
     */
    async getTimeSeries(
      deploymentId: string,
      timeRange: TimeRange,
      intervalSeconds: number = 3600,
      slot?: string
    ): Promise<TimeSeriesPoint[]> {
      const where: {
        deploymentId: string;
        timestamp: { gte: Date; lte: Date };
        slot?: string | null;
      } = {
        deploymentId,
        timestamp: {
          gte: timeRange.start,
          lte: timeRange.end,
        },
      };

      if (slot) {
        where.slot = slot;
      }

      const metrics = await prisma.pluginMetrics.findMany({
        where,
        orderBy: { timestamp: 'asc' },
      });

      // Group metrics by time bucket
      const buckets = new Map<number, PluginMetrics[]>();

      for (const m of metrics) {
        const bucketTime =
          Math.floor(m.timestamp.getTime() / (intervalSeconds * 1000)) *
          intervalSeconds *
          1000;
        const bucket = buckets.get(bucketTime) || [];
        bucket.push(m);
        buckets.set(bucketTime, bucket);
      }

      // Aggregate each bucket
      const result: TimeSeriesPoint[] = [];

      Array.from(buckets.entries()).forEach(([bucketTime, bucketMetrics]) => {
        let totalRequests = 0;
        let totalErrors = 0;
        let totalLatency = 0;
        let maxActiveUsers = 0;

        for (const m of bucketMetrics) {
          totalRequests += m.requestCount;
          totalErrors += m.errorCount;
          if (m.latencyAvg) totalLatency += m.latencyAvg * m.requestCount;
          maxActiveUsers = Math.max(maxActiveUsers, m.activeUsers);
        }

        result.push({
          timestamp: new Date(bucketTime),
          requestCount: totalRequests,
          errorCount: totalErrors,
          latencyAvg: totalRequests > 0 ? totalLatency / totalRequests : 0,
          activeUsers: maxActiveUsers,
        });
      });

      return result;
    },

    /**
     * Get metrics for the last N minutes
     */
    async getRecentMetrics(
      deploymentId: string,
      minutes: number = 60,
      slot?: string
    ): Promise<AggregatedMetrics> {
      const end = new Date();
      const start = new Date(end.getTime() - minutes * 60 * 1000);

      return this.getMetrics(deploymentId, { start, end }, slot);
    },

    /**
     * Clean up old metrics (retention policy)
     */
    async cleanup(retentionDays: number = RETENTION_DAYS): Promise<number> {
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      const result = await prisma.pluginMetrics.deleteMany({
        where: {
          timestamp: { lt: cutoff },
        },
      });

      return result.count;
    },

    /**
     * Flush all buffered metrics to database
     */
    async flush(): Promise<void> {
      await flushAllBuffers();
    },

    /**
     * Start the metrics collector (with auto-flush)
     */
    start(): void {
      startAutoFlush();
    },

    /**
     * Stop the metrics collector
     */
    async stop(): Promise<void> {
      stopAutoFlush();
      await flushAllBuffers();
    },

    /**
     * Get buffer stats for monitoring
     */
    getBufferStats(): {
      bufferCount: number;
      totalEntries: number;
      oldestEntry: Date | null;
    } {
      let totalEntries = 0;
      let oldestEntry: Date | null = null;

      Array.from(buffers.values()).forEach(buffer => {
        totalEntries += buffer.latencies.length;
        if (!oldestEntry || buffer.lastFlush < oldestEntry) {
          oldestEntry = buffer.lastFlush;
        }
      });

      return {
        bufferCount: buffers.size,
        totalEntries,
        oldestEntry,
      };
    },
  };
}

export type MetricsCollector = ReturnType<typeof createMetricsCollector>;
