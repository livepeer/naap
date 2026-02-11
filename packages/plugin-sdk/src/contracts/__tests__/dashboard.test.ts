/**
 * Dashboard Contract Tests
 *
 * Validates the GraphQL schema, createDashboardProvider helper,
 * event bus wiring, cleanup, partial providers, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSchema, printSchema, parse } from 'graphql';
import {
  DASHBOARD_SCHEMA,
  DASHBOARD_QUERY_EVENT,
  DASHBOARD_JOB_FEED_EVENT,
  DASHBOARD_JOB_FEED_EMIT_EVENT,
  type DashboardQueryRequest,
  type DashboardQueryResponse,
  type DashboardResolvers,
} from '../dashboard.js';
import { createDashboardProvider, getDashboardSchema } from '../createDashboardProvider.js';

// ============================================================================
// Mock Event Bus
// ============================================================================

function createMockEventBus() {
  const handlers = new Map<string, (data: unknown) => unknown>();

  return {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
    off: vi.fn(),
    once: vi.fn(() => vi.fn()),
    request: vi.fn(async (event: string, data?: unknown) => {
      const handler = handlers.get(event);
      if (!handler) {
        const error = new Error(`No handler registered for event: ${event}`);
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
    // Test helper to check if a handler is registered
    _hasHandler: (event: string) => handlers.has(event),
    // Test helper to directly invoke a handler
    _invoke: async (event: string, data: unknown) => {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`No handler for ${event}`);
      return handler(data);
    },
  };
}

// ============================================================================
// Schema Validation
// ============================================================================

describe('DASHBOARD_SCHEMA', () => {
  it('is valid GraphQL (parses without error)', () => {
    expect(() => buildSchema(DASHBOARD_SCHEMA)).not.toThrow();
  });

  it('defines a Query type with expected root fields', () => {
    const schema = buildSchema(DASHBOARD_SCHEMA);
    const queryType = schema.getQueryType();
    expect(queryType).toBeDefined();

    const fields = queryType!.getFields();
    expect(fields).toHaveProperty('kpi');
    expect(fields).toHaveProperty('protocol');
    expect(fields).toHaveProperty('fees');
    expect(fields).toHaveProperty('pipelines');
    expect(fields).toHaveProperty('gpuCapacity');
    expect(fields).toHaveProperty('pricing');
  });

  it('has all root Query fields nullable (for partial providers)', () => {
    const schema = buildSchema(DASHBOARD_SCHEMA);
    const queryType = schema.getQueryType()!;
    const fields = queryType.getFields();

    for (const [name, field] of Object.entries(fields)) {
      // GraphQL nullable types are NOT wrapped in NonNull
      const typeName = field.type.toString();
      expect(typeName).not.toMatch(
        /^[A-Z].*!$/,
        `Root field "${name}" should be nullable but is ${typeName}`
      );
    }
  });

  it('includes all expected types', () => {
    const schema = buildSchema(DASHBOARD_SCHEMA);
    const expectedTypes = [
      'KPI',
      'MetricDelta',
      'Protocol',
      'FeesInfo',
      'FeeEntry',
      'PipelineUsage',
      'GPUCapacity',
      'PipelinePricing',
    ];

    for (const typeName of expectedTypes) {
      expect(schema.getType(typeName)).toBeDefined();
    }
  });

  it('KPI type has required MetricDelta fields', () => {
    const schema = buildSchema(DASHBOARD_SCHEMA);
    const kpiType = schema.getType('KPI') as any;
    const fields = kpiType.getFields();

    expect(fields).toHaveProperty('successRate');
    expect(fields).toHaveProperty('orchestratorsOnline');
    expect(fields).toHaveProperty('dailyUsageMins');
    expect(fields).toHaveProperty('dailyStreamCount');
  });
});

// ============================================================================
// Event Name Constants
// ============================================================================

describe('Event name constants', () => {
  it('DASHBOARD_QUERY_EVENT uses dashboard: prefix', () => {
    expect(DASHBOARD_QUERY_EVENT).toBe('dashboard:query');
  });

  it('DASHBOARD_JOB_FEED_EVENT uses dashboard: prefix', () => {
    expect(DASHBOARD_JOB_FEED_EVENT).toBe('dashboard:job-feed:subscribe');
  });

  it('DASHBOARD_JOB_FEED_EMIT_EVENT uses dashboard: prefix', () => {
    expect(DASHBOARD_JOB_FEED_EMIT_EVENT).toBe('dashboard:job-feed:event');
  });
});

// ============================================================================
// getDashboardSchema
// ============================================================================

describe('getDashboardSchema', () => {
  it('returns a valid GraphQL schema', () => {
    const schema = getDashboardSchema();
    expect(schema).toBeDefined();
    expect(schema.getQueryType()).toBeDefined();
  });

  it('returns the same cached instance on subsequent calls', () => {
    const schema1 = getDashboardSchema();
    const schema2 = getDashboardSchema();
    expect(schema1).toBe(schema2);
  });
});

// ============================================================================
// createDashboardProvider
// ============================================================================

describe('createDashboardProvider', () => {
  let mockEventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    mockEventBus = createMockEventBus();
  });

  it('registers a handler on the event bus for DASHBOARD_QUERY_EVENT', () => {
    createDashboardProvider(mockEventBus as any, {});

    expect(mockEventBus.handleRequest).toHaveBeenCalledWith(
      DASHBOARD_QUERY_EVENT,
      expect.any(Function)
    );
    expect(mockEventBus._hasHandler(DASHBOARD_QUERY_EVENT)).toBe(true);
  });

  it('executes a GraphQL query and returns data', async () => {
    const resolvers: DashboardResolvers = {
      kpi: async () => ({
        successRate: { value: 97.3, delta: 1.2 },
        orchestratorsOnline: { value: 142, delta: 8 },
        dailyUsageMins: { value: 48720, delta: 3200 },
        dailyStreamCount: { value: 1843, delta: -47 },
      }),
    };

    createDashboardProvider(mockEventBus as any, resolvers);

    const request: DashboardQueryRequest = {
      query: '{ kpi { successRate { value delta } orchestratorsOnline { value delta } dailyUsageMins { value delta } dailyStreamCount { value delta } } }',
    };

    const response = (await mockEventBus._invoke(
      DASHBOARD_QUERY_EVENT,
      request
    )) as DashboardQueryResponse;

    expect(response.data).toBeDefined();
    expect(response.data!.kpi).toBeDefined();
    expect(response.data!.kpi!.successRate.value).toBe(97.3);
    expect(response.data!.kpi!.successRate.delta).toBe(1.2);
    expect(response.data!.kpi!.orchestratorsOnline.value).toBe(142);
    expect(response.errors).toBeUndefined();
  });

  it('returns null for unimplemented resolvers (not an error)', async () => {
    // Only implement kpi, leave protocol unimplemented
    const resolvers: DashboardResolvers = {
      kpi: async () => ({
        successRate: { value: 97, delta: 1 },
        orchestratorsOnline: { value: 100, delta: 0 },
        dailyUsageMins: { value: 1000, delta: 50 },
        dailyStreamCount: { value: 500, delta: -10 },
      }),
    };

    createDashboardProvider(mockEventBus as any, resolvers);

    const request: DashboardQueryRequest = {
      query: '{ kpi { successRate { value } } protocol { currentRound } }',
    };

    const response = (await mockEventBus._invoke(
      DASHBOARD_QUERY_EVENT,
      request
    )) as DashboardQueryResponse;

    expect(response.data).toBeDefined();
    expect(response.data!.kpi).toBeDefined();
    expect(response.data!.kpi!.successRate.value).toBe(97);
    // Protocol should be null (no resolver)
    expect(response.data!.protocol).toBeNull();
    // No errors for null nullable fields
    expect(response.errors).toBeUndefined();
  });

  it('returns errors when a resolver throws', async () => {
    const resolvers: DashboardResolvers = {
      kpi: async () => {
        throw new Error('Upstream API unavailable');
      },
    };

    createDashboardProvider(mockEventBus as any, resolvers);

    const request: DashboardQueryRequest = {
      query: '{ kpi { successRate { value } } }',
    };

    const response = (await mockEventBus._invoke(
      DASHBOARD_QUERY_EVENT,
      request
    )) as DashboardQueryResponse;

    expect(response.errors).toBeDefined();
    expect(response.errors!.length).toBeGreaterThan(0);
    expect(response.errors![0].message).toContain('Upstream API unavailable');
  });

  it('supports variables in queries', async () => {
    let receivedArgs: { days?: number } | undefined;
    const resolvers: DashboardResolvers = {
      fees: async (args) => {
        receivedArgs = args;
        return { totalEth: 100, entries: [] };
      },
    };

    createDashboardProvider(mockEventBus as any, resolvers);

    const request: DashboardQueryRequest = {
      query: 'query GetFees($d: Int) { fees(days: $d) { totalEth entries { day eth } } }',
      variables: { d: 14 },
    };

    const response = (await mockEventBus._invoke(
      DASHBOARD_QUERY_EVENT,
      request
    )) as DashboardQueryResponse;

    expect(response.data).toBeDefined();
    expect(response.data!.fees).toBeDefined();
    expect(response.data!.fees!.totalEth).toBe(100);
    expect(receivedArgs).toEqual({ days: 14 });
  });

  it('cleanup unregisters the handler', () => {
    const cleanup = createDashboardProvider(mockEventBus as any, {});

    expect(mockEventBus._hasHandler(DASHBOARD_QUERY_EVENT)).toBe(true);

    cleanup();

    expect(mockEventBus._hasHandler(DASHBOARD_QUERY_EVENT)).toBe(false);
  });

  it('handles multiple resolvers in a single query', async () => {
    const resolvers: DashboardResolvers = {
      kpi: async () => ({
        successRate: { value: 99, delta: 0.5 },
        orchestratorsOnline: { value: 150, delta: 10 },
        dailyUsageMins: { value: 50000, delta: 2000 },
        dailyStreamCount: { value: 2000, delta: 100 },
      }),
      protocol: async () => ({
        currentRound: 4127,
        blockProgress: 4152,
        totalBlocks: 5760,
        totalStakedLPT: 31245890,
      }),
      gpuCapacity: async () => ({
        totalGPUs: 384,
        availableCapacity: 61,
      }),
    };

    createDashboardProvider(mockEventBus as any, resolvers);

    const request: DashboardQueryRequest = {
      query: `{
        kpi { successRate { value delta } orchestratorsOnline { value delta } dailyUsageMins { value delta } dailyStreamCount { value delta } }
        protocol { currentRound blockProgress totalBlocks totalStakedLPT }
        gpuCapacity { totalGPUs availableCapacity }
      }`,
    };

    const response = (await mockEventBus._invoke(
      DASHBOARD_QUERY_EVENT,
      request
    )) as DashboardQueryResponse;

    expect(response.data!.kpi!.successRate.value).toBe(99);
    expect(response.data!.protocol!.currentRound).toBe(4127);
    expect(response.data!.gpuCapacity!.totalGPUs).toBe(384);
    expect(response.errors).toBeUndefined();
  });

  it('handles an empty resolver map gracefully', async () => {
    createDashboardProvider(mockEventBus as any, {});

    const request: DashboardQueryRequest = {
      query: '{ kpi { successRate { value } } }',
    };

    const response = (await mockEventBus._invoke(
      DASHBOARD_QUERY_EVENT,
      request
    )) as DashboardQueryResponse;

    expect(response.data!.kpi).toBeNull();
    expect(response.errors).toBeUndefined();
  });
});
