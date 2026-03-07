import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SshComposeAdapter } from '../adapters/SshComposeAdapter.js';
import type { DeployConfig, UpdateConfig } from '../types/index.js';

// Mock providerFetch
vi.mock('../lib/providerFetch.js', () => ({
  authenticatedProviderFetch: vi.fn(),
}));

import { authenticatedProviderFetch } from '../lib/providerFetch.js';

const mockFetch = authenticatedProviderFetch as ReturnType<typeof vi.fn>;

describe('SshComposeAdapter', () => {
  let adapter: SshComposeAdapter;

  beforeEach(() => {
    adapter = new SshComposeAdapter();
    vi.clearAllMocks();
  });

  describe('metadata', () => {
    it('has slug ssh-compose', () => {
      expect(adapter.slug).toBe('ssh-compose');
    });

    it('has mode ssh-bridge', () => {
      expect(adapter.mode).toBe('ssh-bridge');
    });
  });

  describe('getGpuOptions', () => {
    it('returns CPU option first', async () => {
      const options = await adapter.getGpuOptions();
      expect(options[0].id).toBe('CPU');
      expect(options[0].vramGb).toBe(0);
    });

    it('includes GPU options', async () => {
      const options = await adapter.getGpuOptions();
      expect(options.length).toBeGreaterThan(1);
      expect(options.some(o => o.id.includes('A100'))).toBe(true);
    });
  });

  describe('deploy', () => {
    const baseConfig: DeployConfig = {
      name: 'test-livepeer',
      providerSlug: 'ssh-compose',
      gpuModel: 'CPU',
      gpuVramGb: 0,
      gpuCount: 0,
      artifactType: 'livepeer-inference',
      artifactVersion: 'latest',
      dockerImage: 'livepeer/inference-adapter:latest',
      sshHost: '10.0.0.1',
      sshPort: 22,
      sshUsername: 'deploy',
      healthPort: 9090,
      healthEndpoint: '/health',
      artifactConfig: {
        composeYaml: 'version: "3.8"\nservices:\n  test:\n    image: test',
        composeProject: 'naap-livepeer-test',
      },
    };

    it('throws if SSH host is missing', async () => {
      const config = { ...baseConfig, sshHost: undefined };
      await expect(adapter.deploy(config)).rejects.toThrow('SSH host and username are required');
    });

    it('throws if composeYaml is missing', async () => {
      const config = { ...baseConfig, artifactConfig: {} };
      await expect(adapter.deploy(config)).rejects.toThrow('composeYaml is required');
    });

    it('connects via SSH then runs compose script', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, text: async () => '{}' }) // connect
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { jobId: 'job-123' } }),
        }); // exec/script

      const result = await adapter.deploy(baseConfig);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.providerDeploymentId).toContain('compose:');
      expect(result.providerDeploymentId).toContain('10.0.0.1');
      expect(result.providerDeploymentId).toContain('naap-livepeer-test');
      expect(result.status).toBe('DEPLOYING');
      expect(result.endpointUrl).toBe('http://10.0.0.1:9090');
    });

    it('deploy script writes compose file with restricted permissions', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, text: async () => '{}' })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { jobId: 'job-123' } }),
        });

      await adapter.deploy(baseConfig);

      const scriptCall = mockFetch.mock.calls[1];
      const body = JSON.parse(scriptCall[3]?.body || '{}');
      expect(body.script).toContain('chmod 700');
      expect(body.script).toContain('chmod 600');
      expect(body.script).toContain('docker compose');
    });

    it('throws on SSH connection failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, text: async () => 'Connection refused' });

      await expect(adapter.deploy(baseConfig)).rejects.toThrow('SSH connection failed');
    });
  });

  describe('destroy', () => {
    it('runs docker compose down via SSH', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await adapter.destroy('compose:10.0.0.1:naap-test:job-1:9090:/health');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][3]?.body || '{}');
      expect(body.script).toContain('docker compose -p naap-test');
      expect(body.script).toContain('down -v --remove-orphans');
      expect(body.script).toContain('rm -rf /opt/naap/naap-test');
    });
  });

  describe('getStatus', () => {
    it('returns ONLINE when job completed with exit 0', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: 'completed', exitCode: 0 } }),
      });

      const status = await adapter.getStatus('compose:10.0.0.1:proj:job-1:9090:/health');
      expect(status.status).toBe('ONLINE');
    });

    it('returns FAILED when job completed with non-zero exit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: 'completed', exitCode: 1 } }),
      });

      const status = await adapter.getStatus('compose:10.0.0.1:proj:job-1:9090:/health');
      expect(status.status).toBe('FAILED');
    });

    it('returns DEPLOYING when job is running', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { status: 'running' } }),
      });

      const status = await adapter.getStatus('compose:10.0.0.1:proj:job-1:9090:/health');
      expect(status.status).toBe('DEPLOYING');
    });
  });

  describe('update', () => {
    it('pulls and restarts compose services', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { jobId: 'job-2' } }),
      });

      const result = await adapter.update(
        'compose:10.0.0.1:proj:job-1:9090:/health',
        {} as UpdateConfig,
      );

      expect(result.status).toBe('UPDATING');
      const body = JSON.parse(mockFetch.mock.calls[0][3]?.body || '{}');
      expect(body.script).toContain('docker compose -p proj');
      expect(body.script).toContain('pull');
      expect(body.script).toContain('up -d');
    });
  });

  describe('healthCheck', () => {
    it('returns GREEN when curl succeeds with 200', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { exitCode: 0, stdout: '200' } }),
      });

      const result = await adapter.healthCheck(
        'compose:10.0.0.1:proj:job-1:9090:/health',
        'http://10.0.0.1:9090',
      );

      expect(result.healthy).toBe(true);
      expect(result.status).toBe('GREEN');
    });

    it('returns RED when curl fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { exitCode: 1, stdout: '' } }),
      });

      const result = await adapter.healthCheck(
        'compose:10.0.0.1:proj:job-1:9090:/health',
        'http://10.0.0.1:9090',
      );

      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
    });

    it('returns RED when no endpoint URL', async () => {
      const result = await adapter.healthCheck('compose:10.0.0.1:proj:job-1:9090:/health');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('RED');
    });
  });
});
