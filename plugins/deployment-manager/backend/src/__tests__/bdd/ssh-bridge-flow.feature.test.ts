import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SshBridgeAdapter } from '../../adapters/SshBridgeAdapter.js';
import type { DeployConfig } from '../../types/index.js';

function mockFetchResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const sshBaseConfig: DeployConfig = {
  name: 'ssh-test',
  providerSlug: 'ssh-bridge',
  gpuModel: 'A100',
  gpuVramGb: 80,
  gpuCount: 1,
  artifactType: 'ai-runner',
  artifactVersion: 'v1.0.0',
  dockerImage: 'livepeer/ai-runner:v1.0.0',
  sshHost: '10.0.0.1',
  sshPort: 22,
  sshUsername: 'deploy',
  healthPort: 8080,
  healthEndpoint: '/health',
};

describe('Feature: SSH Bridge End-to-End', () => {
  let adapter: SshBridgeAdapter;
  let fetchSpy: any;

  beforeEach(() => {
    adapter = new SshBridgeAdapter();
    fetchSpy = vi.spyOn(globalThis, 'fetch') as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Given valid SSH credentials, When deploy is called, Then it connects via SSH, submits the deploy script, and returns a DEPLOYING result with the job ID', async () => {
    // Given
    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse({ status: 'connected' }, 200))
      .mockResolvedValueOnce(mockFetchResponse({ data: { jobId: 'job-abc-123' } }, 200));

    // When
    const result = await adapter.deploy(sshBaseConfig);

    // Then
    expect(result.status).toBe('DEPLOYING');
    expect(result.providerDeploymentId).toContain('10.0.0.1');
    expect(result.providerDeploymentId).toContain('job-abc-123');
    expect(result.endpointUrl).toBe('http://10.0.0.1:8080');
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.jobId).toBe('job-abc-123');
    expect(result.metadata!.sshHost).toBe('10.0.0.1');

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const connectCall = fetchSpy.mock.calls[0];
    expect(connectCall[0]).toContain('/connect');
    const connectBody = JSON.parse((connectCall[1] as RequestInit).body as string);
    expect(connectBody.host).toBe('10.0.0.1');
    expect(connectBody.username).toBe('deploy');

    const scriptCall = fetchSpy.mock.calls[1];
    expect(scriptCall[0]).toContain('/exec/script');
    const scriptBody = JSON.parse((scriptCall[1] as RequestInit).body as string);
    expect(scriptBody.script).toContain('docker pull livepeer/ai-runner:v1.0.0');
    expect(scriptBody.script).toContain('docker run -d');
  });

  it('Given a submitted SSH job, When getStatus is called and the job has completed with exitCode=0, Then status is ONLINE', async () => {
    // Given
    const providerDeploymentId = '10.0.0.1:naap-ai-runner-123:job-xyz:8080:/health';

    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        data: { status: 'completed', exitCode: 0, stdout: 'Healthy after 20s' },
      }),
    );

    // When
    const status = await adapter.getStatus(providerDeploymentId);

    // Then
    expect(status.status).toBe('ONLINE');
    expect(status.endpointUrl).toBe('http://10.0.0.1:8080');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain('/jobs/job-xyz');
  });

  it('Given missing SSH host or username, When deploy is called, Then it throws a validation error', async () => {
    // Given — config without sshHost
    const noHostConfig: DeployConfig = {
      ...sshBaseConfig,
      sshHost: undefined,
    };

    // When / Then
    await expect(adapter.deploy(noHostConfig)).rejects.toThrow(
      'SSH host and username are required for SSH Bridge deployments',
    );

    // Given — config without sshUsername
    const noUserConfig: DeployConfig = {
      ...sshBaseConfig,
      sshUsername: undefined,
    };

    await expect(adapter.deploy(noUserConfig)).rejects.toThrow(
      'SSH host and username are required for SSH Bridge deployments',
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
