import { describe, it, expect, beforeEach } from 'vitest';
import { TemplateRegistry } from '../services/TemplateRegistry.js';
import type { TemplateVersion } from '../services/TemplateRegistry.js';
import type { ReleaseInfo } from '../adapters/GithubReleasesAdapter.js';

const makeMockGithub = () => ({
  getLatestRelease: async (_owner: string, _repo: string): Promise<ReleaseInfo | null> => ({
    tagName: 'v1.0.0',
    name: 'v1.0.0',
    publishedAt: '2025-01-01T00:00:00Z',
    prerelease: false,
    draft: false,
    htmlUrl: 'https://github.com/owner/repo/releases/tag/v1.0.0',
    assets: [],
  }),
  listReleases: async (_owner: string, _repo: string, _limit?: number): Promise<ReleaseInfo[]> => [
    {
      tagName: 'v1.0.0',
      name: 'v1.0.0',
      publishedAt: '2025-01-01T00:00:00Z',
      prerelease: false,
      draft: false,
      htmlUrl: 'https://github.com/owner/repo/releases/tag/v1.0.0',
      assets: [],
    },
    {
      tagName: 'v0.9.0',
      name: 'v0.9.0',
      publishedAt: '2024-12-01T00:00:00Z',
      prerelease: false,
      draft: false,
      htmlUrl: 'https://github.com/owner/repo/releases/tag/v0.9.0',
      assets: [],
    },
  ],
  getReleaseByTag: async (_owner: string, _repo: string, _tag: string): Promise<ReleaseInfo | null> => null,
});

describe('TemplateRegistry', () => {
  let registry: TemplateRegistry;

  beforeEach(() => {
    registry = new TemplateRegistry();
    (registry as any).github = makeMockGithub();
  });

  it('should list 3 built-in templates', () => {
    const templates = registry.getTemplates();
    expect(templates).toHaveLength(3);
    const ids = templates.map((t) => t.id);
    expect(ids).toContain('ai-runner');
    expect(ids).toContain('scope');
    expect(ids).toContain('livepeer-inference');
  });

  it('should get template by known id', () => {
    const aiRunner = registry.getTemplate('ai-runner');
    expect(aiRunner).toBeDefined();
    expect(aiRunner!.dockerImage).toBe('livepeer/ai-runner');
    expect(aiRunner!.healthPort).toBe(8080);

    const scope = registry.getTemplate('scope');
    expect(scope).toBeDefined();
    expect(scope!.dockerImage).toBe('daydreamlive/scope');
    expect(scope!.healthPort).toBe(8188);
  });

  it('should return undefined for unknown template id', () => {
    const result = registry.getTemplate('nonexistent');
    expect(result).toBeUndefined();
  });

  it('should add custom template with category=custom', () => {
    const custom = registry.addCustomTemplate({
      id: 'my-custom',
      name: 'My Custom',
      description: 'A custom template',
      icon: '🎯',
      dockerImage: 'myorg/myimage',
      healthEndpoint: '/healthz',
      healthPort: 3000,
    });
    expect(custom.category).toBe('custom');
    expect(custom.id).toBe('my-custom');

    const templates = registry.getTemplates();
    expect(templates).toHaveLength(4);
    expect(registry.getTemplate('my-custom')).toBeDefined();
  });

  it('should remove custom template and return true, then false on second remove', () => {
    registry.addCustomTemplate({
      id: 'removable',
      name: 'Removable',
      description: 'Will be removed',
      icon: '🗑',
      dockerImage: 'org/removable',
      healthEndpoint: '/health',
      healthPort: 8080,
    });
    expect(registry.removeCustomTemplate('removable')).toBe(true);
    expect(registry.removeCustomTemplate('removable')).toBe(false);
    expect(registry.getTemplate('removable')).toBeUndefined();
  });

  it('should format docker image correctly with buildDockerImage', () => {
    const image = registry.buildDockerImage('ai-runner', 'v0.14.1');
    expect(image).toBe('livepeer/ai-runner:v0.14.1');
  });

  it('should throw for buildDockerImage with unknown template', () => {
    expect(() => registry.buildDockerImage('unknown', 'v1')).toThrow('Unknown template: unknown');
  });

  it('should return versions from github via getVersions', async () => {
    const versions = await registry.getVersions('ai-runner');
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe('v1.0.0');
    expect(versions[0].dockerImage).toBe('livepeer/ai-runner:v1.0.0');
    expect(versions[1].version).toBe('v0.9.0');
  });

  it('should return latest version from github via getLatestVersion', async () => {
    const latest = await registry.getLatestVersion('ai-runner');
    expect(latest).not.toBeNull();
    expect(latest!.version).toBe('v1.0.0');
    expect(latest!.dockerImage).toBe('livepeer/ai-runner:v1.0.0');
  });

  it('should return null from getLatestVersion for unknown template', async () => {
    const latest = await registry.getLatestVersion('nonexistent');
    expect(latest).toBeNull();
  });

  it('should throw from getVersions for unknown template', async () => {
    await expect(registry.getVersions('nonexistent')).rejects.toThrow('Unknown template: nonexistent');
  });

  it('should return null from getLatestVersion when github returns null', async () => {
    (registry as any).github = {
      ...makeMockGithub(),
      getLatestRelease: async () => null,
    };
    const latest = await registry.getLatestVersion('ai-runner');
    expect(latest).toBeNull();
  });
});
