/**
 * Dashboard Provider Tests
 *
 * Tests that the provider correctly:
 * 1. Registers as a dashboard:query handler
 * 2. Transforms leaderboard API + subgraph responses into the dashboard contract shape
 * 3. Handles partial queries
 * 4. Resolves protocol and fees from subgraph/L1, KPI/pipelines/GPU from leaderboard
 * 5. Cleans up handlers on unmount
 *
 * The leaderboard API (fetch) is stubbed so tests run offline and
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
import { registerDashboardProvider } from '../provider.js';
import { registerJobFeedEmitter } from '../job-feed-emitter.js';

// ============================================================================
// Leaderboard API stub data
// ============================================================================

const STUB_DEMAND_1H = [
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
  { window_start: '2026-02-24T21:00:00Z', gateway: 'gw-a', region: null, pipeline: 'streamdiffusion-sdxl',
    total_sessions: 4, total_streams: 4, avg_output_fps: 7.2, total_inference_minutes: 2.0,
    known_sessions: 4, served_sessions: 4, unserved_sessions: 0, total_demand_sessions: 4,
    unexcused_sessions: 0, swapped_sessions: 0, missing_capacity_count: 0,
    success_ratio: 0.9, fee_payment_eth: 0 },
];

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

const STUB_SLA = [
  { window_start: '2026-02-24T22:00:00Z', orchestrator_address: '0xaaa', pipeline: 'streamdiffusion-sdxl', model_id: 'streamdiffusion-sdxl',
    gpu_id: 'GPU-1', known_sessions: 3, success_sessions: 3,
    success_ratio: 1.0, no_swap_ratio: 1.0, sla_score: 100 },
  { window_start: '2026-02-24T22:00:00Z', orchestrator_address: '0xbbb', pipeline: 'streamdiffusion-sdxl-v2v', model_id: 'streamdiffusion-sdxl-v2v',
    gpu_id: 'GPU-2', known_sessions: 2, success_sessions: 2,
    success_ratio: 1.0, no_swap_ratio: 1.0, sla_score: 100 },
  { window_start: '2026-02-24T21:00:00Z', orchestrator_address: '0xaaa', pipeline: 'streamdiffusion-sdxl', model_id: 'streamdiffusion-sdxl',
    gpu_id: 'GPU-1', known_sessions: 4, success_sessions: 4,
    success_ratio: 1.0, no_swap_ratio: 1.0, sla_score: 100 },
];

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
// Fetch stub
// ============================================================================

// (fetch stub merged into stubFetch below)

// ============================================================================
// Test Event Bus
// ============================================================================

function createTestEventBus() {
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
      const parsedUrl = new URL(urlStr, 'http://test');
      const pathname = parsedUrl.pathname;

      // Leaderboard API endpoints (proxy path: /api/v1/leaderboard/...)
      if (pathname.startsWith('/api/v1/leaderboard/network/demand')) {
        const interval = parsedUrl.searchParams.get('interval') ?? '5m';
        // fetchNetworkDemand(lookbackHours) sends interval as minutes: 24h→120m, 2h→10m, 1h→5m
        const demand = interval === '120m' || interval === '10m' ? STUB_DEMAND_2H : STUB_DEMAND_1H;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ demand }),
        } as Response);
      }

      if (pathname.startsWith('/api/v1/leaderboard/gpu/metrics')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ metrics: STUB_GPU }),
        } as Response);
      }

      if (pathname.startsWith('/api/v1/leaderboard/sla/compliance')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ compliance: STUB_SLA }),
        } as Response);
      }

      if (pathname.startsWith('/api/v1/leaderboard/pipelines')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            pipelines: [
              { id: 'live-video-to-video', models: ['streamdiffusion-sdxl'], regions: ['FRA', 'LAX'] },
              { id: 'text-to-image', models: ['black-forest-labs/FLUX.1-dev'], regions: ['MDW'] },
            ],
          }),
        } as Response);
      }

      // Subgraph endpoint
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

      // Protocol block endpoint
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
  let testEventBus: ReturnType<typeof createTestEventBus>;

  beforeEach(() => {
    testEventBus = createTestEventBus();
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers a handler for dashboard:query', () => {
    registerDashboardProvider(testEventBus as any);
    expect(testEventBus._hasHandler(DASHBOARD_QUERY_EVENT)).toBe(true);
  });

  it('returns the correct shape for a full query', async () => {
    registerDashboardProvider(testEventBus as any);

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

    const response = (await testEventBus._invoke(
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

    // Pipelines: from API, only non-null display names
    expect(response.data!.pipelines).toBeDefined();
    expect(response.data!.pipelines!.length).toBeGreaterThan(0);
    expect(response.data!.pipelines!.every(p => typeof p.name === 'string')).toBe(true);
    expect(response.data!.pipelines!.every(p => p.mins >= 0)).toBe(true);
    expect(response.data!.pipelines!.some(p => p.name === 'noop')).toBe(false);

    // GPU: count from stub (2 distinct GPU IDs)
    expect(response.data!.gpuCapacity).toBeDefined();
    expect(response.data!.gpuCapacity!.totalGPUs).toBe(2);
    expect(response.data!.gpuCapacity!.availableCapacity).toBe(100);

    // Pricing: static fallback
    expect(response.data!.pricing).toBeDefined();
  });

  it('returns protocol null and errors when subgraph or protocol-block fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 503 } as Response))
    );
    registerDashboardProvider(testEventBus as any);

    const response = (await testEventBus._invoke(DASHBOARD_QUERY_EVENT, {
      query: '{ protocol { currentRound blockProgress totalBlocks totalStakedLPT } }',
    })) as DashboardQueryResponse;

    expect(response.data?.protocol).toBeNull();
    expect(response.errors).toBeDefined();
    expect(response.errors!.length).toBeGreaterThan(0);
  });

  it('returns only requested fields for partial queries', async () => {
    registerDashboardProvider(testEventBus as any);

    const request: DashboardQueryRequest = {
      query: '{ kpi { successRate { value } } }',
    };

    const response = (await testEventBus._invoke(
      DASHBOARD_QUERY_EVENT,
      request
    )) as DashboardQueryResponse;

    expect(typeof response.data!.kpi!.successRate.value).toBe('number');
    expect(response.data!.protocol).toBeUndefined();
    expect(response.data!.fees).toBeUndefined();
  });

  it('success rate is 100 when all sessions succeed', async () => {
    registerDashboardProvider(testEventBus as any);

    const response = (await testEventBus._invoke(DASHBOARD_QUERY_EVENT, {
      query: '{ kpi { successRate { value delta } } }',
    })) as DashboardQueryResponse;

    expect(response.data!.kpi!.successRate.value).toBe(100);
    expect(response.data!.kpi!.successRate.delta).toBe(0);
  });

  it('pipelines are sorted by inference minutes descending', async () => {
    registerDashboardProvider(testEventBus as any);

    const response = (await testEventBus._invoke(DASHBOARD_QUERY_EVENT, {
      query: '{ pipelines { name mins } }',
    })) as DashboardQueryResponse;

    const pipelines = response.data!.pipelines!;
    expect(pipelines.length).toBe(2);
    expect(pipelines[0].mins).toBeGreaterThanOrEqual(pipelines[1].mins);
  });

  it('returns pipeline catalog with all supported models', async () => {
    registerDashboardProvider(testEventBus as any);

    const response = (await testEventBus._invoke(DASHBOARD_QUERY_EVENT, {
      query: '{ pipelineCatalog { id name models } }',
    })) as DashboardQueryResponse;

    expect(response.errors).toBeUndefined();
    const catalog = response.data!.pipelineCatalog!;
    expect(catalog.length).toBe(2);

    const liveVideo = catalog.find(p => p.id === 'live-video-to-video');
    expect(liveVideo).toBeDefined();
    expect(liveVideo!.models).toContain('streamdiffusion-sdxl');
  });

  it('returns orchestrators aggregated from SLA compliance data', async () => {
    registerDashboardProvider(testEventBus as any);

    const response = (await testEventBus._invoke(DASHBOARD_QUERY_EVENT, {
      query: '{ orchestrators { address knownSessions successSessions successRatio noSwapRatio slaScore pipelines pipelineModels { pipelineId modelIds } gpuCount } }',
    })) as DashboardQueryResponse;

    expect(response.errors).toBeUndefined();
    const orchs = response.data!.orchestrators!;
    expect(orchs.length).toBe(2);

    const byAddr = new Map(orchs.map(o => [o.address, o]));

    const orchA = byAddr.get('0xaaa')!;
    expect(orchA).toBeDefined();
    expect(orchA.knownSessions).toBe(7);
    expect(orchA.successSessions).toBe(7);
    expect(orchA.successRatio).toBe(100);
    expect(orchA.noSwapRatio).toBe(100);
    expect(orchA.slaScore).toBe(100);
    expect(orchA.gpuCount).toBe(1);
    expect(orchA.pipelines).toContain('streamdiffusion-sdxl');
    expect(orchA.pipelineModels).toEqual([{ pipelineId: 'streamdiffusion-sdxl', modelIds: ['streamdiffusion-sdxl'] }]);

    const orchB = byAddr.get('0xbbb')!;
    expect(orchB).toBeDefined();
    expect(orchB.knownSessions).toBe(2);
    expect(orchB.pipelineModels).toEqual([{ pipelineId: 'streamdiffusion-sdxl-v2v', modelIds: ['streamdiffusion-sdxl-v2v'] }]);
  });

  it('cleanup unregisters the handler', () => {
    const cleanup = registerDashboardProvider(testEventBus as any);
    expect(testEventBus._hasHandler(DASHBOARD_QUERY_EVENT)).toBe(true);

    cleanup();
    expect(testEventBus._hasHandler(DASHBOARD_QUERY_EVENT)).toBe(false);
  });
});

// ============================================================================
// Tests: Job Feed Emitter
// ============================================================================

describe('registerJobFeedEmitter', () => {
  let testEventBus: ReturnType<typeof createTestEventBus>;

  beforeEach(() => {
    vi.useFakeTimers();
    testEventBus = createTestEventBus();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers a handler for dashboard:job-feed:subscribe', () => {
    registerJobFeedEmitter(testEventBus as any);
    expect(testEventBus._hasHandler(DASHBOARD_JOB_FEED_EVENT)).toBe(true);
  });

  it('returns event bus fallback mode on subscribe', async () => {
    registerJobFeedEmitter(testEventBus as any);

    const response = (await testEventBus._invoke(
      DASHBOARD_JOB_FEED_EVENT,
      undefined
    )) as JobFeedSubscribeResponse;

    expect(response.useEventBusFallback).toBe(true);
    expect(response.channelName).toBeNull();
    expect(response.eventName).toBe('job');
  });

  it('does not emit mock jobs (Coming soon mode)', () => {
    registerJobFeedEmitter(testEventBus as any);

    const emitCalls = testEventBus.emit.mock.calls.filter(
      (call: any[]) => call[0] === DASHBOARD_JOB_FEED_EMIT_EVENT
    );
    expect(emitCalls.length).toBe(0);
  });

  it('cleanup unregisters handler', () => {
    const cleanup = registerJobFeedEmitter(testEventBus as any);

    cleanup();

    expect(testEventBus._hasHandler(DASHBOARD_JOB_FEED_EVENT)).toBe(false);
  });
});
