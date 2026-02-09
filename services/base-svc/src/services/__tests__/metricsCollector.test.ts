/**
 * Metrics Collector Service Tests
 * Tests for high-frequency metrics collection with buffering
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMetricsCollector } from '../metricsCollector.js';

// Mock Prisma client
const mockPrisma = {
  pluginMetrics: {
    create: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
};

describe('MetricsCollector', () => {
  let metricsCollector: ReturnType<typeof createMetricsCollector>;
  const deploymentId = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    vi.clearAllMocks();
    metricsCollector = createMetricsCollector(mockPrisma as any);
    mockPrisma.pluginMetrics.create.mockResolvedValue({ id: 'metric-1' });
  });

  afterEach(async () => {
    await metricsCollector.stop();
  });

  describe('recordRequest', () => {
    it('should buffer request metrics', () => {
      metricsCollector.recordRequest({
        deploymentId,
        statusCode: 200,
        latencyMs: 100,
      });

      const stats = metricsCollector.getBufferStats();
      expect(stats.totalEntries).toBe(1);
    });

    it('should count errors for status codes >= 400', () => {
      metricsCollector.recordRequest({
        deploymentId,
        statusCode: 500,
        latencyMs: 50,
      });

      const stats = metricsCollector.getBufferStats();
      expect(stats.totalEntries).toBe(1);
    });

    it('should track unique users and sessions', () => {
      metricsCollector.recordRequest({
        deploymentId,
        statusCode: 200,
        latencyMs: 100,
        userId: 'user-1',
        sessionId: 'session-1',
      });

      metricsCollector.recordRequest({
        deploymentId,
        statusCode: 200,
        latencyMs: 150,
        userId: 'user-1', // Same user
        sessionId: 'session-2', // Different session
      });

      metricsCollector.recordRequest({
        deploymentId,
        statusCode: 200,
        latencyMs: 200,
        userId: 'user-2', // Different user
        sessionId: 'session-3',
      });

      const stats = metricsCollector.getBufferStats();
      expect(stats.totalEntries).toBe(3);
    });

    it('should handle different slots separately', () => {
      metricsCollector.recordRequest({
        deploymentId,
        slot: 'blue',
        statusCode: 200,
        latencyMs: 100,
      });

      metricsCollector.recordRequest({
        deploymentId,
        slot: 'green',
        statusCode: 200,
        latencyMs: 150,
      });

      const stats = metricsCollector.getBufferStats();
      expect(stats.bufferCount).toBe(2);
    });
  });

  describe('recordResourceUsage', () => {
    it('should store resource metrics directly', async () => {
      await metricsCollector.recordResourceUsage({
        deploymentId,
        memoryUsageMb: 256,
        cpuUsagePercent: 45.5,
      });

      expect(mockPrisma.pluginMetrics.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deploymentId,
          memoryUsageMb: 256,
          cpuUsagePercent: 45.5,
        }),
      });
    });
  });

  describe('flush', () => {
    it('should flush buffered metrics to database', async () => {
      // Record some metrics
      for (let i = 0; i < 5; i++) {
        metricsCollector.recordRequest({
          deploymentId,
          statusCode: i < 4 ? 200 : 500, // 1 error
          latencyMs: 100 + i * 10,
          userId: `user-${i % 2}`, // 2 unique users
        });
      }

      await metricsCollector.flush();

      expect(mockPrisma.pluginMetrics.create).toHaveBeenCalled();

      // Buffer should be empty after flush
      const stats = metricsCollector.getBufferStats();
      expect(stats.totalEntries).toBe(0);
    });

    it('should not create records for empty buffers', async () => {
      await metricsCollector.flush();

      expect(mockPrisma.pluginMetrics.create).not.toHaveBeenCalled();
    });
  });

  describe('getMetrics', () => {
    it('should return aggregated metrics for a time range', async () => {
      const now = new Date();
      mockPrisma.pluginMetrics.findMany.mockResolvedValue([
        {
          requestCount: 100,
          errorCount: 5,
          latencyP50: 50,
          latencyP95: 200,
          latencyP99: 500,
          latencyAvg: 75,
          activeUsers: 10,
          uniqueSessions: 15,
          memoryUsageMb: 256,
          cpuUsagePercent: 45,
        },
        {
          requestCount: 150,
          errorCount: 3,
          latencyP50: 45,
          latencyP95: 180,
          latencyP99: 450,
          latencyAvg: 70,
          activeUsers: 12,
          uniqueSessions: 20,
          memoryUsageMb: 280,
          cpuUsagePercent: 50,
        },
      ]);

      const metrics = await metricsCollector.getMetrics(
        deploymentId,
        { start: new Date(now.getTime() - 3600000), end: now }
      );

      expect(metrics.deploymentId).toBe(deploymentId);
      expect(metrics.requestCount).toBe(250);
      expect(metrics.errorCount).toBe(8);
      expect(metrics.errorRate).toBeCloseTo(0.032, 2);
      expect(metrics.activeUsers).toBe(12); // Max
    });

    it('should return empty metrics for no data', async () => {
      mockPrisma.pluginMetrics.findMany.mockResolvedValue([]);

      const metrics = await metricsCollector.getMetrics(
        deploymentId,
        { start: new Date(), end: new Date() }
      );

      expect(metrics.requestCount).toBe(0);
      expect(metrics.errorRate).toBe(0);
      expect(metrics.latencyP99).toBe(0);
    });
  });

  describe('getRecentMetrics', () => {
    it('should return metrics for last N minutes', async () => {
      mockPrisma.pluginMetrics.findMany.mockResolvedValue([
        { requestCount: 100, errorCount: 2, latencyP50: 50, latencyAvg: 60 },
      ]);

      const metrics = await metricsCollector.getRecentMetrics(deploymentId, 60);

      expect(mockPrisma.pluginMetrics.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deploymentId,
            timestamp: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        })
      );
    });
  });

  describe('getTimeSeries', () => {
    it('should return time series data', async () => {
      const baseTime = Date.now();
      mockPrisma.pluginMetrics.findMany.mockResolvedValue([
        {
          timestamp: new Date(baseTime),
          requestCount: 50,
          errorCount: 2,
          latencyAvg: 100,
          activeUsers: 5,
        },
        {
          timestamp: new Date(baseTime + 3600000),
          requestCount: 60,
          errorCount: 1,
          latencyAvg: 90,
          activeUsers: 8,
        },
      ]);

      const timeSeries = await metricsCollector.getTimeSeries(
        deploymentId,
        { start: new Date(baseTime - 3600000), end: new Date(baseTime + 7200000) },
        3600
      );

      expect(timeSeries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cleanup', () => {
    it('should delete old metrics based on retention', async () => {
      mockPrisma.pluginMetrics.deleteMany.mockResolvedValue({ count: 1000 });

      const deletedCount = await metricsCollector.cleanup(30); // 30 days

      expect(deletedCount).toBe(1000);
      expect(mockPrisma.pluginMetrics.deleteMany).toHaveBeenCalledWith({
        where: {
          timestamp: { lt: expect.any(Date) },
        },
      });
    });
  });

  describe('start / stop', () => {
    it('should start auto-flush', () => {
      metricsCollector.start();
      // No direct way to verify, but should not throw
    });

    it('should stop auto-flush and flush remaining', async () => {
      metricsCollector.start();
      metricsCollector.recordRequest({
        deploymentId,
        statusCode: 200,
        latencyMs: 100,
      });

      await metricsCollector.stop();

      // Buffer should be flushed
      const stats = metricsCollector.getBufferStats();
      expect(stats.totalEntries).toBe(0);
    });
  });

  describe('getBufferStats', () => {
    it('should return buffer statistics', () => {
      metricsCollector.recordRequest({
        deploymentId,
        statusCode: 200,
        latencyMs: 100,
      });

      const stats = metricsCollector.getBufferStats();

      expect(stats.bufferCount).toBe(1);
      expect(stats.totalEntries).toBe(1);
      expect(stats.oldestEntry).toBeInstanceOf(Date);
    });

    it('should return empty stats for no data', () => {
      const stats = metricsCollector.getBufferStats();

      expect(stats.bufferCount).toBe(0);
      expect(stats.totalEntries).toBe(0);
      expect(stats.oldestEntry).toBeNull();
    });
  });
});
