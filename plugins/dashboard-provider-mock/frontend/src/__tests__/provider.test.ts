/**
 * Mock Dashboard Provider Tests
 *
 * Tests that the mock plugin correctly:
 * 1. Registers as a dashboard:query handler
 * 2. Responds with correct mock data shapes
 * 3. Handles partial queries
 * 4. Registers as a job-feed:subscribe handler
 * 5. Cleans up handlers on unmount
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DASHBOARD_QUERY_EVENT,
  DASHBOARD_JOB_FEED_EVENT,
  DASHBOARD_JOB_FEED_EMIT_EVENT,
  type DashboardQueryRequest,
  type DashboardQueryResponse,
  type JobFeedSubscribeResponse,
} from '@naap/plugin-sdk';
import { registerMockDashboardProvider } from '../provider.js';
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
// Tests: Dashboard Query Provider
// ============================================================================

describe('registerMockDashboardProvider', () => {
  let mockEventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    mockEventBus = createMockEventBus();
  });

  it('registers a handler for dashboard:query', () => {
    registerMockDashboardProvider(mockEventBus as any);
    expect(mockEventBus._hasHandler(DASHBOARD_QUERY_EVENT)).toBe(true);
  });

  it('returns all mock data for a full query', async () => {
    registerMockDashboardProvider(mockEventBus as any);

    const request: DashboardQueryRequest = {
      query: `{
        kpi { successRate { value delta } orchestratorsOnline { value delta } dailyUsageMins { value delta } dailyStreamCount { value delta } }
        protocol { currentRound blockProgress totalBlocks totalStakedLPT }
        fees { totalEth entries { day eth } }
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

    // Protocol
    expect(response.data!.protocol).toBeDefined();
    expect(response.data!.protocol!.currentRound).toBe(4127);

    // Fees
    expect(response.data!.fees).toBeDefined();
    expect(response.data!.fees!.totalEth).toBe(102.4);
    expect(response.data!.fees!.entries).toHaveLength(7);

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

  it('returns only requested fields for partial queries', async () => {
    registerMockDashboardProvider(mockEventBus as any);

    const request: DashboardQueryRequest = {
      query: '{ kpi { successRate { value } } }',
    };

    const response = (await mockEventBus._invoke(
      DASHBOARD_QUERY_EVENT,
      request
    )) as DashboardQueryResponse;

    expect(response.data!.kpi!.successRate.value).toBe(97.3);
    // Other fields not requested
    expect(response.data!.protocol).toBeUndefined();
    expect(response.data!.fees).toBeUndefined();
  });

  it('cleanup unregisters the handler', () => {
    const cleanup = registerMockDashboardProvider(mockEventBus as any);
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

    // Should have emitted seed jobs immediately
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

    // Advance time by one interval
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

    // No more emissions after cleanup
    const countBefore = mockEventBus.emit.mock.calls.length;
    vi.advanceTimersByTime(10000);
    const countAfter = mockEventBus.emit.mock.calls.length;

    expect(countAfter).toBe(countBefore);
  });
});

// Need afterEach at module level for fake timer cleanup
afterEach(() => {
  vi.useRealTimers();
});
