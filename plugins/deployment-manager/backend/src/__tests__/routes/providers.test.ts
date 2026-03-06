import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createProvidersRouter } from '../../routes/providers.js';

function createMockAdapter(overrides = {}) {
  return {
    slug: 'mock-provider',
    displayName: 'Mock Provider',
    description: 'A mock cloud GPU provider',
    icon: '☁️',
    mode: 'managed',
    authMethod: 'api-key',
    apiConfig: { upstreamBaseUrl: 'http://mock', authType: 'bearer' as const, secretNames: ['api-key'], healthCheckPath: null },
    getGpuOptions: vi.fn().mockResolvedValue([
      { model: 'A100', vramGb: 80, pricePerHour: 2.5 },
      { model: 'H100', vramGb: 80, pricePerHour: 4.0 },
    ]),
    ...overrides,
  };
}

function createMockRegistry() {
  const adapters = new Map<string, ReturnType<typeof createMockAdapter>>();
  return {
    listProviders: vi.fn(),
    has: vi.fn((slug: string) => adapters.has(slug)),
    get: vi.fn((slug: string) => adapters.get(slug)),
    _addAdapter(slug: string, adapter: ReturnType<typeof createMockAdapter>) {
      adapters.set(slug, adapter);
      this.has.mockImplementation((s: string) => adapters.has(s));
      this.get.mockImplementation((s: string) => adapters.get(s));
    },
  };
}

function createApp() {
  const mockRegistry = createMockRegistry();
  const app = express();
  app.use(express.json());
  app.use('/', createProvidersRouter(mockRegistry as any));
  return { app, mockRegistry };
}

describe('Providers Router', () => {
  let app: express.Express;
  let mockRegistry: ReturnType<typeof createMockRegistry>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app, mockRegistry } = createApp());
  });

  describe('GET /', () => {
    it('returns provider list', async () => {
      const providers = [
        { slug: 'provider-a', displayName: 'Provider A' },
        { slug: 'provider-b', displayName: 'Provider B' },
      ];
      mockRegistry.listProviders.mockReturnValue(providers);

      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(providers);
    });
  });

  describe('GET /:slug', () => {
    it('returns 404 for unknown provider', async () => {
      const res = await request(app).get('/unknown');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Provider not found: unknown');
    });

    it('returns provider details', async () => {
      const adapter = createMockAdapter();
      mockRegistry._addAdapter('mock-provider', adapter);

      const res = await request(app).get('/mock-provider');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        slug: 'mock-provider',
        displayName: 'Mock Provider',
        description: 'A mock cloud GPU provider',
        icon: '☁️',
        mode: 'managed',
        authMethod: 'api-key',
        secretNames: ['api-key'],
      });
    });
  });

  describe('GET /:slug/gpu-options', () => {
    it('returns GPU options', async () => {
      const adapter = createMockAdapter();
      mockRegistry._addAdapter('mock-provider', adapter);

      const res = await request(app).get('/mock-provider/gpu-options');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([
        { model: 'A100', vramGb: 80, pricePerHour: 2.5 },
        { model: 'H100', vramGb: 80, pricePerHour: 4.0 },
      ]);
      expect(adapter.getGpuOptions).toHaveBeenCalled();
    });

    it('returns 404 for unknown provider', async () => {
      const res = await request(app).get('/unknown/gpu-options');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Provider not found: unknown');
    });
  });
});
