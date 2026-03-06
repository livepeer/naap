import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BasetenAdapter } from '../adapters/BasetenAdapter.js';
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

const UPSTREAM_BASE = 'https://api.baseten.co/v1';

describe('BasetenAdapter', () => {
  let adapter: BasetenAdapter;
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockClear();
    adapter = new BasetenAdapter();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(adapter.slug).toBe('baseten');
    expect(adapter.mode).toBe('serverless');
  });

  describe('getGpuOptions', () => {
    it('returns a static list of GPU options with prices', async () => {
      const options = await adapter.getGpuOptions();
      expect(options.length).toBeGreaterThan(0);
      expect(options[0]).toMatchObject({ id: 'A100', name: 'NVIDIA A100 40GB', vramGb: 40, available: true });
      expect(options[0].pricePerHour).toBeDefined();
      expect(options.every((o) => o.available)).toBe(true);
    });
  });

  describe('deploy', () => {
    const config: DeployConfig = {
      name: 'test-model',
      providerSlug: 'baseten',
      gpuModel: 'A100',
      gpuVramGb: 40,
      gpuCount: 1,
      artifactType: 'ai-runner',
      artifactVersion: 'v1.0',
      dockerImage: 'my-org/my-image:latest',
    };

    it('returns providerDeploymentId on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model_id: 'mdl-abc123',
          url: 'https://model-mdl-abc123.api.baseten.co/production/predict',
        }),
        text: async () => '',
      } as any);

      const result = await adapter.deploy(config);
      expect(result.providerDeploymentId).toBe('mdl-abc123');
      expect(result.endpointUrl).toBe('https://model-mdl-abc123.api.baseten.co/production/predict');
      expect(result.status).toBe('DEPLOYING');

      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/models`,
        expect.objectContaining({ method: 'POST' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.name).toBe('test-model');
      expect(body.docker_image).toBe('my-org/my-image:latest');
      expect(body.gpu).toBe('A100');
      expect(body.min_replica).toBe(0);
      expect(body.max_replica).toBe(3);
    });

    it('falls back to data.id when model_id is absent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'alt-id-456' }),
        text: async () => '',
      } as any);

      const result = await adapter.deploy(config);
      expect(result.providerDeploymentId).toBe('alt-id-456');
    });

    it('generates fallback endpoint URL when url is absent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model_id: 'mdl-xyz' }),
        text: async () => '',
      } as any);

      const result = await adapter.deploy(config);
      expect(result.endpointUrl).toBe('https://model-mdl-xyz.api.baseten.co/production/predict');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'Internal error',
      } as any);

      await expect(adapter.deploy(config)).rejects.toThrow('Baseten deploy failed (500): Internal error');
    });
  });

  describe('getStatus', () => {
    it('maps ACTIVE to ONLINE', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ACTIVE', url: 'https://baseten.co/predict' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('mdl-abc123');
      expect(result.status).toBe('ONLINE');
      expect(result.endpointUrl).toBe('https://baseten.co/predict');

      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/models/mdl-abc123`,
        expect.any(Object),
      );
    });

    it('maps BUILDING to DEPLOYING', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'BUILDING' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('mdl-abc123');
      expect(result.status).toBe('DEPLOYING');
    });

    it('maps SCALING to DEPLOYING', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'SCALING' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('mdl-abc123');
      expect(result.status).toBe('DEPLOYING');
    });

    it('maps FAILED to FAILED', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'FAILED' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('mdl-abc123');
      expect(result.status).toBe('FAILED');
    });

    it('maps STOPPED to FAILED', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'STOPPED' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('mdl-abc123');
      expect(result.status).toBe('FAILED');
    });

    it('defaults unknown status to DEPLOYING', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'UNKNOWN_STATE' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('mdl-abc123');
      expect(result.status).toBe('DEPLOYING');
    });

    it('returns FAILED when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('mdl-abc123');
      expect(result.status).toBe('FAILED');
    });
  });

  describe('destroy', () => {
    it('calls DELETE on the model endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
      } as any);

      await adapter.destroy('mdl-abc123');
      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/models/mdl-abc123`,
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

      await expect(adapter.destroy('mdl-abc123')).resolves.toBeUndefined();
    });

    it('throws on non-404 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => '',
      } as any);

      await expect(adapter.destroy('mdl-abc123')).rejects.toThrow('Baseten destroy failed (500)');
    });
  });

  describe('update', () => {
    it('sends PATCH with updated docker_image', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ url: 'https://baseten.co/updated' }),
        text: async () => '',
      } as any);

      const updateConfig: UpdateConfig = { dockerImage: 'my-org/new-image:v2' };
      const result = await adapter.update('mdl-abc123', updateConfig);

      expect(result.providerDeploymentId).toBe('mdl-abc123');
      expect(result.status).toBe('UPDATING');
      expect(result.endpointUrl).toBe('https://baseten.co/updated');

      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/models/mdl-abc123`,
        expect.objectContaining({ method: 'PATCH' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.docker_image).toBe('my-org/new-image:v2');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => '',
      } as any);

      await expect(adapter.update('mdl-abc123', {})).rejects.toThrow('Baseten update failed (400)');
    });
  });

  describe('healthCheck', () => {
    it('returns GREEN when status is ACTIVE', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ACTIVE' }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('mdl-abc123');
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('GREEN');
      expect(result.statusCode).toBe(200);
    });

    it('returns RED when status is not ACTIVE', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'BUILDING' }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('mdl-abc123');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
    });

    it('returns RED when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('mdl-abc123');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
      expect(result.statusCode).toBe(503);
    });

    it('returns RED when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await adapter.healthCheck('mdl-abc123');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
    });
  });
});
