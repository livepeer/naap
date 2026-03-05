import type { DeploymentOrchestrator } from './DeploymentOrchestrator.js';
import type { TemplateRegistry } from './TemplateRegistry.js';

export class VersionCheckerService {
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private orchestrator: DeploymentOrchestrator,
    private templateRegistry: TemplateRegistry,
    intervalMs?: number,
  ) {
    this.intervalMs = intervalMs ?? 1_800_000; // 30 min
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[version-checker] Started (interval=${this.intervalMs}ms)`);
    this.timer = setInterval(() => this.checkAll(), this.intervalMs);
    setTimeout(() => this.checkAll(), 10_000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[version-checker] Stopped');
  }

  async checkAll(): Promise<void> {
    const deployments = await this.orchestrator.list();
    const active = deployments.filter((d) => d.status === 'ONLINE');

    const latestVersions = new Map<string, string>();

    for (const deployment of active) {
      const { artifactType, artifactVersion } = deployment;

      if (!latestVersions.has(artifactType)) {
        const latest = await this.templateRegistry.getLatestVersion(artifactType);
        if (latest) {
          latestVersions.set(artifactType, latest.version);
        }
      }

      const latestVersion = latestVersions.get(artifactType);
      if (latestVersion && latestVersion !== artifactVersion) {
        deployment.latestAvailableVersion = latestVersion;
        deployment.hasUpdate = true;
        console.log(
          `[version-checker] Update available for ${deployment.name}: ${artifactVersion} -> ${latestVersion}`,
        );
      } else {
        deployment.hasUpdate = false;
        deployment.latestAvailableVersion = latestVersion || undefined;
      }
    }
  }

  async checkOne(deploymentId: string): Promise<{ hasUpdate: boolean; currentVersion: string; latestVersion?: string }> {
    const deployment = await this.orchestrator.get(deploymentId);
    if (!deployment) throw new Error(`Deployment not found: ${deploymentId}`);

    const latest = await this.templateRegistry.getLatestVersion(deployment.artifactType);
    if (latest && latest.version !== deployment.artifactVersion) {
      deployment.latestAvailableVersion = latest.version;
      deployment.hasUpdate = true;
      return {
        hasUpdate: true,
        currentVersion: deployment.artifactVersion,
        latestVersion: latest.version,
      };
    }

    deployment.hasUpdate = false;
    return {
      hasUpdate: false,
      currentVersion: deployment.artifactVersion,
      latestVersion: latest?.version,
    };
  }
}
