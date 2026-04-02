/**
 * Dashboard Provider Tests
 *
 * Tests that the provider correctly:
 * 1. Registers as a dashboard:query handler
 * 2. Fetches widget-ready JSON from the BFF /api/v1/dashboard/* routes
 * 3. Handles partial queries
 * 4. Returns protocol and fees from BFF, KPI/pipelines/GPU from BFF
 * 5. Cleans up handlers on unmount
 *
 * The BFF fetch is stubbed so tests run offline and deterministically.
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
// BFF stub responses
// ============================================================================

const STUB_KPI = {
  successRate: { value: 100, delta: 0 },
  orchestratorsOnline: { value: 2, delta: 0 },
  dailyUsageMins: { value: 14, delta: 0 },
  dailySessionCount: { value: 9, delta: 0 },
  dailyNetworkFeesEth: { value: 0, delta: 0 },
  timeframeHours: 24,
};

const STUB_PROTOCOL = {
  currentRound: 4127,
  blockProgress: 2880,
  totalBlocks: 5760,
  totalStakedLPT: 30000000,
};

const STUB_FEES = {
  totalEth: 102.4,
  totalUsd: 250000,
  oneDayVolumeUsd: 1248,
  oneDayVolumeEth: 0.52,
  oneWeekVolumeUsd: 2328,
  oneWeekVolumeEth: 0.97,
  volumeChangeUsd: 15.56,
  volumeChangeEth: 15.56,
  weeklyVolumeChangeUsd: 0,
  weeklyVolumeChangeEth: 0,
  dayData: [
    { dateS: 1709078400, volumeEth: 0.45, volumeUsd: 1080 },
    { dateS: 1709164800, volumeEth: 0.52, volumeUsd: 1248 },
  ],
  weeklyData: [
    { date: 1708905600, weeklyVolumeEth: 0.97, weeklyVolumeUsd: 2328 },
  ],
};

const STUB_PIPELINES = [
  { name: 'StreamDiffusion (Image)', mins: 10, color: '#8b5cf6', modelMins: undefined },
  { name: 'StreamDiffusion (Video)', mins: 9, color: '#10b981', modelMins: undefined },
];

const STUB_GPU_CAPACITY = {
  totalGPUs: 2,
  availableCapacity: 100,
  models: [],
};

const STUB_PRICING = [
  {
    pipeline: 'streamdiffusion-sdxl',
    unit: 'live-video-to-video',
    price: 2578,
    pixelsPerUnit: 1,
    outputPerDollar: '—',
  },
];

const STUB_PIPELINE_CATALOG = [
  { id: 'live-video-to-video', name: 'live-video-to-video', models: ['streamdiffusion-sdxl'] },
  { id: 'text-to-image', name: 'Text-to-Image', models: ['black-forest-labs/FLUX.1-dev'] },
];

const STUB_ORCHESTRATORS = [
  {
    address: '0xaaa',
    knownSessions: 7,
    successSessions: 7,
    successRatio: 100,
    noSwapRatio: 100,
    slaScore: 100,
    pipelines: ['streamdiffusion-sdxl'],
    pipelineModels: [{ pipelineId: 'streamdiffusion-sdxl', modelIds: ['streamdiffusion-sdxl'] }],
    gpuCount: 1,
  },
  {
    address: '0xbbb',
    knownSessions: 2,
    successSessions: 2,
    successRatio: 100,
    noSwapRatio: 100,
    slaScore: 100,
    pipelines: ['streamdiffusion-sdxl-v2v'],
    pipelineModels: [{ pipelineId: 'streamdiffusion-sdxl-v2v', modelIds: ['streamdiffusion-sdxl-v2v'] }],
    gpuCount: 1,
  },
];

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
// Fetch stub for BFF endpoints
// ============================================================================

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      const parsedUrl = new URL(urlStr, 'http://test');
      const pathname = parsedUrl.pathname;

      if (pathname === '/api/v1/dashboard/kpi') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(STUB_KPI),
        } as Response);
      }

      if (pathname === '/api/v1/dashboard/protocol') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(STUB_PROTOCOL),
        } as Response);
      }

      if (pathname === '/api/v1/dashboard/fees') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(STUB_FEES),
        } as Response);
      }

      if (pathname === '/api/v1/dashboard/pipelines') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(STUB_PIPELINES),
        } as Response);
      }

      if (pathname === '/api/v1/dashboard/gpu-capacity') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(STUB_GPU_CAPACITY),
        } as Response);
      }

      if (pathname === '/api/v1/dashboard/pipeline-catalog') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(STUB_PIPELINE_CATALOG),
        } as Response);
      }

      if (pathname === '/api/v1/dashboard/orchestrators') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(STUB_ORCHESTRATORS),
        } as Response);
      }

      if (pathname === '/api/v1/dashboard/pricing') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(STUB_PRICING),
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
        kpi { successRate { value delta } orchestratorsOnline { value delta } dailyUsageMins { value delta } dailySessionCount { value delta } }
        protocol { currentRound blockProgress totalBlocks totalStakedLPT }
        fees(days: 7) { totalEth totalUsd oneDayVolumeUsd dayData { dateS volumeEth volumeUsd } weeklyData { date weeklyVolumeUsd weeklyVolumeEth } }
        pipelines { name mins color }
        gpuCapacity { totalGPUs availableCapacity }
        pricing { pipeline unit price pixelsPerUnit outputPerDollar }
      }`,
    };

    const response = (await testEventBus._invoke(
      DASHBOARD_QUERY_EVENT,
      request
    )) as DashboardQueryResponse;

    expect(response.errors).toBeUndefined();
    expect(response.data).toBeDefined();

    // KPI: values come from BFF stub
    expect(response.data!.kpi).toBeDefined();
    expect(typeof response.data!.kpi!.successRate.value).toBe('number');
    expect(response.data!.kpi!.successRate.value).toBeGreaterThanOrEqual(0);
    expect(response.data!.kpi!.successRate.value).toBeLessThanOrEqual(100);
    expect(typeof response.data!.kpi!.orchestratorsOnline.value).toBe('number');
    expect(response.data!.kpi!.orchestratorsOnline.value).toBeGreaterThan(0);
    expect(response.data!.kpi!.dailyUsageMins.value).toBeGreaterThanOrEqual(0);
    expect(response.data!.kpi!.dailySessionCount.value).toBeGreaterThanOrEqual(0);

    // Protocol (from BFF)
    expect(response.data!.protocol).toBeDefined();
    expect(response.data!.protocol!.currentRound).toBe(4127);
    expect(response.data!.protocol!.totalBlocks).toBe(5760);
    expect(response.data!.protocol!.blockProgress).toBeGreaterThanOrEqual(0);

    // Fees (from BFF)
    expect(response.data!.fees).toBeDefined();
    expect(response.data!.fees!.totalEth).toBe(102.4);
    expect(response.data!.fees!.totalUsd).toBe(250000);
    expect(response.data!.fees!.dayData.length).toBeGreaterThan(0);

    // Pipelines: from BFF, only non-null display names
    expect(response.data!.pipelines).toBeDefined();
    expect(response.data!.pipelines!.length).toBeGreaterThan(0);
    expect(response.data!.pipelines!.every(p => typeof p.name === 'string')).toBe(true);
    expect(response.data!.pipelines!.every(p => p.mins >= 0)).toBe(true);
    expect(response.data!.pipelines!.some(p => p.name === 'noop')).toBe(false);

    // GPU: count from stub (2 distinct GPU IDs)
    expect(response.data!.gpuCapacity).toBeDefined();
    expect(response.data!.gpuCapacity!.totalGPUs).toBe(2);
    expect(response.data!.gpuCapacity!.availableCapacity).toBe(100);

    // Pricing: BFF-backed aggregate
    expect(response.data!.pricing).toBeDefined();
    expect(response.data!.pricing!.length).toBeGreaterThan(0);
    expect(response.data!.pricing![0]).toMatchObject({
      pipeline: expect.any(String),
      unit: expect.any(String),
      price: expect.any(Number),
      pixelsPerUnit: expect.any(Number),
      outputPerDollar: expect.any(String),
    });
  });

  it('returns protocol null and errors when BFF fails', async () => {
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
