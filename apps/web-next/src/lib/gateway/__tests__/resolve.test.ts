/**
 * Tests for Service Gateway — Config Resolver
 *
 * Verifies cache TTL behavior, team-scoped lookups,
 * endpoint matching, and path pattern resolution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnector: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/db';
import { resolveConfig, invalidateConnectorCache } from '../resolve';

const mockFindUnique = prisma.serviceConnector.findUnique as ReturnType<typeof vi.fn>;

function makeConnector(overrides?: Record<string, unknown>) {
  return {
    id: 'conn-1',
    teamId: 'team-1',
    slug: 'my-api',
    displayName: 'My API',
    status: 'published',
    upstreamBaseUrl: 'https://api.example.com',
    allowedHosts: ['api.example.com'],
    defaultTimeout: 30000,
    healthCheckPath: '/health',
    authType: 'bearer',
    authConfig: { tokenRef: 'api-key' },
    secretRefs: ['api-key'],
    responseWrapper: false,
    streamingEnabled: false,
    errorMapping: {},
    endpoints: [
      {
        id: 'ep-1',
        connectorId: 'conn-1',
        name: 'Query',
        method: 'POST',
        path: '/query',
        enabled: true,
        upstreamMethod: null,
        upstreamPath: '/v1/query',
        upstreamContentType: 'application/json',
        upstreamQueryParams: {},
        upstreamStaticBody: null,
        bodyTransform: 'passthrough',
        headerMapping: {},
        rateLimit: 100,
        timeout: null,
        maxRequestSize: null,
        maxResponseSize: null,
        cacheTtl: null,
        retries: 1,
        bodyPattern: null,
        bodyBlacklist: [],
        bodySchema: null,
        requiredHeaders: [],
      },
    ],
    ...overrides,
  };
}

describe('resolveConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateConnectorCache('team-1', 'my-api');
  });

  it('resolves a published connector with matching endpoint', async () => {
    mockFindUnique.mockResolvedValue(makeConnector());

    const config = await resolveConfig('team-1', 'my-api', 'POST', '/query');

    expect(config).not.toBeNull();
    expect(config!.connector.slug).toBe('my-api');
    expect(config!.connector.teamId).toBe('team-1');
    expect(config!.endpoint.name).toBe('Query');
    expect(config!.endpoint.upstreamPath).toBe('/v1/query');
  });

  it('returns null for non-existent connector', async () => {
    mockFindUnique.mockResolvedValue(null);

    const config = await resolveConfig('team-1', 'missing', 'GET', '/');

    expect(config).toBeNull();
  });

  it('returns null for non-published connector', async () => {
    mockFindUnique.mockResolvedValue(makeConnector({ status: 'draft' }));

    const config = await resolveConfig('team-1', 'my-api', 'POST', '/query');

    expect(config).toBeNull();
  });

  it('returns null for non-matching endpoint method', async () => {
    mockFindUnique.mockResolvedValue(makeConnector());

    const config = await resolveConfig('team-1', 'my-api', 'GET', '/query');

    expect(config).toBeNull();
  });

  it('returns null for non-matching endpoint path', async () => {
    mockFindUnique.mockResolvedValue(makeConnector());

    const config = await resolveConfig('team-1', 'my-api', 'POST', '/missing');

    expect(config).toBeNull();
  });

  it('uses cache on subsequent calls within TTL', async () => {
    mockFindUnique.mockResolvedValue(makeConnector());

    await resolveConfig('team-1', 'my-api', 'POST', '/query');
    await resolveConfig('team-1', 'my-api', 'POST', '/query');

    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  it('refetches after cache invalidation', async () => {
    mockFindUnique.mockResolvedValue(makeConnector());

    await resolveConfig('team-1', 'my-api', 'POST', '/query');
    invalidateConnectorCache('team-1', 'my-api');
    await resolveConfig('team-1', 'my-api', 'POST', '/query');

    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });

  it('matches endpoints with path params', async () => {
    const connector = makeConnector({
      endpoints: [
        {
          id: 'ep-param',
          connectorId: 'conn-1',
          name: 'GetTable',
          method: 'GET',
          path: '/tables/:name',
          enabled: true,
          upstreamMethod: null,
          upstreamPath: '/v1/tables/:name',
          upstreamContentType: 'application/json',
          upstreamQueryParams: {},
          upstreamStaticBody: null,
          bodyTransform: 'passthrough',
          headerMapping: {},
          rateLimit: null,
          timeout: null,
          maxRequestSize: null,
          maxResponseSize: null,
          cacheTtl: null,
          retries: 0,
          bodyPattern: null,
          bodyBlacklist: [],
          bodySchema: null,
          requiredHeaders: [],
        },
      ],
    });
    mockFindUnique.mockResolvedValue(connector);

    const config = await resolveConfig('team-1', 'my-api', 'GET', '/tables/users');

    expect(config).not.toBeNull();
    expect(config!.endpoint.name).toBe('GetTable');
  });

  it('skips disabled endpoints', async () => {
    const connector = makeConnector({
      endpoints: [
        {
          id: 'ep-disabled',
          connectorId: 'conn-1',
          name: 'DisabledEndpoint',
          method: 'POST',
          path: '/query',
          enabled: false,
          upstreamMethod: null,
          upstreamPath: '/v1/query',
          upstreamContentType: 'application/json',
          upstreamQueryParams: {},
          upstreamStaticBody: null,
          bodyTransform: 'passthrough',
          headerMapping: {},
          rateLimit: null,
          timeout: null,
          maxRequestSize: null,
          maxResponseSize: null,
          cacheTtl: null,
          retries: 0,
          bodyPattern: null,
          bodyBlacklist: [],
          bodySchema: null,
          requiredHeaders: [],
        },
      ],
    });
    mockFindUnique.mockResolvedValue(connector);

    const config = await resolveConfig('team-1', 'my-api', 'POST', '/query');

    expect(config).toBeNull();
  });
});
