import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModalAdapter } from '../adapters/ModalAdapter.js';
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

const UPSTREAM_BASE = 'https://api.modal.com/v1';

describe('ModalAdapter', () => {
  let adapter: ModalAdapter;
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockClear();
    adapter = new ModalAdapter();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(adapter.slug).toBe('modal');
    expect(adapter.mode).toBe('serverless');
    expect(adapter.authMethod).toBe('token');
  });

  describe('getGpuOptions', () => {
    it('returns a static list of GPU options with prices', async () => {
      const options = await adapter.getGpuOptions();
      expect(options.length).toBeGreaterThan(0);
      expect(options[0]).toMatchObject({ id: 'a100-80gb', vramGb: 80, available: true });
      expect(options[0].pricePerHour).toBeDefined();
      expect(options.every((o) => o.available)).toBe(true);
    });
  });

  describe('deploy', () => {
    const config: DeployConfig = {
      name: 'test-app',
      providerSlug: 'modal',
      gpuModel: 'a100-80gb',
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
        json: async () => ({
          app_id: 'app-modal-123',
          web_url: 'https://test-app--serve.modal.run',
        }),
        text: async () => '',
      } as any);

      const result = await adapter.deploy(config);
      expect(result.providerDeploymentId).toBe('app-modal-123');
      expect(result.endpointUrl).toBe('https://test-app--serve.modal.run');
      expect(result.status).toBe('DEPLOYING');

      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/apps`,
        expect.objectContaining({ method: 'POST' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.name).toBe('test-app');
      expect(body.image).toBe('my-org/my-image:latest');
      expect(body.gpu).toBe('a100-80gb');
      expect(body.gpu_count).toBe(1);
      expect(body.min_containers).toBe(0);
      expect(body.max_containers).toBe(5);
    });

    it('falls back to data.id when app_id is absent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'alt-id-789' }),
        text: async () => '',
      } as any);

      const result = await adapter.deploy(config);
      expect(result.providerDeploymentId).toBe('alt-id-789');
    });

    it('generates fallback web_url when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ app_id: 'app-123' }),
        text: async () => '',
      } as any);

      const result = await adapter.deploy(config);
      expect(result.endpointUrl).toBe('https://test-app--serve.modal.run');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'Server error',
      } as any);

      await expect(adapter.deploy(config)).rejects.toThrow('Modal deploy failed (500): Server error');
    });
  });

  describe('getStatus', () => {
    it('maps deployed to ONLINE', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'deployed', web_url: 'https://app.modal.run' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('app-modal-123');
      expect(result.status).toBe('ONLINE');
      expect(result.endpointUrl).toBe('https://app.modal.run');

      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/apps/app-modal-123`,
        expect.any(Object),
      );
    });

    it('maps deploying to DEPLOYING', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'deploying' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('app-modal-123');
      expect(result.status).toBe('DEPLOYING');
    });

    it('maps stopped to FAILED', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'stopped' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('app-modal-123');
      expect(result.status).toBe('FAILED');
    });

    it('maps errored to FAILED', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'errored' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('app-modal-123');
      expect(result.status).toBe('FAILED');
    });

    it('uses status field as fallback when state is absent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'deployed', web_url: 'https://app.modal.run' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('app-modal-123');
      expect(result.status).toBe('ONLINE');
    });

    it('defaults unknown state to DEPLOYING', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'pending' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('app-modal-123');
      expect(result.status).toBe('DEPLOYING');
    });

    it('returns FAILED when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('app-modal-123');
      expect(result.status).toBe('FAILED');
    });
  });

  describe('destroy', () => {
    it('calls DELETE on the app endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
      } as any);

      await adapter.destroy('app-modal-123');
      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/apps/app-modal-123`,
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

      await expect(adapter.destroy('app-modal-123')).resolves.toBeUndefined();
    });

    it('throws on non-404 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => '',
      } as any);

      await expect(adapter.destroy('app-modal-123')).rejects.toThrow('Modal destroy failed (500)');
    });
  });

  describe('update', () => {
    it('sends PUT with updated fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ web_url: 'https://app-updated.modal.run' }),
        text: async () => '',
      } as any);

      const updateConfig: UpdateConfig = {
        dockerImage: 'my-org/new-image:v2',
        gpuModel: 'h100',
      };
      const result = await adapter.update('app-modal-123', updateConfig);

      expect(result.providerDeploymentId).toBe('app-modal-123');
      expect(result.status).toBe('UPDATING');
      expect(result.endpointUrl).toBe('https://app-updated.modal.run');

      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/apps/app-modal-123`,
        expect.objectContaining({ method: 'PUT' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.image).toBe('my-org/new-image:v2');
      expect(body.gpu).toBe('h100');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => '',
      } as any);

      await expect(adapter.update('app-modal-123', {})).rejects.toThrow('Modal update failed (400)');
    });
  });

  describe('healthCheck', () => {
    it('returns GREEN when state is deployed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'deployed' }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('app-modal-123');
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('GREEN');
      expect(result.statusCode).toBe(200);
    });

    it('returns GREEN when status field is deployed (fallback)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'deployed' }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('app-modal-123');
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('GREEN');
    });

    it('returns RED when state is not deployed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ state: 'stopped' }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('app-modal-123');
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

      const result = await adapter.healthCheck('app-modal-123');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
      expect(result.statusCode).toBe(503);
    });

    it('returns RED when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await adapter.healthCheck('app-modal-123');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
    });
  });
});
