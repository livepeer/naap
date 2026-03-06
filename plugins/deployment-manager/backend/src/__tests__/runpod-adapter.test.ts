import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunPodAdapter } from '../adapters/RunPodAdapter.js';
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

const UPSTREAM_BASE = 'https://rest.runpod.io/v1';

describe('RunPodAdapter', () => {
  let adapter: RunPodAdapter;
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockClear();
    adapter = new RunPodAdapter();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(adapter.slug).toBe('runpod');
    expect(adapter.mode).toBe('serverless');
  });

  it('has correct api config for rest.runpod.io', () => {
    expect(adapter.apiConfig.upstreamBaseUrl).toBe('https://rest.runpod.io/v1');
    expect(adapter.apiConfig.authType).toBe('bearer');
  });

  describe('getGpuOptions', () => {
    it('returns static GPU options (RunPod REST API does not have a GPU list endpoint)', async () => {
      const options = await adapter.getGpuOptions();
      expect(options.length).toBeGreaterThan(0);
      expect(options[0].id).toBe('NVIDIA GeForce RTX 4090');
      expect(options[0].vramGb).toBe(24);
    });

    it('falls back to static options on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const options = await adapter.getGpuOptions();
      expect(options.length).toBeGreaterThan(0);
      expect(options[0].id).toBe('NVIDIA GeForce RTX 4090');
    });

    it('falls back to static options on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => '',
      } as any);

      const options = await adapter.getGpuOptions();
      expect(options.length).toBeGreaterThan(0);
      expect(options[0].id).toBe('NVIDIA GeForce RTX 4090');
    });
  });

  describe('deploy', () => {
    const config: DeployConfig = {
      name: 'test-endpoint',
      providerSlug: 'runpod',
      gpuModel: 'NVIDIA A100-SXM4-80GB',
      gpuVramGb: 80,
      gpuCount: 1,
      artifactType: 'ai-runner',
      artifactVersion: 'v1.0',
      dockerImage: 'my-org/my-image:latest',
      artifactConfig: { MODEL_ID: 'test' },
    };

    it('creates template then endpoint (2-step deploy)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'tmpl-xyz' }),
        text: async () => '',
      } as any);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'ep-abc123' }),
        text: async () => '',
      } as any);

      const result = await adapter.deploy(config);
      expect(result.providerDeploymentId).toBe('ep-abc123');
      expect(result.endpointUrl).toBe('https://api.runpod.ai/v2/ep-abc123');
      expect(result.status).toBe('DEPLOYING');
      expect(result.metadata?.templateId).toBe('tmpl-xyz');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe(`${UPSTREAM_BASE}/templates`);
      const templateBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(templateBody.imageName).toBe('my-org/my-image:latest');
      expect(templateBody.isServerless).toBe(true);
      expect(templateBody.env).toEqual({ MODEL_ID: 'test' });

      expect(mockFetch.mock.calls[1][0]).toBe(`${UPSTREAM_BASE}/endpoints`);
      const endpointBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(endpointBody.templateId).toBe('tmpl-xyz');
      expect(endpointBody.gpuTypeIds).toEqual(['NVIDIA A100-SXM4-80GB']);
      expect(endpointBody.workersMin).toBe(0);
      expect(endpointBody.workersMax).toBe(1);
    });

    it('throws when template creation fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => 'Invalid template',
      } as any);

      await expect(adapter.deploy(config)).rejects.toThrow('RunPod template creation failed (400)');
    });

    it('throws when endpoint creation fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'tmpl-xyz' }),
        text: async () => '',
      } as any);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({}),
        text: async () => 'Validation error',
      } as any);

      await expect(adapter.deploy(config)).rejects.toThrow('RunPod endpoint creation failed (422)');
    });
  });

  describe('getStatus', () => {
    it('maps READY to ONLINE', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'READY' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('ep-abc123');
      expect(result.status).toBe('ONLINE');
      expect(result.endpointUrl).toBe('https://api.runpod.ai/v2/ep-abc123');
    });

    it('maps INITIALIZING to DEPLOYING', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'INITIALIZING' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('ep-abc123');
      expect(result.status).toBe('DEPLOYING');
    });

    it('maps UNHEALTHY to ONLINE', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'UNHEALTHY' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('ep-abc123');
      expect(result.status).toBe('ONLINE');
    });

    it('maps OFFLINE to ONLINE (serverless cold-start)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'OFFLINE' }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('ep-abc123');
      expect(result.status).toBe('ONLINE');
    });

    it('returns FAILED when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('ep-abc123');
      expect(result.status).toBe('FAILED');
    });
  });

  describe('destroy', () => {
    const mockEndpointDetail = { ok: true, status: 200, json: async () => ({ templateId: 'tpl-x' }), text: async () => '' } as any;
    const mockGone = { ok: false, status: 404, json: async () => ({}), text: async () => 'Not Found' } as any;
    const mockTemplateDelete = { ok: true, status: 204, json: async () => ({}), text: async () => '' } as any;

    it('calls DELETE on the endpoint and cleans up template', async () => {
      mockFetch
        .mockResolvedValueOnce(mockEndpointDetail) // GET endpoint details → templateId
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}), text: async () => '' } as any) // DELETE endpoint
        .mockResolvedValueOnce(mockGone)            // GET verify endpoint gone → 404
        .mockResolvedValueOnce(mockTemplateDelete); // DELETE template

      await adapter.destroy('ep-abc123');
      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/endpoints/ep-abc123`,
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/templates/tpl-x`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('uses stored metadata.templateId when available', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}), text: async () => '' } as any) // DELETE endpoint (no detail fetch needed)
        .mockResolvedValueOnce(mockGone)            // GET verify → 404
        .mockResolvedValueOnce(mockTemplateDelete); // DELETE template

      await adapter.destroy('ep-abc123', { templateId: 'tpl-stored' });
      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/templates/tpl-stored`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('does not throw on 404', async () => {
      mockFetch
        .mockResolvedValueOnce(mockEndpointDetail) // GET details
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}), text: async () => 'Not Found' } as any) // DELETE 404
        .mockResolvedValueOnce(mockGone)            // verify → 404
        .mockResolvedValueOnce(mockTemplateDelete); // DELETE template

      await expect(adapter.destroy('ep-abc123')).resolves.toBeUndefined();
    });

    it('throws on non-404 error', async () => {
      mockFetch
        .mockResolvedValueOnce(mockEndpointDetail)
        .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}), text: async () => 'Server Error' } as any);

      await expect(adapter.destroy('ep-abc123')).rejects.toThrow('RunPod destroy failed (500)');
    });
  });

  describe('update', () => {
    it('sends PUT with updated fields using RunPod field names', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'ep-abc123' }),
        text: async () => '',
      } as any);

      const updateConfig: UpdateConfig = {
        dockerImage: 'my-org/new-image:v2',
        gpuModel: 'NVIDIA H100 80GB HBM3',
        gpuCount: 2,
      };
      const result = await adapter.update('ep-abc123', updateConfig);

      expect(result.providerDeploymentId).toBe('ep-abc123');
      expect(result.status).toBe('UPDATING');
      expect(result.endpointUrl).toBe('https://api.runpod.ai/v2/ep-abc123');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.imageName).toBe('my-org/new-image:v2');
      expect(body.gpuTypeIds).toEqual(['NVIDIA H100 80GB HBM3']);
      expect(body.gpuCount).toBe(2);
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => 'Bad Request',
      } as any);

      await expect(adapter.update('ep-abc123', {})).rejects.toThrow('RunPod update failed (400)');
    });
  });

  describe('healthCheck', () => {
    it('returns GREEN when status is READY', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'READY', workers: { running: 1 } }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('ep-abc123');
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('GREEN');
      expect(result.statusCode).toBe(200);
    });

    it('returns GREEN when workers are running', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'SOMETHING', workers: { running: 2 } }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('ep-abc123');
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('GREEN');
    });

    it('returns RED when not ready and no workers running', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'OFFLINE', workers: { running: 0 } }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck('ep-abc123');
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

      const result = await adapter.healthCheck('ep-abc123');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
      expect(result.statusCode).toBe(503);
    });

    it('returns RED when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await adapter.healthCheck('ep-abc123');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
    });

    it('calls the correct health endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'READY' }),
        text: async () => '',
      } as any);

      await adapter.healthCheck('ep-abc123');
      expect(mockFetch).toHaveBeenCalledWith(
        `${UPSTREAM_BASE}/endpoints/ep-abc123/health`,
        expect.any(Object),
      );
    });
  });
});
