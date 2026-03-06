import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReplicateAdapter } from '../adapters/ReplicateAdapter.js';
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

const UPSTREAM_BASE = 'https://api.replicate.com/v1';

describe('ReplicateAdapter', () => {
  let adapter: ReplicateAdapter;
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockClear();
    adapter = new ReplicateAdapter();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(adapter.slug).toBe('replicate');
    expect(adapter.mode).toBe('serverless');
  });

  describe('getGpuOptions', () => {
    it('returns a static list of GPU options with prices', async () => {
      const options = await adapter.getGpuOptions();
      expect(options.length).toBeGreaterThan(0);
      expect(options[0]).toMatchObject({ id: 'gpu-a100-large', vramGb: 80, available: true });
      expect(options[0].pricePerHour).toBeDefined();
      expect(options.every((o) => o.available)).toBe(true);
    });
  });

  describe('deploy', () => {
    const config: DeployConfig = {
      name: 'test-model',
      providerSlug: 'replicate',
      gpuModel: 'gpu-a100-large',
      gpuVramGb: 80,
      gpuCount: 1,
      artifactType: 'ai-runner',
      artifactVersion: 'v1.0',
      dockerImage: 'my-org/my-model:latest',
    };

    it('returns providerDeploymentId as owner/name on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          owner: 'naap',
          name: 'test-model',
          current_release: { url: 'https://api.replicate.com/v1/predictions' },
        }),
        text: async () => '',
      } as any);

      const result = await adapter.deploy(config);
      expect(result.providerDeploymentId).toBe('naap/test-model');
      expect(result.endpointUrl).toBe('https://api.replicate.com/v1/predictions');
      expect(result.status).toBe('DEPLOYING');

      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/deployments`,
        expect.objectContaining({ method: 'POST' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.owner).toBe('naap');
      expect(body.name).toBe('test-model');
      expect(body.model).toBe('my-org/my-model:latest');
      expect(body.hardware).toBe('gpu-a100-large');
      expect(body.min_instances).toBe(0);
      expect(body.max_instances).toBe(3);
    });

    it('sanitizes name by replacing invalid chars with hyphens', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ owner: 'naap', name: 'my-model-v1-0' }),
        text: async () => '',
      } as any);

      const specialConfig = { ...config, name: 'My Model v1.0' };
      const result = await adapter.deploy(specialConfig);
      expect(result.providerDeploymentId).toBe('naap/-y--odel-v1-0');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.name).toBe('-y--odel-v1-0');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({}),
        text: async () => 'Validation failed',
      } as any);

      await expect(adapter.deploy(config)).rejects.toThrow('Replicate deploy failed (422): Validation failed');
    });
  });

  describe('getStatus', () => {
    it('returns ONLINE when current_release exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          current_release: { url: 'https://api.replicate.com/...' },
        }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('naap/test-model');
      expect(result.status).toBe('ONLINE');
      expect(result.endpointUrl).toBe('https://api.replicate.com/...');

      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/deployments/naap/test-model`,
        expect.any(Object),
      );
    });

    it('returns DEPLOYING when no current_release', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('naap/test-model');
      expect(result.status).toBe('DEPLOYING');
    });

    it('returns FAILED when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('naap/test-model');
      expect(result.status).toBe('FAILED');
    });
  });

  describe('destroy', () => {
    it('calls DELETE with owner/name path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
      } as any);

      await adapter.destroy('naap/test-model');
      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/deployments/naap/test-model`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('does not throw on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
      } as any);

      await expect(adapter.destroy('naap/test-model')).resolves.toBeUndefined();
    });

    it('throws on non-404 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => '',
      } as any);

      await expect(adapter.destroy('naap/test-model')).rejects.toThrow('Replicate destroy failed (500)');
    });
  });

  describe('update', () => {
    it('sends PATCH with updated fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ current_release: { url: 'https://api.replicate.com/updated' } }),
        text: async () => '',
      } as any);

      const updateConfig: UpdateConfig = {
        dockerImage: 'my-org/new-model:v2',
        gpuModel: 'gpu-a100-small',
      };
      const result = await adapter.update('naap/test-model', updateConfig);

      expect(result.providerDeploymentId).toBe('naap/test-model');
      expect(result.status).toBe('UPDATING');
      expect(result.endpointUrl).toBe('https://api.replicate.com/updated');

      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/deployments/naap/test-model`,
        expect.objectContaining({ method: 'PATCH' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('my-org/new-model:v2');
      expect(body.hardware).toBe('gpu-a100-small');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => '',
      } as any);

      await expect(adapter.update('naap/test-model', {})).rejects.toThrow('Replicate update failed (400)');
    });
  });

  describe('healthCheck', () => {
    it('returns GREEN when current_release exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ current_release: { version: 'abc123' } }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('naap/test-model');
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('GREEN');
      expect(result.statusCode).toBe(200);
    });

    it('returns RED when no current_release', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('naap/test-model');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
    });

    it('returns RED when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('naap/test-model');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
      expect(result.statusCode).toBe(500);
    });

    it('returns RED when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await adapter.healthCheck('naap/test-model');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
    });

    it('calls correct endpoint with owner/name path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ current_release: {} }),
        text: async () => '',
      } as any);

      await adapter.healthCheck('naap/test-model');
      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/deployments/naap/test-model`,
        expect.any(Object),
      );
    });
  });
});
