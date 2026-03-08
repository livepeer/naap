import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DeployConfig, UpdateConfig } from '../types/index.js';

const mockAuthFetch = vi.fn();

vi.mock('../lib/providerFetch.js', () => ({
  authenticatedProviderFetch: (...args: any[]) => mockAuthFetch(...args),
  providerFetch: vi.fn(),
  setAuthContext: vi.fn(),
  getAuthContext: vi.fn(() => ({})),
  resolveUserId: vi.fn(),
}));

// Import adapter after mock is set up
import { RunPodAdapter } from '../adapters/RunPodAdapter.js';

function fakeResponse(status: number, body: any, ok?: boolean): Response {
  return {
    ok: ok ?? (status >= 200 && status < 300),
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: new Headers(),
    statusText: '',
    redirected: false,
    type: 'basic',
    url: '',
    clone: () => fakeResponse(status, body, ok),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
  } as unknown as Response;
}

const MANAGEMENT_BASE = 'https://rest.runpod.io/v1';
const SERVERLESS_BASE = 'https://api.runpod.ai/v2';

describe('RunPodAdapter', () => {
  let adapter: RunPodAdapter;

  beforeEach(() => {
    mockAuthFetch.mockReset();
    adapter = new RunPodAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(adapter.slug).toBe('runpod');
    expect(adapter.mode).toBe('serverless');
  });

  it('has correct api config for rest.runpod.io', () => {
    expect(adapter.apiConfig.upstreamBaseUrl).toBe(MANAGEMENT_BASE);
    expect(adapter.apiConfig.authType).toBe('bearer');
  });

  describe('getGpuOptions', () => {
    it('returns static GPU options (RunPod REST API does not have a GPU list endpoint)', async () => {
      const options = await adapter.getGpuOptions();
      expect(options.length).toBeGreaterThan(0);
      expect(options[0].id).toBe('NVIDIA GeForce RTX 4090');
      expect(options[0].vramGb).toBe(24);
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
      mockAuthFetch
        .mockResolvedValueOnce(fakeResponse(200, { id: 'tmpl-xyz' }))   // POST /templates
        .mockResolvedValueOnce(fakeResponse(200, { id: 'ep-abc123' })); // POST /endpoints

      const result = await adapter.deploy(config);
      expect(result.providerDeploymentId).toBe('ep-abc123');
      expect(result.endpointUrl).toBe('https://api.runpod.ai/v2/ep-abc123');
      expect(result.status).toBe('DEPLOYING');
      expect(result.metadata?.templateId).toBe('tmpl-xyz');

      expect(mockAuthFetch).toHaveBeenCalledTimes(2);

      // First call: create template
      const [slug1, apiCfg1, path1, opts1] = mockAuthFetch.mock.calls[0];
      expect(slug1).toBe('runpod');
      expect(apiCfg1.upstreamBaseUrl).toBe(MANAGEMENT_BASE);
      expect(path1).toBe('/templates');
      const templateBody = JSON.parse(opts1.body);
      expect(templateBody.imageName).toBe('my-org/my-image:latest');
      expect(templateBody.isServerless).toBe(true);
      expect(templateBody.env).toEqual({ MODEL_ID: 'test' });

      // Second call: create endpoint
      const [slug2, apiCfg2, path2, opts2] = mockAuthFetch.mock.calls[1];
      expect(slug2).toBe('runpod');
      expect(apiCfg2.upstreamBaseUrl).toBe(MANAGEMENT_BASE);
      expect(path2).toBe('/endpoints');
      const endpointBody = JSON.parse(opts2.body);
      expect(endpointBody.templateId).toBe('tmpl-xyz');
      expect(endpointBody.gpuTypeIds).toEqual(['NVIDIA A100-SXM4-80GB']);
      expect(endpointBody.workersMin).toBe(0);
      expect(endpointBody.workersMax).toBe(1);
    });

    it('throws when template creation fails', async () => {
      mockAuthFetch.mockResolvedValueOnce(fakeResponse(400, 'Invalid template', false));

      await expect(adapter.deploy(config)).rejects.toThrow('RunPod template creation failed (400)');
    });

    it('throws when endpoint creation fails', async () => {
      mockAuthFetch
        .mockResolvedValueOnce(fakeResponse(200, { id: 'tmpl-xyz' }))
        .mockResolvedValueOnce(fakeResponse(422, 'Validation error', false));

      await expect(adapter.deploy(config)).rejects.toThrow('RunPod endpoint creation failed (422)');
    });
  });

  describe('getStatus', () => {
    // getStatus calls Promise.allSettled with:
    //   [0] serverlessApiConfig, /<id>/health
    //   [1] apiConfig, /endpoints/<id>

    it('returns ONLINE when serverless scaled to zero', async () => {
      // health endpoint returns workers with all zeros
      mockAuthFetch.mockImplementation((_slug: string, apiCfg: any, path: string) => {
        if (apiCfg.upstreamBaseUrl === SERVERLESS_BASE) {
          return Promise.resolve(fakeResponse(200, { status: 'READY', workers: { ready: 0, idle: 0, running: 0, initializing: 0 } }));
        }
        // config endpoint returns workersMin=0 (serverless)
        return Promise.resolve(fakeResponse(200, { workersMin: 0, status: 'READY' }));
      });

      const result = await adapter.getStatus('ep-abc123');
      expect(result.status).toBe('ONLINE');
      expect(result.endpointUrl).toBe('https://api.runpod.ai/v2/ep-abc123');
    });

    it('returns ONLINE when workers are running', async () => {
      mockAuthFetch.mockImplementation((_slug: string, apiCfg: any) => {
        if (apiCfg.upstreamBaseUrl === SERVERLESS_BASE) {
          return Promise.resolve(fakeResponse(200, { workers: { ready: 1, idle: 0, running: 1, initializing: 0 } }));
        }
        return Promise.resolve(fakeResponse(200, { workersMin: 0 }));
      });

      const result = await adapter.getStatus('ep-abc123');
      expect(result.status).toBe('ONLINE');
    });

    it('returns DEPLOYING when workers are initializing', async () => {
      mockAuthFetch.mockImplementation((_slug: string, apiCfg: any) => {
        if (apiCfg.upstreamBaseUrl === SERVERLESS_BASE) {
          return Promise.resolve(fakeResponse(200, { workers: { ready: 0, idle: 0, running: 0, initializing: 1 } }));
        }
        return Promise.resolve(fakeResponse(200, { workersMin: 1, createdAt: new Date().toISOString() }));
      });

      const result = await adapter.getStatus('ep-abc123');
      expect(result.status).toBe('DEPLOYING');
    });

    it('returns DEPLOYING when both APIs fail with non-410', async () => {
      mockAuthFetch.mockImplementation(() => {
        return Promise.resolve(fakeResponse(500, {}, false));
      });

      const result = await adapter.getStatus('ep-abc123');
      expect(result.status).toBe('DEPLOYING');
    });

    it('returns FAILED when health returns 410 Gone and config also fails', async () => {
      mockAuthFetch.mockImplementation((_slug: string, apiCfg: any) => {
        if (apiCfg.upstreamBaseUrl === SERVERLESS_BASE) {
          return Promise.resolve(fakeResponse(410, {}, false));
        }
        return Promise.resolve(fakeResponse(404, {}, false));
      });

      const result = await adapter.getStatus('ep-abc123');
      expect(result.status).toBe('FAILED');
    });
  });

  describe('destroy', () => {
    // destroy uses deleteAndVerify which has retries and setTimeout.
    // We use fake timers and advance them to avoid real delays.

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
      // Repeatedly advance timers until the promise resolves
      let resolved = false;
      let result: T;
      let error: any;
      const p = promise.then(
        (v) => { resolved = true; result = v; },
        (e) => { resolved = true; error = e; },
      );
      while (!resolved) {
        await vi.advanceTimersByTimeAsync(10_000);
      }
      await p;
      if (error) throw error;
      return result!;
    }

    it('deletes endpoint and template', async () => {
      mockAuthFetch.mockImplementation((_slug: string, _apiCfg: any, path: string, opts?: any) => {
        const method = opts?.method || 'GET';
        if (method === 'GET' && path === '/endpoints/ep-abc123') {
          // First GET resolves templateId; subsequent GETs for verify return 404
          const callsToThisPath = mockAuthFetch.mock.calls.filter(
            (c: any[]) => (c[3]?.method || 'GET') === 'GET' && c[2] === '/endpoints/ep-abc123'
          );
          if (callsToThisPath.length <= 1) {
            return Promise.resolve(fakeResponse(200, { templateId: 'tpl-x' }));
          }
          return Promise.resolve(fakeResponse(404, {}, false));
        }
        if (method === 'DELETE' && path === '/endpoints/ep-abc123') {
          return Promise.resolve(fakeResponse(200, {}));
        }
        if (method === 'DELETE' && path === '/templates/tpl-x') {
          return Promise.resolve(fakeResponse(204, {}));
        }
        if (method === 'GET' && path === '/templates/tpl-x') {
          return Promise.resolve(fakeResponse(404, {}, false));
        }
        return Promise.resolve(fakeResponse(404, {}, false));
      });

      const result = await runWithTimers(adapter.destroy('ep-abc123'));
      expect(result.allClean).toBe(true);
    });

    it('uses stored metadata.templateId when available', async () => {
      mockAuthFetch.mockImplementation((_slug: string, _apiCfg: any, path: string, opts?: any) => {
        const method = opts?.method || 'GET';
        if (method === 'DELETE') {
          if (path === '/endpoints/ep-abc123') return Promise.resolve(fakeResponse(200, {}));
          if (path === '/templates/tpl-stored') return Promise.resolve(fakeResponse(204, {}));
        }
        // All GETs (verify) return 404 = confirmed gone
        return Promise.resolve(fakeResponse(404, {}, false));
      });

      const result = await runWithTimers(adapter.destroy('ep-abc123', { templateId: 'tpl-stored' }));
      expect(result.allClean).toBe(true);

      // Verify template delete was called with the stored templateId
      const templateDeleteCall = mockAuthFetch.mock.calls.find(
        (c: any[]) => c[2] === '/templates/tpl-stored' && c[3]?.method === 'DELETE'
      );
      expect(templateDeleteCall).toBeTruthy();
    });

    it('handles endpoint already deleted (404)', async () => {
      mockAuthFetch.mockImplementation((_slug: string, _apiCfg: any, path: string, opts?: any) => {
        const method = opts?.method || 'GET';
        if (method === 'DELETE' && path === '/endpoints/ep-abc123') {
          return Promise.resolve(fakeResponse(404, {}, false));
        }
        if (method === 'DELETE' && path === '/templates/tpl-x') {
          return Promise.resolve(fakeResponse(204, {}));
        }
        if (method === 'GET' && path === '/endpoints/ep-abc123') {
          return Promise.resolve(fakeResponse(200, { templateId: 'tpl-x' }));
        }
        // Verify calls
        return Promise.resolve(fakeResponse(404, {}, false));
      });

      const result = await runWithTimers(adapter.destroy('ep-abc123'));
      // deleteAndVerify returns immediately on 404 from DELETE
      expect(result.allClean).toBe(true);
    });

    it('reports failure on non-404 DELETE error', async () => {
      mockAuthFetch.mockImplementation((_slug: string, _apiCfg: any, path: string, opts?: any) => {
        const method = opts?.method || 'GET';
        if (method === 'GET' && path === '/endpoints/ep-abc123') {
          return Promise.resolve(fakeResponse(200, { templateId: 'tpl-x' }));
        }
        if (method === 'DELETE' && path === '/endpoints/ep-abc123') {
          return Promise.resolve(fakeResponse(500, 'Server Error', false));
        }
        // After failed delete, verify still shows it exists
        if (method === 'GET') {
          return Promise.resolve(fakeResponse(200, {}));
        }
        return Promise.resolve(fakeResponse(500, 'Server Error', false));
      });

      const result = await runWithTimers(adapter.destroy('ep-abc123'));
      // Should not be allClean since endpoint delete kept failing
      expect(result.allClean).toBe(false);
    });
  });

  describe('update', () => {
    it('sends PUT with updated fields using RunPod field names', async () => {
      mockAuthFetch.mockResolvedValueOnce(fakeResponse(200, { id: 'ep-abc123' }));

      const updateConfig: UpdateConfig = {
        dockerImage: 'my-org/new-image:v2',
        gpuModel: 'NVIDIA H100 80GB HBM3',
        gpuCount: 2,
      };
      const result = await adapter.update('ep-abc123', updateConfig);

      expect(result.providerDeploymentId).toBe('ep-abc123');
      expect(result.status).toBe('UPDATING');
      expect(result.endpointUrl).toBe('https://api.runpod.ai/v2/ep-abc123');

      const [, , path, opts] = mockAuthFetch.mock.calls[0];
      expect(path).toBe('/endpoints/ep-abc123');
      expect(opts.method).toBe('PUT');
      const body = JSON.parse(opts.body);
      expect(body.imageName).toBe('my-org/new-image:v2');
      expect(body.gpuTypeIds).toEqual(['NVIDIA H100 80GB HBM3']);
      expect(body.gpuCount).toBe(2);
    });

    it('throws on HTTP error', async () => {
      mockAuthFetch.mockResolvedValueOnce(fakeResponse(400, 'Bad Request', false));

      await expect(adapter.update('ep-abc123', {})).rejects.toThrow('RunPod update failed (400)');
    });
  });

  describe('healthCheck', () => {
    // healthCheck calls Promise.all with:
    //   [0] serverlessApiConfig, /<id>/health
    //   [1] apiConfig, /endpoints/<id>

    it('returns GREEN when workers are ready', async () => {
      mockAuthFetch.mockImplementation((_slug: string, apiCfg: any) => {
        if (apiCfg.upstreamBaseUrl === SERVERLESS_BASE) {
          return Promise.resolve(fakeResponse(200, { status: 'READY', workers: { ready: 1, idle: 0, running: 0 } }));
        }
        return Promise.resolve(fakeResponse(200, { workersMin: 1 }));
      });

      const result = await adapter.healthCheck('ep-abc123');
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('GREEN');
      expect(result.statusCode).toBe(200);
    });

    it('returns GREEN when workers are running', async () => {
      mockAuthFetch.mockImplementation((_slug: string, apiCfg: any) => {
        if (apiCfg.upstreamBaseUrl === SERVERLESS_BASE) {
          return Promise.resolve(fakeResponse(200, { status: 'SOMETHING', workers: { running: 2, ready: 0, idle: 0 } }));
        }
        return Promise.resolve(fakeResponse(200, { workersMin: 1 }));
      });

      const result = await adapter.healthCheck('ep-abc123');
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('GREEN');
    });

    it('returns ORANGE when serverless scaled to zero', async () => {
      mockAuthFetch.mockImplementation((_slug: string, apiCfg: any) => {
        if (apiCfg.upstreamBaseUrl === SERVERLESS_BASE) {
          return Promise.resolve(fakeResponse(200, { status: 'OFFLINE', workers: { running: 0, ready: 0, idle: 0 } }));
        }
        return Promise.resolve(fakeResponse(200, { workersMin: 0 }));
      });

      const result = await adapter.healthCheck('ep-abc123');
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('ORANGE');
    });

    it('returns RED when both APIs fail', async () => {
      mockAuthFetch.mockImplementation(() => {
        return Promise.resolve(fakeResponse(503, {}, false));
      });

      const result = await adapter.healthCheck('ep-abc123');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
      expect(result.statusCode).toBe(503);
    });

    it('returns RED when fetch throws', async () => {
      mockAuthFetch.mockRejectedValue(new Error('Network error'));

      const result = await adapter.healthCheck('ep-abc123');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
    });

    it('calls the correct health endpoint', async () => {
      mockAuthFetch.mockImplementation((_slug: string, apiCfg: any) => {
        if (apiCfg.upstreamBaseUrl === SERVERLESS_BASE) {
          return Promise.resolve(fakeResponse(200, { status: 'READY', workers: { ready: 1 } }));
        }
        return Promise.resolve(fakeResponse(200, { workersMin: 0 }));
      });

      await adapter.healthCheck('ep-abc123');

      const healthCall = mockAuthFetch.mock.calls.find(
        (c: any[]) => c[1]?.upstreamBaseUrl === SERVERLESS_BASE
      );
      expect(healthCall).toBeTruthy();
      expect(healthCall![2]).toBe('/ep-abc123/health');
    });
  });
});
