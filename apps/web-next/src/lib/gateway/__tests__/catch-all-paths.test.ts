/**
 * Tests for catch-all path matching and upstream URL construction.
 *
 * Verifies:
 * - :param* matches multiple trailing path segments
 * - Specificity sorting: exact > param > catch-all
 * - buildUpstreamUrl joins catch-all segments correctly
 * - No regression on standard :param matching
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { buildUpstreamRequest } from '../transform';
import type { ResolvedConfig } from '../types';

const mockFindUnique = prisma.serviceConnector.findUnique as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.serviceConnector.findFirst as ReturnType<typeof vi.fn>;

function makeEndpoint(overrides: Record<string, unknown>) {
  return {
    id: 'ep-default',
    connectorId: 'conn-s3',
    name: 'Default',
    method: 'GET',
    path: '/',
    enabled: true,
    upstreamMethod: null,
    upstreamPath: '/',
    upstreamContentType: '',
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
    ...overrides,
  };
}

function makeS3Connector(endpoints: Record<string, unknown>[]) {
  return {
    id: 'conn-s3',
    teamId: 'team-1',
    ownerUserId: null,
    slug: 'storj-s3',
    displayName: 'Storj S3',
    status: 'published',
    visibility: 'public',
    upstreamBaseUrl: 'https://gateway.storjshare.io',
    allowedHosts: ['gateway.storjshare.io'],
    defaultTimeout: 30000,
    healthCheckPath: null,
    authType: 'aws-s3',
    authConfig: {},
    secretRefs: ['access_key', 'secret_key'],
    responseWrapper: false,
    streamingEnabled: false,
    errorMapping: {},
    endpoints,
  };
}

describe('Catch-all path matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateConnectorCache('team-1', 'storj-s3');
    invalidateConnectorCache('public', 'storj-s3');
    mockFindFirst.mockResolvedValue(null);
  });

  it('matches :bucket/:key* with multi-segment paths', async () => {
    const connector = makeS3Connector([
      makeEndpoint({
        id: 'ep-get-obj',
        name: 'GetObject',
        method: 'GET',
        path: '/:bucket/:key*',
        upstreamPath: '/:bucket/:key*',
      }),
    ]);
    mockFindUnique.mockResolvedValue(connector);

    const config = await resolveConfig('team-1', 'storj-s3', 'GET', '/my-bucket/docs/readme.md');
    expect(config).not.toBeNull();
    expect(config!.endpoint.name).toBe('GetObject');
  });

  it('matches catch-all with deeply nested paths', async () => {
    const connector = makeS3Connector([
      makeEndpoint({
        id: 'ep-get-obj',
        name: 'GetObject',
        method: 'GET',
        path: '/:bucket/:key*',
        upstreamPath: '/:bucket/:key*',
      }),
    ]);
    mockFindUnique.mockResolvedValue(connector);

    const config = await resolveConfig('team-1', 'storj-s3', 'GET', '/my-bucket/a/b/c/d/e.txt');
    expect(config).not.toBeNull();
    expect(config!.endpoint.name).toBe('GetObject');
  });

  it('catch-all still matches single trailing segment', async () => {
    const connector = makeS3Connector([
      makeEndpoint({
        id: 'ep-get-obj',
        name: 'GetObject',
        method: 'GET',
        path: '/:bucket/:key*',
        upstreamPath: '/:bucket/:key*',
      }),
    ]);
    mockFindUnique.mockResolvedValue(connector);

    const config = await resolveConfig('team-1', 'storj-s3', 'GET', '/my-bucket/file.txt');
    expect(config).not.toBeNull();
    expect(config!.endpoint.name).toBe('GetObject');
  });

  it('catch-all does not match if fewer segments than required', async () => {
    const connector = makeS3Connector([
      makeEndpoint({
        id: 'ep-get-obj',
        name: 'GetObject',
        method: 'GET',
        path: '/:bucket/:key*',
        upstreamPath: '/:bucket/:key*',
      }),
    ]);
    mockFindUnique.mockResolvedValue(connector);

    const config = await resolveConfig('team-1', 'storj-s3', 'GET', '/my-bucket');
    expect(config).toBeNull();
  });

  it('prefers specific endpoint over catch-all via specificity sorting', async () => {
    const connector = makeS3Connector([
      makeEndpoint({
        id: 'ep-catch-all',
        name: 'GetObject',
        method: 'GET',
        path: '/:bucket/:key*',
        upstreamPath: '/:bucket/:key*',
      }),
      makeEndpoint({
        id: 'ep-list-bucket',
        name: 'ListObjects',
        method: 'GET',
        path: '/:bucket',
        upstreamPath: '/:bucket',
      }),
    ]);
    mockFindUnique.mockResolvedValue(connector);

    const config = await resolveConfig('team-1', 'storj-s3', 'GET', '/my-bucket');
    expect(config).not.toBeNull();
    expect(config!.endpoint.name).toBe('ListObjects');
  });

  it('does not regress standard param matching', async () => {
    const connector = makeS3Connector([
      makeEndpoint({
        id: 'ep-head-bucket',
        name: 'HeadBucket',
        method: 'HEAD',
        path: '/:bucket',
        upstreamPath: '/:bucket',
      }),
    ]);
    mockFindUnique.mockResolvedValue(connector);

    const config = await resolveConfig('team-1', 'storj-s3', 'HEAD', '/test-bucket');
    expect(config).not.toBeNull();
    expect(config!.endpoint.name).toBe('HeadBucket');
  });
});

describe('Catch-all upstream URL construction', () => {
  function makeResolvedConfig(
    endpointPath: string,
    upstreamPath: string,
  ): ResolvedConfig {
    return {
      connector: {
        id: 'conn-s3',
        teamId: 'team-1',
        ownerUserId: null,
        slug: 'storj-s3',
        displayName: 'Storj S3',
        status: 'published',
        visibility: 'public',
        upstreamBaseUrl: 'https://gateway.storjshare.io',
        allowedHosts: ['gateway.storjshare.io'],
        defaultTimeout: 30000,
        healthCheckPath: null,
        authType: 'none',
        authConfig: {},
        secretRefs: [],
        responseWrapper: false,
        streamingEnabled: false,
        errorMapping: {},
      },
      endpoint: {
        id: 'ep-1',
        connectorId: 'conn-s3',
        name: 'Test',
        method: 'GET',
        path: endpointPath,
        enabled: true,
        upstreamMethod: null,
        upstreamPath,
        upstreamContentType: '',
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
    };
  }

  it('joins catch-all segments into upstream URL', () => {
    const config = makeResolvedConfig('/:bucket/:key*', '/:bucket/:key*');
    const request = new Request('https://gateway.example.com/api/v1/gw/storj-s3/my-bucket/path/to/file.txt');
    const result = buildUpstreamRequest(request, config, {}, null, '/my-bucket/path/to/file.txt');

    expect(result.url).toBe('https://gateway.storjshare.io/my-bucket/path/to/file.txt');
  });

  it('handles single segment after catch-all prefix', () => {
    const config = makeResolvedConfig('/:bucket/:key*', '/:bucket/:key*');
    const request = new Request('https://gateway.example.com/api/v1/gw/storj-s3/my-bucket/file.txt');
    const result = buildUpstreamRequest(request, config, {}, null, '/my-bucket/file.txt');

    expect(result.url).toBe('https://gateway.storjshare.io/my-bucket/file.txt');
  });

  it('does not affect non-catch-all param replacement', () => {
    const config = makeResolvedConfig('/:bucket', '/:bucket');
    const request = new Request('https://gateway.example.com/api/v1/gw/storj-s3/my-bucket');
    const result = buildUpstreamRequest(request, config, {}, null, '/my-bucket');

    expect(result.url).toBe('https://gateway.storjshare.io/my-bucket');
  });

  it('preserves query parameters with catch-all paths', () => {
    const config = makeResolvedConfig('/:bucket/:key*', '/:bucket/:key*');
    const request = new Request('https://gateway.example.com/api/v1/gw/storj-s3/my-bucket/file.txt?versionId=abc');
    const result = buildUpstreamRequest(request, config, {}, null, '/my-bucket/file.txt');

    const url = new URL(result.url);
    expect(url.pathname).toBe('/my-bucket/file.txt');
    expect(url.searchParams.get('versionId')).toBe('abc');
  });
});
