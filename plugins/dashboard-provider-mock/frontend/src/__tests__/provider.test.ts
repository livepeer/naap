/**
 * Dashboard Provider Tests
 *
 * Tests that the provider correctly:
 * 1. Registers as a dashboard:query handler
 * 2. Transforms leaderboard API responses into the dashboard contract shape
 * 3. Handles partial queries
 * 4. Returns static fallbacks for protocol / fees / pricing
 * 5. Cleans up handlers on unmount
 *
 * The leaderboard API (fetch) is fully mocked so tests run offline and
 * deterministically without hitting the real endpoint.
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
import { registerMockDashboardProvider } from '../provider.js';
import { registerMockJobFeedEmitter } from '../job-feed-emitter.js';

// ============================================================================
// Leaderboard API stub data
// ============================================================================

/** Two 1-hour windows, 3 gateway×pipeline combos each */
const STUB_DEMAND_1H = [
  // Latest window — success_ratio 1.0, 5 sessions
  { window_start: '2026-02-24T22:00:00Z', gateway: 'gw-a', region: null, pipeline: 'streamdiffusion-sdxl',
    total_sessions: 3, total_streams: 3, avg_output_fps: 7.5, total_inference_minutes: 1.5,
    known_sessions: 3, served_sessions: 3, unserved_sessions: 0, total_demand_sessions: 3,
    unexcused_sessions: 0, swapped_sessions: 0, missing_capacity_count: 0,
    success_ratio: 1.0, fee_payment_eth: 0 },
  { window_start: '2026-02-24T22:00:00Z', gateway: 'gw-a', region: null, pipeline: 'streamdiffusion-sdxl-v2v',
    total_sessions: 2, total_streams: 2, avg_output_fps: 7.0, total_inference_minutes: 0.8,
    known_sessions: 2, served_sessions: 2, unserved_sessions: 0, total_demand_sessions: 2,
    unexcused_sessions: 0, swapped_sessions: 0, missing_capacity_count: 0,
    success_ratio: 1.0, fee_payment_eth: 0 },
  // Previous window — success_ratio 0.9
  { window_start: '2026-02-24T21:00:00Z', gateway: 'gw-a', region: null, pipeline: 'streamdiffusion-sdxl',
    total_sessions: 4, total_streams: 4, avg_output_fps: 7.2, total_inference_minutes: 2.0,
    known_sessions: 4, served_sessions: 4, unserved_sessions: 0, total_demand_sessions: 4,
    unexcused_sessions: 0, swapped_sessions: 0, missing_capacity_count: 0,
    success_ratio: 0.9, fee_payment_eth: 0 },
];

/** 24-hour demand window (interval=2h) */
const STUB_DEMAND_2H = [
  { window_start: '2026-02-24T20:00:00Z', gateway: 'gw-a', region: null, pipeline: 'streamdiffusion-sdxl',
    total_sessions: 10, total_streams: 10, avg_output_fps: 7.5, total_inference_minutes: 5.0,
    known_sessions: 10, served_sessions: 10, unserved_sessions: 0, total_demand_sessions: 10,
    unexcused_sessions: 0, swapped_sessions: 0, missing_capacity_count: 0,
    success_ratio: 1.0, fee_payment_eth: 0 },
  { window_start: '2026-02-24T20:00:00Z', gateway: 'gw-a', region: null, pipeline: 'streamdiffusion-sdxl-v2v',
    total_sessions: 7, total_streams: 7, avg_output_fps: 7.0, total_inference_minutes: 8.5,
    known_sessions: 7, served_sessions: 7, unserved_sessions: 0, total_demand_sessions: 7,
    unexcused_sessions: 0, swapped_sessions: 0, missing_capacity_count: 0,
    success_ratio: 1.0, fee_payment_eth: 0 },
];

/** Two 1-hour SLA windows with distinct orchestrators */
const STUB_SLA = [
  { window_start: '2026-02-24T22:00:00Z', orchestrator_address: '0xaaa', pipeline: 'streamdiffusion-sdxl',
    gpu_id: 'GPU-1', known_sessions: 3, success_sessions: 3,
    success_ratio: 1.0, no_swap_ratio: 1.0, sla_score: 100 },
  { window_start: '2026-02-24T22:00:00Z', orchestrator_address: '0xbbb', pipeline: 'streamdiffusion-sdxl-v2v',
    gpu_id: 'GPU-2', known_sessions: 2, success_sessions: 2,
    success_ratio: 1.0, no_swap_ratio: 1.0, sla_score: 100 },
  { window_start: '2026-02-24T21:00:00Z', orchestrator_address: '0xaaa', pipeline: 'streamdiffusion-sdxl',
    gpu_id: 'GPU-1', known_sessions: 4, success_sessions: 4,
    success_ratio: 1.0, no_swap_ratio: 1.0, sla_score: 100 },
];

/** GPU metrics for 1-hour window */
const STUB_GPU = [
  { window_start: '2026-02-24T22:00:00Z', orchestrator_address: '0xaaa',
    pipeline: 'streamdiffusion-sdxl', model_id: 'streamdiffusion-sdxl',
    gpu_id: 'GPU-1', region: null, avg_output_fps: 7.5, p95_output_fps: 12.0,
    known_sessions: 3, success_sessions: 3, failure_rate: 0, swap_rate: 0 },
  { window_start: '2026-02-24T22:00:00Z', orchestrator_address: '0xbbb',
    pipeline: 'streamdiffusion-sdxl-v2v', model_id: 'streamdiffusion-sdxl-v2v',
    gpu_id: 'GPU-2', region: null, avg_output_fps: 7.0, p95_output_fps: 11.0,
    known_sessions: 2, success_sessions: 2, failure_rate: 0, swap_rate: 0 },
];

// ============================================================================
// Fetch mock
// ============================================================================

function makeFetchMock() {
  return vi.fn((url: string) => {
    let body: unknown;
    if (url.includes('/api/network/demand')) {
      const interval = new URL(url).searchParams.get('interval') ?? '1h';
      body = { demand: interval === '2h' ? STUB_DEMAND_2H : STUB_DEMAND_1H };
    } else if (url.includes('/api/gpu/metrics')) {
      body = { metrics: STUB_GPU };
    } else if (url.includes('/api/sla/compliance')) {
      body = { compliance: STUB_SLA };
    } else {
      body = {};
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response);
  });
}

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
    vi.stubGlobal('fetch', makeFetchMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers a handler for dashboard:query', () => {
    registerMockDashboardProvider(mockEventBus as any);
    expect(mockEventBus._hasHandler(DASHBOARD_QUERY_EVENT)).toBe(true);
  });

  it('returns the correct shape for a full query', async () => {
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

    // KPI: values come from leaderboard API stub
    expect(response.data!.kpi).toBeDefined();
    expect(typeof response.data!.kpi!.successRate.value).toBe('number');
    expect(response.data!.kpi!.successRate.value).toBeGreaterThanOrEqual(0);
    expect(response.data!.kpi!.successRate.value).toBeLessThanOrEqual(100);
    expect(typeof response.data!.kpi!.orchestratorsOnline.value).toBe('number');
    expect(response.data!.kpi!.orchestratorsOnline.value).toBeGreaterThan(0);
    expect(response.data!.kpi!.dailyUsageMins.value).toBeGreaterThanOrEqual(0);
    expect(response.data!.kpi!.dailyStreamCount.value).toBeGreaterThanOrEqual(0);

    // Protocol: static fallback
    expect(response.data!.protocol).toBeDefined();
    expect(response.data!.protocol!.currentRound).toBe(4127);

    // Fees: static fallback
    expect(response.data!.fees).toBeDefined();
    expect(response.data!.fees!.totalEth).toBe(102.4);
    expect(response.data!.fees!.entries).toHaveLength(7);

    // Pipelines: from API, only non-null display names
    expect(response.data!.pipelines).toBeDefined();
    expect(response.data!.pipelines!.length).toBeGreaterThan(0);
    expect(response.data!.pipelines!.every(p => typeof p.name === 'string')).toBe(true);
    expect(response.data!.pipelines!.every(p => p.mins >= 0)).toBe(true);
    // 'noop' pipeline should be excluded
    expect(response.data!.pipelines!.some(p => p.name === 'noop')).toBe(false);

    // GPU: count from stub (2 distinct GPU IDs)
    expect(response.data!.gpuCapacity).toBeDefined();
    expect(response.data!.gpuCapacity!.totalGPUs).toBe(2);
    expect(response.data!.gpuCapacity!.availableCapacity).toBe(100);

    // Pricing: static fallback
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

    expect(typeof response.data!.kpi!.successRate.value).toBe('number');
    // Other fields not requested
    expect(response.data!.protocol).toBeUndefined();
    expect(response.data!.fees).toBeUndefined();
  });

  it('success rate is 100 when all sessions succeed', async () => {
    registerMockDashboardProvider(mockEventBus as any);

    const response = (await mockEventBus._invoke(DASHBOARD_QUERY_EVENT, {
      query: '{ kpi { successRate { value delta } } }',
    })) as DashboardQueryResponse;

    // Latest window has success_ratio 1.0 → 100%
    expect(response.data!.kpi!.successRate.value).toBe(100);
    // Delta: 100 (latest) - 90 (prev, ratio 0.9 × 100 = 90)
    expect(response.data!.kpi!.successRate.delta).toBe(10);
  });

  it('pipelines are sorted by inference minutes descending', async () => {
    registerMockDashboardProvider(mockEventBus as any);

    const response = (await mockEventBus._invoke(DASHBOARD_QUERY_EVENT, {
      query: '{ pipelines { name mins } }',
    })) as DashboardQueryResponse;

    const pipelines = response.data!.pipelines!;
    expect(pipelines.length).toBe(2);
    // streamdiffusion-sdxl-v2v has 8.5 mins > streamdiffusion-sdxl's 5.0 mins
    expect(pipelines[0].mins).toBeGreaterThanOrEqual(pipelines[1].mins);
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

// Need afterEach at module level for fake timer cleanup
afterEach(() => {
  vi.useRealTimers();
});
