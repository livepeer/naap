import { GithubReleasesAdapter } from '../adapters/GithubReleasesAdapter.js';
import type { DeploymentTemplate } from '../types/index.js';

export interface TemplateVersion {
  version: string;
  publishedAt: string;
  prerelease: boolean;
  releaseUrl: string;
  dockerImage: string;
}

const BUILT_IN_TEMPLATES: DeploymentTemplate[] = [
  {
    id: 'ai-runner',
    name: 'AI Runner',
    description: 'Livepeer inference runtime for batch and real-time AI pipelines. Supports text-to-image, image-to-image, image-to-video, and more.',
    icon: '🤖',
    dockerImage: 'livepeer/ai-runner',
    healthEndpoint: '/health',
    healthPort: 8080,
    defaultGpuModel: 'A100',
    defaultGpuVramGb: 80,
    category: 'curated',
    githubOwner: 'livepeer',
    githubRepo: 'ai-runner',
  },
  {
    id: 'scope',
    name: 'Daydream Scope',
    description: 'Real-time interactive generative AI pipeline tool. Supports autoregressive video diffusion with WebRTC streaming.',
    icon: '🔮',
    dockerImage: 'daydreamlive/scope',
    healthEndpoint: '/health',
    healthPort: 8188,
    defaultGpuModel: 'A100',
    defaultGpuVramGb: 80,
    category: 'curated',
    githubOwner: 'daydreamlive',
    githubRepo: 'scope',
  },
];

export class TemplateRegistry {
  private github = new GithubReleasesAdapter();
  private versionCache = new Map<string, { versions: TemplateVersion[]; cachedAt: number }>();
  private customTemplates = new Map<string, DeploymentTemplate>();
  private readonly cacheTtlMs = 300_000; // 5 min

  getTemplates(): DeploymentTemplate[] {
    return [...BUILT_IN_TEMPLATES, ...this.customTemplates.values()];
  }

  getTemplate(id: string): DeploymentTemplate | undefined {
    return BUILT_IN_TEMPLATES.find((t) => t.id === id) ?? this.customTemplates.get(id);
  }

  addCustomTemplate(template: Omit<DeploymentTemplate, 'category'>): DeploymentTemplate {
    const full: DeploymentTemplate = { ...template, category: 'custom' };
    this.customTemplates.set(template.id, full);
    return full;
  }

  removeCustomTemplate(id: string): boolean {
    return this.customTemplates.delete(id);
  }

  async getVersions(templateId: string): Promise<TemplateVersion[]> {
    const template = this.getTemplate(templateId);
    if (!template) throw new Error(`Unknown template: ${templateId}`);
    if (!template.githubOwner || !template.githubRepo) {
      return template.defaultVersion
        ? [{ version: template.defaultVersion, publishedAt: '', prerelease: false, releaseUrl: '', dockerImage: `${template.dockerImage}:${template.defaultVersion}` }]
        : [];
    }

    const cached = this.versionCache.get(templateId);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.versions;
    }

    const releases = await this.github.listReleases(template.githubOwner, template.githubRepo, 20);
    const versions: TemplateVersion[] = releases
      .filter((r) => !r.draft)
      .map((r) => ({
        version: r.tagName,
        publishedAt: r.publishedAt,
        prerelease: r.prerelease,
        releaseUrl: r.htmlUrl,
        dockerImage: `${template.dockerImage}:${r.tagName}`,
      }));

    this.versionCache.set(templateId, { versions, cachedAt: Date.now() });
    return versions;
  }

  async getLatestVersion(templateId: string): Promise<TemplateVersion | null> {
    const template = this.getTemplate(templateId);
    if (!template) return null;
    if (!template.githubOwner || !template.githubRepo) {
      return template.defaultVersion
        ? { version: template.defaultVersion, publishedAt: '', prerelease: false, releaseUrl: '', dockerImage: `${template.dockerImage}:${template.defaultVersion}` }
        : null;
    }

    const release = await this.github.getLatestRelease(template.githubOwner, template.githubRepo);
    if (!release) return null;

    return {
      version: release.tagName,
      publishedAt: release.publishedAt,
      prerelease: release.prerelease,
      releaseUrl: release.htmlUrl,
      dockerImage: `${template.dockerImage}:${release.tagName}`,
    };
  }

  buildDockerImage(templateId: string, version: string): string {
    const template = this.getTemplate(templateId);
    if (!template) throw new Error(`Unknown template: ${templateId}`);
    return `${template.dockerImage}:${version}`;
  }
}
