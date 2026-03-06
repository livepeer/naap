import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GithubReleasesAdapter } from '../adapters/GithubReleasesAdapter.js';

const mockRelease = (overrides: Record<string, unknown> = {}) => ({
  tag_name: 'v1.0.0',
  name: 'Release v1.0.0',
  published_at: '2025-01-15T00:00:00Z',
  prerelease: false,
  draft: false,
  html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
  assets: [
    {
      name: 'artifact.tar.gz',
      browser_download_url: 'https://github.com/owner/repo/releases/download/v1.0.0/artifact.tar.gz',
      size: 1024,
    },
  ],
  ...overrides,
});

describe('GithubReleasesAdapter', () => {
  let adapter: GithubReleasesAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new GithubReleasesAdapter();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getLatestRelease', () => {
    it('should return mapped release on success', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRelease(),
      });

      const result = await adapter.getLatestRelease('owner', 'repo');

      expect(result).not.toBeNull();
      expect(result!.tagName).toBe('v1.0.0');
      expect(result!.name).toBe('Release v1.0.0');
      expect(result!.publishedAt).toBe('2025-01-15T00:00:00Z');
      expect(result!.prerelease).toBe(false);
      expect(result!.draft).toBe(false);
      expect(result!.htmlUrl).toBe('https://github.com/owner/repo/releases/tag/v1.0.0');
      expect(result!.assets).toHaveLength(1);
      expect(result!.assets[0].name).toBe('artifact.tar.gz');
    });

    it('should return null on 404', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await adapter.getLatestRelease('owner', 'repo');
      expect(result).toBeNull();
    });

    it('should return null on fetch failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await adapter.getLatestRelease('owner', 'repo');
      expect(result).toBeNull();
    });
  });

  describe('listReleases', () => {
    it('should return array of mapped releases', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          mockRelease({ tag_name: 'v1.0.0' }),
          mockRelease({ tag_name: 'v0.9.0' }),
        ],
      });

      const results = await adapter.listReleases('owner', 'repo', 10);
      expect(results).toHaveLength(2);
      expect(results[0].tagName).toBe('v1.0.0');
      expect(results[1].tagName).toBe('v0.9.0');
    });

    it('should include draft releases in raw output (filtering is done by caller)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          mockRelease({ tag_name: 'v1.0.0', draft: false }),
          mockRelease({ tag_name: 'v0.9.0-draft', draft: true }),
        ],
      });

      const results = await adapter.listReleases('owner', 'repo');
      expect(results).toHaveLength(2);
      expect(results[1].draft).toBe(true);
    });

    it('should return empty array on fetch failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const results = await adapter.listReleases('owner', 'repo');
      expect(results).toEqual([]);
    });

    it('should return empty array on non-ok response', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

      const results = await adapter.listReleases('owner', 'repo');
      expect(results).toEqual([]);
    });

    it('should return empty array when response is not an array', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Not Found' }),
      });

      const results = await adapter.listReleases('owner', 'repo');
      expect(results).toEqual([]);
    });
  });

  describe('getReleaseByTag', () => {
    it('should return release for valid tag', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRelease({ tag_name: 'v2.0.0' }),
      });

      const result = await adapter.getReleaseByTag('owner', 'repo', 'v2.0.0');
      expect(result).not.toBeNull();
      expect(result!.tagName).toBe('v2.0.0');
    });

    it('should return null on 404', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await adapter.getReleaseByTag('owner', 'repo', 'v999');
      expect(result).toBeNull();
    });

    it('should return null on fetch failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await adapter.getReleaseByTag('owner', 'repo', 'v1.0.0');
      expect(result).toBeNull();
    });
  });

  describe('URL construction', () => {
    it('should call the correct URL for getLatestRelease', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false });

      await adapter.getLatestRelease('livepeer', 'ai-runner');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/livepeer/ai-runner/releases/latest',
        expect.any(Object),
      );
    });

    it('should call the correct URL for listReleases', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false });

      await adapter.listReleases('org', 'project', 5);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/org/project/releases?per_page=5',
        expect.any(Object),
      );
    });

    it('should call the correct URL for getReleaseByTag', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false });

      await adapter.getReleaseByTag('owner', 'repo', 'v3.0.0');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/releases/tags/v3.0.0',
        expect.any(Object),
      );
    });
  });
});
