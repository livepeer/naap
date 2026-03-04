/**
 * Dashboard Data Provider Tests
 *
 * Tests that the provider correctly:
 * 1. Registers as a dashboard:query handler
 * 2. Transforms live API responses into the dashboard contract shape
 * 3. Handles partial queries
 * 4. Resolves protocol and fees from subgraph/L1 paths, with pricing fallback
 * 5. Cleans up handlers on unmount
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DASHBOARD_QUERY_EVENT,
  DASHBOARD_JOB_FEED_EVENT,
  DASHBOARD_JOB_FEED_EMIT_EVENT,
  type DashboardQueryRequest,
  type DashboardQueryResponse,
  type JobFeedSubscribeResponse,
} from '@naap/plugin-sdk';
import { registerDashboardProvider } from '../provider.js';
import { registerMockJobFeedEmitter } from '../job-feed-emitter.js';

// ============================================================================
// Mock Event Bus
// ============================================================================

function createMockEventBus() {
  const handlers = new Map<string, (data: unknown) => unknown>();
  const listeners = new Map<string, Set<(data: unknown) => void>>();

  return {
    emit: vi.fn((event: string, data?: unknown) => {
      const callbacks = listeners.get(event);
      if (callbacks) {
        callbacks.forEach((cb) => cb(data));
      }
    }),
    on: vi.fn((event: string, callback: (data: unknown) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(callback);
      return () => {
        listeners.get(event)?.delete(callback);
      };
    }),
    off: vi.fn(),
    once: vi.fn(() => vi.fn()),
    request: vi.fn(async (event: string, data?: unknown) => {
      const handler = handlers.get(event);
      if (!handler) {
        const error = new Error(`No handler for: ${event}`);
        (error as any).code = 'NO_HANDLER';
        throw error;
      }
      return handler(data);
    }),
    handleRequest: vi.fn((event: string, handler: (data: unknown) => unknown) => {
      handlers.set(event, handler);
      return () => {
        handlers.delete(event);
      };
    }),
    _hasHandler: (event: string) => handlers.has(event),
    _invoke: async (event: string, data: unknown) => {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`No handler for ${event}`);
      return handler(data);
    },
  };
}

// ============================================================================
// Fetch stubs for subgraph + protocol-block
// ============================================================================

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;

      if (urlStr.includes('/api/v1/subgraph')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: {
                days: [
                  { date: 1709078400, volumeETH: '0.45', volumeUSD: '1080' },
                  { date: 1709164800, volumeETH: '0.52', volumeUSD: '1248' },
                ],
                protocol: {
                  totalVolumeETH: '102.4',
                  totalVolumeUSD: '250000',
                  roundLength: '5760',
                  totalActiveStake: '30000000',
                  currentRound: {
                    id: '4127',
                    startBlock: '21000000',
                    initialized: true,
                  },
                },
              },
            }),
        } as Response);
      }

      if (urlStr.includes('/api/v1/protocol-block')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              blockNumber: 21002880,
              meta: { timestamp: new Date().toISOString() },
            }),
        } as Response);
      }

      return Promise.resolve({ ok: false, status: 404 } as Response);
    })
  );
}

// ============================================================================
// Tests: Dashboard Query Provider
// ============================================================================

describe('registerDashboardProvider', () => {
  let mockEventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    mockEventBus = createMockEventBus();
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers a handler for dashboard:query', () => {
    registerDashboardProvider(mockEventBus as any);
    expect(mockEventBus._hasHandler(DASHBOARD_QUERY_EVENT)).toBe(true);
  });

  it('returns all mock data for a full query', async () => {
    registerDashboardProvider(mockEventBus as any);

    const request: DashboardQueryRequest = {
      query: `{
        kpi { successRate { value delta } orchestratorsOnline { value delta } dailyUsageMins { value delta } dailyStreamCount { value delta } }
        protocol { currentRound blockProgress totalBlocks totalStakedLPT }
        fees(days: 7) { totalEth totalUsd oneDayVolumeUsd dayData { dateS volumeEth volumeUsd } weeklyData { date weeklyVolumeUsd weeklyVolumeEth } }
        pipelines { name mins color }
        gpuCapacity { totalGPUs availableCapacity }
        pricing { pipeline unit price outputPerDollar }
      }`,
    };

    const response = (await mockEventBus._invoke(
      DASHBOARD_QUERY_EVENT,
      request
    )) as DashboardQueryResponse;

    expect(response.errors).toBeUndefined();
    expect(response.data).toBeDefined();

    // KPI
    expect(response.data!.kpi).toBeDefined();
    expect(response.data!.kpi!.successRate.value).toBe(97.3);

    // Protocol (live from subgraph + protocol-block)
    expect(response.data!.protocol).toBeDefined();
    expect(response.data!.protocol!.currentRound).toBe(4127);
    expect(response.data!.protocol!.totalBlocks).toBe(5760);
    expect(response.data!.protocol!.blockProgress).toBeGreaterThanOrEqual(0);

    // Fees (live from subgraph)
    expect(response.data!.fees).toBeDefined();
    expect(response.data!.fees!.totalEth).toBe(102.4);
    expect(response.data!.fees!.totalUsd).toBe(250000);
    expect(response.data!.fees!.dayData.length).toBeGreaterThan(0);

    // Pipelines
    expect(response.data!.pipelines).toBeDefined();
    expect(response.data!.pipelines!.length).toBeGreaterThan(0);

    // GPU
    expect(response.data!.gpuCapacity).toBeDefined();
    expect(response.data!.gpuCapacity!.totalGPUs).toBe(384);

    // Pricing
    expect(response.data!.pricing).toBeDefined();
    expect(response.data!.pricing!.length).toBeGreaterThan(0);
  });

  it('returns protocol null and errors when subgraph or protocol-block fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 503 } as Response))
    );
    registerDashboardProvider(mockEventBus as any);

    const response = (await mockEventBus._invoke(DASHBOARD_QUERY_EVENT, {
      query: '{ protocol { currentRound blockProgress totalBlocks totalStakedLPT } }',
    })) as DashboardQueryResponse;

    expect(response.data?.protocol).toBeNull();
    expect(response.errors).toBeDefined();
    expect(response.errors!.length).toBeGreaterThan(0);
  });

  it('returns only requested fields for partial queries', async () => {
    registerDashboardProvider(mockEventBus as any);

    const request: DashboardQueryRequest = {
      query: '{ kpi { successRate { value } } }',
    };

    const response = (await mockEventBus._invoke(
      DASHBOARD_QUERY_EVENT,
      request
    )) as DashboardQueryResponse;

    expect(response.data!.kpi!.successRate.value).toBe(97.3);
    expect(response.data!.protocol).toBeUndefined();
    expect(response.data!.fees).toBeUndefined();
  });

  it('cleanup unregisters the handler', () => {
    const cleanup = registerDashboardProvider(mockEventBus as any);
    expect(mockEventBus._hasHandler(DASHBOARD_QUERY_EVENT)).toBe(true);

    cleanup();
    expect(mockEventBus._hasHandler(DASHBOARD_QUERY_EVENT)).toBe(false);
  });
});

// ============================================================================
// Tests: Job Feed Emitter
// ============================================================================

describe('registerMockJobFeedEmitter', () => {
  let mockEventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockEventBus = createMockEventBus();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers a handler for dashboard:job-feed:subscribe', () => {
    registerMockJobFeedEmitter(mockEventBus as any);
    expect(mockEventBus._hasHandler(DASHBOARD_JOB_FEED_EVENT)).toBe(true);
  });

  it('returns event bus fallback mode on subscribe', async () => {
    registerMockJobFeedEmitter(mockEventBus as any);

    const response = (await mockEventBus._invoke(
      DASHBOARD_JOB_FEED_EVENT,
      undefined
    )) as JobFeedSubscribeResponse;

    expect(response.useEventBusFallback).toBe(true);
    expect(response.channelName).toBeNull();
    expect(response.eventName).toBe('job');
  });

  it('emits initial seed jobs on registration', () => {
    registerMockJobFeedEmitter(mockEventBus as any);

    expect(mockEventBus.emit).toHaveBeenCalled();
    const emitCalls = mockEventBus.emit.mock.calls.filter(
      (call: any[]) => call[0] === DASHBOARD_JOB_FEED_EMIT_EVENT
    );
    expect(emitCalls.length).toBeGreaterThan(0);
  });

  it('emits new jobs at regular intervals', () => {
    registerMockJobFeedEmitter(mockEventBus as any);

    const initialEmitCount = mockEventBus.emit.mock.calls.filter(
      (call: any[]) => call[0] === DASHBOARD_JOB_FEED_EMIT_EVENT
    ).length;

    vi.advanceTimersByTime(3500);

    const newEmitCount = mockEventBus.emit.mock.calls.filter(
      (call: any[]) => call[0] === DASHBOARD_JOB_FEED_EMIT_EVENT
    ).length;

    expect(newEmitCount).toBeGreaterThan(initialEmitCount);
  });

  it('cleanup stops interval and unregisters handler', () => {
    const cleanup = registerMockJobFeedEmitter(mockEventBus as any);

    cleanup();

    expect(mockEventBus._hasHandler(DASHBOARD_JOB_FEED_EVENT)).toBe(false);

    const countBefore = mockEventBus.emit.mock.calls.length;
    vi.advanceTimersByTime(10000);
    const countAfter = mockEventBus.emit.mock.calls.length;

    expect(countAfter).toBe(countBefore);
  });
});
