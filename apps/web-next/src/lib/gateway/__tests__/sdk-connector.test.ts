/**
 * Tests for the public `sdk` Service Gateway connector (NAAP-5).
 *
 *   - The connector definition (sdk.json) exists and is shaped for a public,
 *     env-sourced upstream reachable at /api/v1/gw/sdk/*.
 *   - The build-time seed registers `sdk` gated behind the `sdk_connector` flag,
 *     with SDK_SERVICE_BASE_URL / the sdk.daydream.monster default.
 *   - resolveConfig resolves the published public `sdk` connector for any caller
 *     scope via the public fallback (the basis for global/shared reachability).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnector: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';
import { resolveConfig, invalidateConnectorCache } from '../resolve';

const mockFindUnique = prisma.serviceConnector.findUnique as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.serviceConnector.findFirst as ReturnType<typeof vi.fn>;

/** Ascend from the test file until a relative path resolves (cwd-independent). */
function findRepoFile(relative: string): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, relative);
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error(`could not locate ${relative} from test directory`);
}

describe('sdk connector definition (sdk.json)', () => {
  const sdkPath = findRepoFile('plugins/service-gateway/connectors/sdk.json');
  const def = JSON.parse(fs.readFileSync(sdkPath, 'utf-8'));

  it('declares the sdk slug reachable at /api/v1/gw/sdk/*', () => {
    expect(def.connector.slug).toBe('sdk');
  });

  it('defaults the upstream to the staging SDK service host', () => {
    expect(def.connector.upstreamBaseUrl).toBe('https://sdk.daydream.monster');
    expect(def.connector.allowedHosts).toContain('sdk.daydream.monster');
  });

  it('uses no upstream auth/secrets (the SDK service authenticates the naap_ key itself)', () => {
    expect(def.connector.authType).toBe('none');
    expect(def.connector.secretRefs).toEqual([]);
  });

  it('exposes the descriptor endpoints (/inference, /capabilities, /llm/chat)', () => {
    const paths = def.endpoints.map((e: { path: string }) => e.path).sort();
    expect(paths).toEqual(['/capabilities', '/inference', '/llm/chat']);
  });
});

describe('sdk connector seed registration', () => {
  const seedPath = findRepoFile('bin/seed-gateway-connector.ts');
  const src = fs.readFileSync(seedPath, 'utf-8');

  it('registers the sdk seed gated behind the sdk_connector flag', () => {
    expect(src).toContain("slug: 'sdk'");
    expect(src).toContain("flag: 'sdk_connector'");
  });

  it('sources the base URL from SDK_SERVICE_BASE_URL with the staging default', () => {
    expect(src).toContain("baseUrlEnv: 'SDK_SERVICE_BASE_URL'");
    expect(src).toContain("defaultBaseUrl: 'https://sdk.daydream.monster'");
  });
});

describe('sdk connector public resolution', () => {
  function makeSdkConnector(overrides?: Record<string, unknown>) {
    return {
      id: 'sdk-conn-1',
      teamId: null,
      ownerUserId: 'admin-1',
      slug: 'sdk',
      displayName: 'SDK Service',
      status: 'published',
      visibility: 'public',
      upstreamBaseUrl: 'https://sdk.daydream.monster',
      allowedHosts: ['sdk.daydream.monster'],
      defaultTimeout: 30000,
      healthCheckPath: '/health',
      authType: 'none',
      authConfig: {},
      secretRefs: [],
      responseWrapper: false,
      streamingEnabled: true,
      errorMapping: {},
      endpoints: [
        {
          id: 'ep-inference',
          connectorId: 'sdk-conn-1',
          name: 'inference',
          method: 'POST',
          path: '/inference',
          enabled: true,
          upstreamMethod: null,
          upstreamPath: '/inference',
          upstreamContentType: 'application/json',
          upstreamQueryParams: {},
          upstreamStaticBody: null,
          bodyTransform: 'passthrough',
          headerMapping: {},
          rateLimit: null,
          timeout: 30000,
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
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    invalidateConnectorCache('personal:app-user', 'sdk');
    invalidateConnectorCache('team-app', 'sdk');
    invalidateConnectorCache('public', 'sdk');
    mockFindFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves the public sdk connector for any caller scope via fallback', async () => {
    mockFindUnique.mockResolvedValue(null); // caller has no own `sdk` connector
    mockFindFirst.mockResolvedValue(makeSdkConnector());

    const config = await resolveConfig('personal:app-user', 'sdk', 'POST', '/inference');

    expect(config).not.toBeNull();
    expect(config!.connector.slug).toBe('sdk');
    expect(config!.connector.visibility).toBe('public');
    expect(config!.connector.upstreamBaseUrl).toBe('https://sdk.daydream.monster');
    expect(config!.endpoint.upstreamPath).toBe('/inference');
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { slug: 'sdk', visibility: 'public', status: 'published' },
      include: { endpoints: true },
    });
  });

  it('returns null when the sdk connector is not seeded (flag OFF → no row)', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue(null);

    const config = await resolveConfig('team-app', 'sdk', 'POST', '/inference');
    expect(config).toBeNull();
  });
});
