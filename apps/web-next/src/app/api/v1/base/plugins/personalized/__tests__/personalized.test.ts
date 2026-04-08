import { describe, it, expect } from 'vitest';

/**
 * Unit tests for the personalized plugins API filtering logic.
 *
 * These test the publish-gate and visibility-gate filters that determine
 * which plugins appear in the sidebar / personalized list.
 */

const normalizePluginName = (name: string) =>
  name.toLowerCase().replace(/[-_]/g, '');

interface MockPlugin {
  name: string;
  enabled: boolean;
  routes: string[];
  order: number;
}

interface MockPublishedPackage {
  name: string;
  isCore: boolean;
  visibleToUsers: boolean;
  previewTesterUserIds?: string[];
}

function applyFilters(
  globalPlugins: MockPlugin[],
  publishedPackages: MockPublishedPackage[],
  isAdmin: boolean,
  previewViewerUserId: string | null = null
): MockPlugin[] {
  const publishedNames = new Set(
    publishedPackages.map((p) => normalizePluginName(p.name))
  );
  const hiddenNames = new Set(
    publishedPackages
      .filter((p) => !p.visibleToUsers)
      .map((p) => normalizePluginName(p.name))
  );
  const pkgByNorm = new Map(
    publishedPackages.map((p) => [normalizePluginName(p.name), p])
  );

  return globalPlugins.filter((p) => {
    const normalized = normalizePluginName(p.name);
    if (!publishedNames.has(normalized)) return false;
    if (isAdmin) return true;
    if (!hiddenNames.has(normalized)) return true;
    const pkg = pkgByNorm.get(normalized);
    if (
      previewViewerUserId &&
      pkg?.previewTesterUserIds?.includes(previewViewerUserId)
    ) {
      return true;
    }
    return false;
  });
}

function extractHeadlessPlugins(
  globalPlugins: MockPlugin[],
  publishedPackages: MockPublishedPackage[]
): MockPlugin[] {
  const publishedNames = new Set(
    publishedPackages.map((p) => normalizePluginName(p.name))
  );
  return globalPlugins.filter((p) => {
    if (!publishedNames.has(normalizePluginName(p.name))) return false;
    return !p.routes || p.routes.length === 0;
  });
}

const makePlugin = (name: string, enabled = true): MockPlugin => ({
  name,
  enabled,
  routes: [`/plugins/${name}/*`],
  order: 0,
});

const makeHeadlessPlugin = (name: string): MockPlugin => ({
  name,
  enabled: true,
  routes: [],
  order: 0,
});

const makePackage = (
  name: string,
  opts: Partial<Omit<MockPublishedPackage, 'name'>> = {}
): MockPublishedPackage => ({
  name,
  isCore: opts.isCore ?? false,
  visibleToUsers: opts.visibleToUsers ?? true,
  previewTesterUserIds: opts.previewTesterUserIds ?? [],
});

describe('Personalized API: publish-gate', () => {
  it('excludes plugin with no published PluginPackage', () => {
    const globalPlugins = [makePlugin('leaky-plugin'), makePlugin('valid-plugin')];
    const publishedPackages = [makePackage('valid-plugin')];

    const result = applyFilters(globalPlugins, publishedPackages, false);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('valid-plugin');
  });

  it('includes plugin that has a published PluginPackage', () => {
    const globalPlugins = [makePlugin('my-plugin')];
    const publishedPackages = [makePackage('my-plugin')];

    const result = applyFilters(globalPlugins, publishedPackages, false);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('my-plugin');
  });

  it('handles name normalization (hyphens vs underscores)', () => {
    const globalPlugins = [makePlugin('my-plugin')];
    const publishedPackages = [makePackage('my_plugin')];

    const result = applyFilters(globalPlugins, publishedPackages, false);

    expect(result).toHaveLength(1);
  });

  it('publish-gate applies to admins too (unpublished = unfinished)', () => {
    const globalPlugins = [makePlugin('draft-plugin')];
    const publishedPackages: MockPublishedPackage[] = [];

    const result = applyFilters(globalPlugins, publishedPackages, true);

    expect(result).toHaveLength(0);
  });
});

describe('Personalized API: visibility-gate', () => {
  it('excludes hidden plugin for non-admin user', () => {
    const globalPlugins = [makePlugin('secret-plugin'), makePlugin('public-plugin')];
    const publishedPackages = [
      makePackage('secret-plugin', { visibleToUsers: false }),
      makePackage('public-plugin', { visibleToUsers: true }),
    ];

    const result = applyFilters(globalPlugins, publishedPackages, false);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('public-plugin');
  });

  it('includes hidden plugin for admin user', () => {
    const globalPlugins = [makePlugin('secret-plugin'), makePlugin('public-plugin')];
    const publishedPackages = [
      makePackage('secret-plugin', { visibleToUsers: false }),
      makePackage('public-plugin', { visibleToUsers: true }),
    ];

    const result = applyFilters(globalPlugins, publishedPackages, true);

    expect(result).toHaveLength(2);
  });

  it('excludes hidden non-headless plugins for non-admin', () => {
    const globalPlugins = [makePlugin('secret-ui')];
    const publishedPackages = [
      makePackage('secret-ui', { visibleToUsers: false }),
    ];

    const resultNonAdmin = applyFilters(globalPlugins, publishedPackages, false);
    expect(resultNonAdmin).toHaveLength(0);

    const resultAdmin = applyFilters(globalPlugins, publishedPackages, true);
    expect(resultAdmin).toHaveLength(1);
  });

  it('headless plugins bypass visibility gate (always load)', () => {
    const globalPlugins = [makeHeadlessPlugin('bg-provider')];
    const publishedPackages = [
      makePackage('bg-provider', { visibleToUsers: false }),
    ];

    const headless = extractHeadlessPlugins(globalPlugins, publishedPackages);
    expect(headless).toHaveLength(1);
    expect(headless[0].name).toBe('bg-provider');
  });
});


describe('Personalized API: preview tester allowlist', () => {
  it('shows hidden plugin to allowlisted user', () => {
    const globalPlugins = [makePlugin('my-wallet'), makePlugin('public-plugin')];
    const publishedPackages = [
      makePackage('my-wallet', {
        visibleToUsers: false,
        previewTesterUserIds: ['user-preview-1'],
      }),
      makePackage('public-plugin'),
    ];

    const result = applyFilters(
      globalPlugins,
      publishedPackages,
      false,
      'user-preview-1'
    );

    expect(result.map((p) => p.name).sort()).toEqual(['my-wallet', 'public-plugin']);
  });

  it('hides hidden plugin from non-allowlisted user', () => {
    const globalPlugins = [makePlugin('my-wallet')];
    const publishedPackages = [
      makePackage('my-wallet', {
        visibleToUsers: false,
        previewTesterUserIds: ['user-preview-1'],
      }),
    ];

    const result = applyFilters(globalPlugins, publishedPackages, false, 'other-user');
    expect(result).toHaveLength(0);
  });

  it('hides hidden plugin with empty allowlist for non-admin', () => {
    const globalPlugins = [makePlugin('secret')];
    const publishedPackages = [
      makePackage('secret', { visibleToUsers: false, previewTesterUserIds: [] }),
    ];

    const result = applyFilters(globalPlugins, publishedPackages, false, 'any-user');
    expect(result).toHaveLength(0);
  });
});

describe('Personalized API: admin privilege escalation prevention', () => {
  /**
   * Simulates the route logic: isAdmin should only be elevated from DB roles
   * when the authenticated user matches the looked-up user.
   */
  function resolveAdminStatus(
    authenticatedUserId: string | null,
    lookedUpUserId: string,
    isAdminFromToken: boolean,
    userHasAdminRole: boolean
  ): boolean {
    if (isAdminFromToken) return true;
    if (authenticatedUserId && authenticatedUserId === lookedUpUserId && userHasAdminRole) {
      return true;
    }
    return false;
  }

  it('does NOT elevate to admin when userId param differs from authenticated user', () => {
    const result = resolveAdminStatus('regular-user-id', 'admin-user-id', false, true);
    expect(result).toBe(false);
  });

  it('does NOT elevate to admin when no auth token present', () => {
    const result = resolveAdminStatus(null, 'admin-user-id', false, true);
    expect(result).toBe(false);
  });

  it('elevates to admin when authenticated user matches looked-up user with admin role', () => {
    const result = resolveAdminStatus('admin-user-id', 'admin-user-id', false, true);
    expect(result).toBe(true);
  });

  it('preserves admin from token regardless of userId mismatch', () => {
    const result = resolveAdminStatus('admin-user-id', 'other-user-id', true, false);
    expect(result).toBe(true);
  });
});

describe('Personalized API: combined gates', () => {
  it('both gates must pass for a plugin to be visible (non-admin)', () => {
    const globalPlugins = [
      makePlugin('published-visible'),
      makePlugin('published-hidden'),
      makePlugin('unpublished-visible'),
    ];
    const publishedPackages = [
      makePackage('published-visible', { visibleToUsers: true }),
      makePackage('published-hidden', { visibleToUsers: false }),
    ];

    const result = applyFilters(globalPlugins, publishedPackages, false);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('published-visible');
  });

  it('admin sees published plugins regardless of visibility', () => {
    const globalPlugins = [
      makePlugin('published-visible'),
      makePlugin('published-hidden'),
      makePlugin('unpublished'),
    ];
    const publishedPackages = [
      makePackage('published-visible', { visibleToUsers: true }),
      makePackage('published-hidden', { visibleToUsers: false }),
    ];

    const result = applyFilters(globalPlugins, publishedPackages, true);

    expect(result).toHaveLength(2);
    expect(result.map((p) => p.name)).toEqual(['published-visible', 'published-hidden']);
  });
});
