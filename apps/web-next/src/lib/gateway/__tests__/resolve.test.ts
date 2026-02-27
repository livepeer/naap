/**
 * Tests for Service Gateway — Config Resolver
 *
 * Verifies cache TTL behavior, scope-aware lookups (team + personal),
 * endpoint matching, path pattern resolution, and cache isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnector: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/db';
import { resolveConfig, invalidateConnectorCache } from '../resolve';

const mockFindUnique = prisma.serviceConnector.findUnique as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.serviceConnector.findFirst as ReturnType<typeof vi.fn>;

function makeConnector(overrides?: Record<string, unknown>) {
  return {
    id: 'conn-1',
    teamId: 'team-1',
    ownerUserId: null,
    slug: 'my-api',
    displayName: 'My API',
    status: 'published',
    visibility: 'private',
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

function makePersonalConnector(userId: string, overrides?: Record<string, unknown>) {
  return makeConnector({
    teamId: null,
    ownerUserId: userId,
    ...overrides,
  });
}

describe('resolveConfig', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    invalidateConnectorCache('team-1', 'my-api');
    invalidateConnectorCache('personal:user-1', 'my-api');
    invalidateConnectorCache('personal:user-2', 'my-api');
    invalidateConnectorCache('personal:user-99', 'my-api');
    invalidateConnectorCache('public', 'my-api');
    mockFindFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Team-scoped lookups ──

  it('resolves a published team connector with matching endpoint', async () => {
    mockFindUnique.mockResolvedValue(makeConnector());

    const config = await resolveConfig('team-1', 'my-api', 'POST', '/query');

    expect(config).not.toBeNull();
    expect(config!.connector.slug).toBe('my-api');
    expect(config!.connector.teamId).toBe('team-1');
    expect(config!.connector.ownerUserId).toBeNull();
    expect(config!.endpoint.name).toBe('Query');
    expect(config!.endpoint.upstreamPath).toBe('/v1/query');

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { teamId_slug: { teamId: 'team-1', slug: 'my-api' } },
      include: { endpoints: true },
    });
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

  // ── Personal-scoped lookups ──

  it('resolves a published personal connector via ownerUserId_slug', async () => {
    mockFindUnique.mockResolvedValue(makePersonalConnector('user-1'));

    const config = await resolveConfig('personal:user-1', 'my-api', 'POST', '/query');

    expect(config).not.toBeNull();
    expect(config!.connector.teamId).toBeNull();
    expect(config!.connector.ownerUserId).toBe('user-1');
    expect(config!.connector.slug).toBe('my-api');

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { ownerUserId_slug: { ownerUserId: 'user-1', slug: 'my-api' } },
      include: { endpoints: true },
    });
  });

  it('returns null for non-existent personal connector', async () => {
    mockFindUnique.mockResolvedValue(null);

    const config = await resolveConfig('personal:user-1', 'my-api', 'GET', '/');
    expect(config).toBeNull();
  });

  // ── Cache behavior ──

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

  it('isolates cache between team and personal scope', async () => {
    mockFindUnique.mockResolvedValueOnce(makeConnector());
    mockFindUnique.mockResolvedValueOnce(makePersonalConnector('user-1'));

    const teamConfig = await resolveConfig('team-1', 'my-api', 'POST', '/query');
    const personalConfig = await resolveConfig('personal:user-1', 'my-api', 'POST', '/query');

    expect(mockFindUnique).toHaveBeenCalledTimes(2);
    expect(teamConfig!.connector.teamId).toBe('team-1');
    expect(personalConfig!.connector.ownerUserId).toBe('user-1');
  });

  it('negative cache (not-found) expires quickly and allows re-resolution', async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    const config1 = await resolveConfig('personal:user-1', 'my-api', 'POST', '/query');
    expect(config1).toBeNull();
    expect(mockFindUnique).toHaveBeenCalledTimes(1);

    // Advance time past the short negative cache TTL (5s)
    vi.advanceTimersByTime(6_000);

    mockFindUnique.mockResolvedValueOnce(makePersonalConnector('user-1'));

    const config2 = await resolveConfig('personal:user-1', 'my-api', 'POST', '/query');
    expect(config2).not.toBeNull();
    expect(config2!.connector.ownerUserId).toBe('user-1');
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });

  it('isolates cache between different personal scopes', async () => {
    mockFindUnique.mockResolvedValueOnce(makePersonalConnector('user-1'));
    mockFindUnique.mockResolvedValueOnce(null);

    const user1Config = await resolveConfig('personal:user-1', 'my-api', 'POST', '/query');
    const user2Config = await resolveConfig('personal:user-2', 'my-api', 'POST', '/query');

    expect(mockFindUnique).toHaveBeenCalledTimes(2);
    expect(user1Config).not.toBeNull();
    expect(user2Config).toBeNull();
  });

  // ── Public connector fallback ──

  it('resolves public connector via fallback when scope lookup fails', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue(
      makeConnector({
        id: 'pub-conn-1',
        teamId: null,
        ownerUserId: 'admin-1',
        visibility: 'public',
      }),
    );

    const config = await resolveConfig('personal:user-99', 'my-api', 'POST', '/query');

    expect(config).not.toBeNull();
    expect(config!.connector.id).toBe('pub-conn-1');
    expect(config!.connector.visibility).toBe('public');
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { slug: 'my-api', visibility: 'public', status: 'published' },
      include: { endpoints: true },
    });
  });

  it('does not use public fallback if scope lookup succeeds', async () => {
    mockFindUnique.mockResolvedValue(makePersonalConnector('user-1'));

    const config = await resolveConfig('personal:user-1', 'my-api', 'POST', '/query');

    expect(config).not.toBeNull();
    expect(config!.connector.ownerUserId).toBe('user-1');
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('returns null when neither scope nor public lookup finds connector', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue(null);

    const config = await resolveConfig('personal:user-99', 'my-api', 'POST', '/query');
    expect(config).toBeNull();
  });

  it('includes visibility field in resolved connector', async () => {
    mockFindUnique.mockResolvedValue(makeConnector({ visibility: 'team' }));

    const config = await resolveConfig('team-1', 'my-api', 'POST', '/query');
    expect(config!.connector.visibility).toBe('team');
  });

  // ── Path matching ──

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
