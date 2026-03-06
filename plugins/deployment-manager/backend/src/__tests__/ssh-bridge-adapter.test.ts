import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SshBridgeAdapter } from '../adapters/SshBridgeAdapter.js';
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

const SSH_BRIDGE_URL = process.env.SSH_BRIDGE_URL || 'http://localhost:2222';

describe('SshBridgeAdapter', () => {
  let adapter: SshBridgeAdapter;
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockClear();
    adapter = new SshBridgeAdapter();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(adapter.slug).toBe('ssh-bridge');
    expect(adapter.mode).toBe('ssh-bridge');
    expect(adapter.authMethod).toBe('ssh-key');
  });

  describe('getGpuOptions', () => {
    it('returns a static list with custom option', async () => {
      const options = await adapter.getGpuOptions();
      expect(options.length).toBeGreaterThan(0);
      expect(options.some((o) => o.id === 'custom')).toBe(true);
      expect(options.some((o) => o.id === 'NVIDIA A100 80GB')).toBe(true);
    });
  });

  describe('deploy', () => {
    const baseConfig: DeployConfig = {
      name: 'test-deploy',
      providerSlug: 'ssh-bridge',
      gpuModel: 'NVIDIA A100 80GB',
      gpuVramGb: 80,
      gpuCount: 1,
      artifactType: 'ai-runner',
      artifactVersion: 'v1.0',
      dockerImage: 'my-org/my-image:latest',
      sshHost: '192.168.1.100',
      sshUsername: 'deploy',
      sshPort: 22,
      containerName: 'naap-test',
      healthPort: 8080,
      healthEndpoint: '/health',
    };

    it('connects then runs deploy script and returns composite id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ connected: true }),
        text: async () => '',
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { jobId: 'job-456' } }),
        text: async () => '',
      } as any);

      const result = await adapter.deploy(baseConfig);

      expect(result.providerDeploymentId).toBe('192.168.1.100:naap-test:job-456:8080:/health');
      expect(result.endpointUrl).toBe('http://192.168.1.100:8080');
      expect(result.status).toBe('DEPLOYING');
      expect(result.metadata).toMatchObject({
        jobId: 'job-456',
        containerName: 'naap-test',
        sshHost: '192.168.1.100',
      });

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        `${SSH_BRIDGE_URL}/connect`,
        expect.objectContaining({ method: 'POST' }),
      );
      const connectBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(connectBody.host).toBe('192.168.1.100');
      expect(connectBody.username).toBe('deploy');

      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        `${SSH_BRIDGE_URL}/exec/script`,
        expect.objectContaining({ method: 'POST' }),
      );
      const scriptBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(scriptBody.host).toBe('192.168.1.100');
      expect(scriptBody.script).toContain('docker pull my-org/my-image:latest');
      expect(scriptBody.script).toContain('docker run -d --name naap-test');
      expect(scriptBody.timeout).toBe(1800000);
    });

    it('uses jobId at top level if data.jobId is absent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ connected: true }),
        text: async () => '',
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ jobId: 'top-level-job' }),
        text: async () => '',
      } as any);

      const result = await adapter.deploy(baseConfig);
      expect(result.providerDeploymentId).toContain('top-level-job');
    });

    it('generates container name when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ connected: true }),
        text: async () => '',
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { jobId: 'job-auto' } }),
        text: async () => '',
      } as any);

      const configNoContainer = { ...baseConfig, containerName: undefined };
      const result = await adapter.deploy(configNoContainer);
      expect(result.providerDeploymentId).toMatch(/192\.168\.1\.100:naap-ai-runner-\d+:job-auto:8080:\/health/);
    });

    it('throws when sshHost is missing', async () => {
      const badConfig = { ...baseConfig, sshHost: undefined };
      await expect(adapter.deploy(badConfig as any)).rejects.toThrow('SSH host and username are required');
    });

    it('throws when sshUsername is missing', async () => {
      const badConfig = { ...baseConfig, sshUsername: undefined };
      await expect(adapter.deploy(badConfig as any)).rejects.toThrow('SSH host and username are required');
    });

    it('throws when SSH connection fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'Connection refused',
      } as any);

      await expect(adapter.deploy(baseConfig)).rejects.toThrow('SSH connection failed: Connection refused');
    });

    it('throws when script submission fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ connected: true }),
        text: async () => '',
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'Script timeout',
      } as any);

      await expect(adapter.deploy(baseConfig)).rejects.toThrow('SSH deploy script submission failed: Script timeout');
    });
  });

  describe('getStatus', () => {
    const deploymentId = '192.168.1.100:naap-test:job-456:8080:/health';

    it('returns ONLINE when job completed with exit code 0', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { status: 'completed', exitCode: 0 },
        }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus(deploymentId);
      expect(result.status).toBe('ONLINE');
      expect(result.endpointUrl).toBe('http://192.168.1.100:8080');

      expect(mockFetch).toHaveBeenCalledWith(
        `${SSH_BRIDGE_URL}/jobs/job-456`,
        expect.any(Object),
      );
    });

    it('returns FAILED when job completed with non-zero exit code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { status: 'completed', exitCode: 1 },
        }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus(deploymentId);
      expect(result.status).toBe('FAILED');
    });

    it('returns FAILED when job status is failed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { status: 'failed' },
        }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus(deploymentId);
      expect(result.status).toBe('FAILED');
    });

    it('returns FAILED when job status is timeout', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { status: 'timeout' },
        }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus(deploymentId);
      expect(result.status).toBe('FAILED');
    });

    it('returns FAILED when job status is cancelled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { status: 'cancelled' },
        }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus(deploymentId);
      expect(result.status).toBe('FAILED');
    });

    it('returns DEPLOYING when job is still running', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { status: 'running' },
        }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus(deploymentId);
      expect(result.status).toBe('DEPLOYING');
    });

    it('uses top-level status/exitCode if data is absent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'completed', exitCode: 0 }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus(deploymentId);
      expect(result.status).toBe('ONLINE');
    });

    it('falls back to ONLINE when job fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus(deploymentId);
      expect(result.status).toBe('ONLINE');
      expect(result.endpointUrl).toBe('http://192.168.1.100:8080');
    });

    it('falls back to ONLINE when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await adapter.getStatus(deploymentId);
      expect(result.status).toBe('ONLINE');
    });

    it('defaults healthPort to 8080 when not in id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { status: 'completed', exitCode: 0 } }),
        text: async () => '',
      } as any);

      const result = await adapter.getStatus('host:container:job123');
      expect(result.endpointUrl).toBe('http://host:8080');
    });
  });

  describe('destroy', () => {
    const deploymentId = '192.168.1.100:naap-test:job-456:8080:/health';

    it('sends docker stop and rm commands', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
      } as any);

      await adapter.destroy(deploymentId);

      expect(mockFetch).toHaveBeenCalledWith(
        `${SSH_BRIDGE_URL}/exec`,
        expect.objectContaining({ method: 'POST' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.host).toBe('192.168.1.100');
      expect(body.command).toContain('docker stop naap-test');
      expect(body.command).toContain('docker rm naap-test');
      expect(body.username).toBe('deploy');
    });

    it('does not throw on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
      } as any);

      await expect(adapter.destroy(deploymentId)).resolves.toBeUndefined();
    });

    it('throws on non-404 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'Connection lost',
      } as any);

      await expect(adapter.destroy(deploymentId)).rejects.toThrow('SSH destroy failed: Connection lost');
    });
  });

  describe('update', () => {
    const deploymentId = '192.168.1.100:naap-test:job-456:8080:/health';

    it('pulls new image and restarts container', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { jobId: 'job-789' } }),
        text: async () => '',
      } as any);

      const updateConfig: UpdateConfig = { dockerImage: 'my-org/new-image:v2' };
      const result = await adapter.update(deploymentId, updateConfig);

      expect(result.providerDeploymentId).toBe('192.168.1.100:naap-test:job-789:8080:/health');
      expect(result.endpointUrl).toBe('http://192.168.1.100:8080');
      expect(result.status).toBe('UPDATING');

      expect(mockFetch).toHaveBeenCalledWith(
        `${SSH_BRIDGE_URL}/exec/script`,
        expect.objectContaining({ method: 'POST' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.host).toBe('192.168.1.100');
      expect(body.script).toContain('docker pull my-org/new-image:v2');
      expect(body.script).toContain('docker stop naap-test');
      expect(body.script).toContain('docker rm naap-test');
      expect(body.script).toContain('docker run -d --name naap-test');
      expect(body.script).toContain('my-org/new-image:v2');
    });

    it('throws when dockerImage is not provided', async () => {
      await expect(adapter.update(deploymentId, {})).rejects.toThrow('dockerImage is required for SSH Bridge updates');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'Script failed',
      } as any);

      await expect(
        adapter.update(deploymentId, { dockerImage: 'img:v2' }),
      ).rejects.toThrow('SSH update failed: Script failed');
    });

    it('defaults healthPort and healthEndpoint when absent in id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { jobId: 'job-new' } }),
        text: async () => '',
      } as any);

      const shortId = 'host:container:old-job';
      const result = await adapter.update(shortId, { dockerImage: 'img:v2' });
      expect(result.providerDeploymentId).toBe('host:container:job-new:8080:/health');
    });
  });

  describe('healthCheck', () => {
    const deploymentId = '192.168.1.100:naap-test:job-456:8080:/health';
    const endpointUrl = 'http://192.168.1.100:8080';

    it('returns GREEN for HTTP 200', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { exitCode: 0, stdout: '200' } }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck(deploymentId, endpointUrl);
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('GREEN');
      expect(result.statusCode).toBe(200);
    });

    it('returns RED when no endpointUrl is provided', async () => {
      const result = await adapter.healthCheck(deploymentId);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns RED when curl returns non-2xx status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { exitCode: 0, stdout: '503' } }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck(deploymentId, endpointUrl);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
      expect(result.statusCode).toBe(503);
    });

    it('returns RED when curl exits with non-zero code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { exitCode: 7, stdout: '' } }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck(deploymentId, endpointUrl);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
    });

    it('returns RED when exec fetch is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck(deploymentId, endpointUrl);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
    });

    it('returns RED when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await adapter.healthCheck(deploymentId, endpointUrl);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
    });

    it('sends curl command to correct host and port', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { exitCode: 0, stdout: '200' } }),
        text: async () => '',
      } as any);

      await adapter.healthCheck(deploymentId, endpointUrl);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.host).toBe('192.168.1.100');
      expect(body.command).toContain('http://localhost:8080/health');
      expect(body.timeout).toBe(15000);
    });

    it('uses top-level exitCode/stdout when data is absent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ exitCode: 0, stdout: '200' }),
        text: async () => '',
      } as any);

      const result = await adapter.healthCheck(deploymentId, endpointUrl);
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('GREEN');
    });

    it('uses healthEndpoint from deployment id', async () => {
      const customId = '10.0.0.1:container:job:9090:/api/status';
      const customUrl = 'http://10.0.0.1:9090';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { exitCode: 0, stdout: '200' } }),
        text: async () => '',
      } as any);

      await adapter.healthCheck(customId, customUrl);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.command).toContain('http://localhost:9090/api/status');
    });
  });
});
