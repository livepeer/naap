const GATEWAY_BASE = process.env.SHELL_URL || 'http://localhost:3000';

export interface ReleaseInfo {
  tagName: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
  draft: boolean;
  htmlUrl: string;
  assets: { name: string; downloadUrl: string; size: number }[];
}

async function gwFetch(path: string): Promise<Response> {
  const url = `${GATEWAY_BASE}/api/v1/gw/github-releases${path}`;
  return fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
  });
}

export class GithubReleasesAdapter {
  async getLatestRelease(owner: string, repo: string): Promise<ReleaseInfo | null> {
    try {
      const res = await gwFetch(`/repos/${owner}/${repo}/releases/latest`);
      if (!res.ok) return null;
      const data = await res.json();
      return this.mapRelease(data);
    } catch {
      return null;
    }
  }

  async listReleases(owner: string, repo: string, limit = 10): Promise<ReleaseInfo[]> {
    try {
      const res = await gwFetch(`/repos/${owner}/${repo}/releases?per_page=${limit}`);
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      return data.map((r: any) => this.mapRelease(r));
    } catch {
      return [];
    }
  }

  async getReleaseByTag(owner: string, repo: string, tag: string): Promise<ReleaseInfo | null> {
    try {
      const res = await gwFetch(`/repos/${owner}/${repo}/releases/tags/${tag}`);
      if (!res.ok) return null;
      const data = await res.json();
      return this.mapRelease(data);
    } catch {
      return null;
    }
  }

  private mapRelease(data: any): ReleaseInfo {
    return {
      tagName: data.tag_name,
      name: data.name || data.tag_name,
      publishedAt: data.published_at,
      prerelease: data.prerelease || false,
      draft: data.draft || false,
      htmlUrl: data.html_url,
      assets: (data.assets || []).map((a: any) => ({
        name: a.name,
        downloadUrl: a.browser_download_url,
        size: a.size,
      })),
    };
  }
}
