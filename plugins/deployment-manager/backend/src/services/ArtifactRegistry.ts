import { GithubReleasesAdapter, type ReleaseInfo } from '../adapters/GithubReleasesAdapter.js';

export interface ArtifactDefinition {
  type: 'ai-runner' | 'scope';
  displayName: string;
  description: string;
  dockerImage: string;
  githubOwner: string;
  githubRepo: string;
  healthEndpoint: string;
  defaultPort: number;
}

export interface ArtifactVersion {
  version: string;
  publishedAt: string;
  prerelease: boolean;
  releaseUrl: string;
  dockerImage: string;
}

const ARTIFACTS: ArtifactDefinition[] = [
  {
    type: 'ai-runner',
    displayName: 'AI Runner',
    description: 'Livepeer inference runtime for batch and real-time AI pipelines. Supports text-to-image, image-to-image, image-to-video, and more.',
    dockerImage: 'livepeer/ai-runner',
    githubOwner: 'livepeer',
    githubRepo: 'ai-runner',
    healthEndpoint: '/health',
    defaultPort: 8080,
  },
  {
    type: 'scope',
    displayName: 'Daydream Scope',
    description: 'Real-time interactive generative AI pipeline tool. Supports autoregressive video diffusion with WebRTC streaming.',
    dockerImage: 'daydreamlive/scope',
    githubOwner: 'daydreamlive',
    githubRepo: 'scope',
    healthEndpoint: '/health',
    defaultPort: 8188,
  },
];

export class ArtifactRegistry {
  private github = new GithubReleasesAdapter();
  private versionCache = new Map<string, { versions: ArtifactVersion[]; cachedAt: number }>();
  private readonly cacheTtlMs = 300_000; // 5 min

  getArtifacts(): ArtifactDefinition[] {
    return ARTIFACTS;
  }

  getArtifact(type: string): ArtifactDefinition | undefined {
    return ARTIFACTS.find((a) => a.type === type);
  }

  async getVersions(type: string): Promise<ArtifactVersion[]> {
    const artifact = this.getArtifact(type);
    if (!artifact) throw new Error(`Unknown artifact type: ${type}`);

    const cached = this.versionCache.get(type);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.versions;
    }

    const releases = await this.github.listReleases(artifact.githubOwner, artifact.githubRepo, 20);
    const versions = releases
      .filter((r) => !r.draft)
      .map((r) => ({
        version: r.tagName,
        publishedAt: r.publishedAt,
        prerelease: r.prerelease,
        releaseUrl: r.htmlUrl,
        dockerImage: `${artifact.dockerImage}:${r.tagName}`,
      }));

    this.versionCache.set(type, { versions, cachedAt: Date.now() });
    return versions;
  }

  async getLatestVersion(type: string): Promise<ArtifactVersion | null> {
    const artifact = this.getArtifact(type);
    if (!artifact) return null;

    const release = await this.github.getLatestRelease(artifact.githubOwner, artifact.githubRepo);
    if (!release) return null;

    return {
      version: release.tagName,
      publishedAt: release.publishedAt,
      prerelease: release.prerelease,
      releaseUrl: release.htmlUrl,
      dockerImage: `${artifact.dockerImage}:${release.tagName}`,
    };
  }

  buildDockerImage(type: string, version: string): string {
    const artifact = this.getArtifact(type);
    if (!artifact) throw new Error(`Unknown artifact type: ${type}`);
    return `${artifact.dockerImage}:${version}`;
  }
}
