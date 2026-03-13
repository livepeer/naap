import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    connectorMetrics: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { summarizeMetricsForDescriptor } from '../metrics';

describe('summarizeMetricsForDescriptor', () => {
  it('returns null for null input', () => {
    expect(summarizeMetricsForDescriptor(null)).toBeNull();
  });

  it('maps ConnectorMetrics DB row to PerformanceMetrics interface', () => {
    const row = {
      totalRequests: 15000,
      errorRate: 0.018,
      successRate: 0.982,
      latencyMeanMs: 450,
      latencyP50Ms: 320,
      latencyP95Ms: 1200,
      latencyP99Ms: 2800,
      upstreamLatencyMeanMs: 410,
      gatewayOverheadMs: 40,
      availabilityPercent: 99.7,
      throughputRpm: 2500,
      period: 'daily',
    };

    const result = summarizeMetricsForDescriptor(row);
    expect(result).not.toBeNull();
    expect(result!.errorRate).toBe(0.018);
    expect(result!.successRate).toBe(0.982);
    expect(result!.latencyMeanMs).toBe(450);
    expect(result!.latencyP50Ms).toBe(320);
    expect(result!.latencyP95Ms).toBe(1200);
    expect(result!.latencyP99Ms).toBe(2800);
    expect(result!.upstreamLatencyMeanMs).toBe(410);
    expect(result!.gatewayOverheadMs).toBe(40);
    expect(result!.availabilityPercent).toBe(99.7);
    expect(result!.throughputRpm).toBe(2500);
    expect(result!.period).toBe('24h');
    expect(result!.sampleSize).toBe(15000);
  });

  it('computes sampleSize from totalRequests', () => {
    const row = {
      totalRequests: 42,
      errorRate: 0,
      successRate: 1,
      latencyMeanMs: 100,
      latencyP50Ms: 90,
      latencyP95Ms: 200,
      latencyP99Ms: 300,
      upstreamLatencyMeanMs: 80,
      gatewayOverheadMs: 20,
      availabilityPercent: 100,
      throughputRpm: 10,
      period: 'hourly',
    };

    const result = summarizeMetricsForDescriptor(row);
    expect(result!.sampleSize).toBe(42);
  });

  it('sets period string correctly for hourly', () => {
    const row = {
      totalRequests: 100,
      errorRate: 0,
      successRate: 1,
      latencyMeanMs: 100,
      latencyP50Ms: 90,
      latencyP95Ms: 200,
      latencyP99Ms: 300,
      upstreamLatencyMeanMs: 80,
      gatewayOverheadMs: 20,
      availabilityPercent: 100,
      throughputRpm: 10,
      period: 'hourly',
    };

    const result = summarizeMetricsForDescriptor(row);
    expect(result!.period).toBe('1h');
  });
});
