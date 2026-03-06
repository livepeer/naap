import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FalAdapter } from '../adapters/FalAdapter.js';
import type { DeployConfig, UpdateConfig } from '../types/index.js';

vi.mock('../lib/providerFetch.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    authenticatedProviderFetch: (_slug: string, apiConfig: any, path: string, options?: RequestInit) => {
      return actual.providerFetch(apiConfig.upstreamBaseUrl, path, options);
    },
  };
});

const UPSTREAM_BASE = 'https://rest.fal.ai';

describe('FalAdapter', () => {
  let adapter: FalAdapter;
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockClear();
    adapter = new FalAdapter();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(adapter.slug).toBe('fal-ai');
    expect(adapter.mode).toBe('serverless');
  });

  describe('getGpuOptions', () => {
    it('returns a static list of GPU options', async () => {
      const options = await adapter.getGpuOptions();
      expect(options.length).toBeGreaterThan(0);
      expect(options[0]).toMatchObject({ id: 'A100', vramGb: 80, available: true });
      expect(options.every((o) => o.available)).toBe(true);
    });
  });

  describe('deploy', () => {
    const config: DeployConfig = {
      name: 'test-model',
      providerSlug: 'fal-ai',
      gpuModel: 'A100',
      gpuVramGb: 80,
      gpuCount: 1,
      artifactType: 'ai-runner',
      artifactVersion: 'v1.0',
      dockerImage: 'my-org/my-image:latest',
    };

    it('returns providerDeploymentId on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'app-123', url: 'https://fal.run/app-123' }),
        text: async () => '',
      } as any);

      const result = await adapter.deploy(config);
      expect(result.providerDeploymentId).toBe('app-123');
      expect(result.endpointUrl).toBe('https://fal.run/app-123');
      expect(result.status).toBe('DEPLOYING');

      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/applications`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'test-model',
            image: 'my-org/my-image:latest',
            machine_type: 'A100',
            env: {},
            min_concurrency: 0,
            max_concurrency: 5,
          }),
        }),
      );
    });

    it('falls back to application_id when id is absent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ application_id: 'app-alt-456' }),
        text: async () => '',
      } as any);

      const result = await adapter.deploy(config);
      expect(result.providerDeploymentId).toBe('app-alt-456');
      expect(result.endpointUrl).toBe('https://fal.run/undefined');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'Internal Server Error',
      } as any);

      await expect(adapter.deploy(config)).rejects.toThrow('fal.ai deploy failed (500): Internal Server Error');
    });
  });

  describe('getStatus', () => {
    it('maps ACTIVE to ONLINE', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ACTIVE', url: 'https://fal.run/app-123' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('app-123');
      expect(result.status).toBe('ONLINE');
      expect(result.endpointUrl).toBe('https://fal.run/app-123');
    });

    it('maps FAILED to FAILED', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'FAILED' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('app-123');
      expect(result.status).toBe('FAILED');
    });

    it('maps STOPPED to FAILED', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'STOPPED' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('app-123');
      expect(result.status).toBe('FAILED');
    });

    it('maps DEPLOYING to DEPLOYING', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'DEPLOYING' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('app-123');
      expect(result.status).toBe('DEPLOYING');
    });

    it('defaults unknown status to DEPLOYING', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'SOMETHING_NEW' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('app-123');
      expect(result.status).toBe('DEPLOYING');
    });

    it('returns FAILED when fetch response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => 'Not Found',
      } as any);

      const result = await adapter.getStatus('app-123');
      expect(result.status).toBe('FAILED');
    });
  });

  describe('destroy', () => {
    it('calls DELETE on the application endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
      } as any);

      await adapter.destroy('app-123');
      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/applications/app-123`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('does not throw on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => 'Not Found',
      } as any);

      await expect(adapter.destroy('app-123')).resolves.toBeUndefined();
    });

    it('throws on non-404 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'Server Error',
      } as any);

      await expect(adapter.destroy('app-123')).rejects.toThrow('fal.ai destroy failed (500)');
    });
  });

  describe('update', () => {
    it('sends PUT with updated image', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ url: 'https://fal.run/app-123' }),
        text: async () => '',
      } as any);

      const updateConfig: UpdateConfig = { dockerImage: 'my-org/new-image:v2' };
      const result = await adapter.update('app-123', updateConfig);

      expect(result.providerDeploymentId).toBe('app-123');
      expect(result.status).toBe('UPDATING');
      expect(result.endpointUrl).toBe('https://fal.run/app-123');

      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/applications/app-123`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ image: 'my-org/new-image:v2' }),
        }),
      );
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => 'Bad Request',
      } as any);

      await expect(adapter.update('app-123', {})).rejects.toThrow('fal.ai update failed (400)');
    });
  });

  describe('healthCheck', () => {
    it('returns GREEN when status is ACTIVE and response is fast', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ACTIVE' }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('app-123');
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('GREEN');
      expect(result.statusCode).toBe(200);
    });

    it('returns RED when status is not ACTIVE', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'STOPPED' }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('app-123');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
    });

    it('returns RED when fetch response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('app-123');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
      expect(result.statusCode).toBe(503);
    });

    it('returns RED when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await adapter.healthCheck('app-123');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
    });
  });
});
