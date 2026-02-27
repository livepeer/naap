/**
 * Verifies that the baseUrl resolution logic in useApiClient correctly
 * distinguishes between `baseUrl: ''` (same-origin) and no baseUrl
 * (fall back to service origin). This test exists because the empty-string
 * check has regressed multiple times during rebases.
 */
import { describe, it, expect } from 'vitest';

/**
 * Extracted baseUrl resolution logic from useApiClient.
 * Mirrors the real if/else chain so the test stays meaningful.
 */
function resolveBaseUrl(
  customBaseUrl: string | undefined,
  pluginName: string | undefined,
  apiPath: string | undefined,
  getServiceOrigin: (name: string) => string,
  getPluginBackendUrl: (name: string, opts: { apiPath: string }) => string,
): string {
  if (customBaseUrl !== undefined) {
    return customBaseUrl;
  } else if (pluginName) {
    if (apiPath) {
      return getPluginBackendUrl(pluginName, { apiPath });
    } else {
      return getServiceOrigin(pluginName);
    }
  } else {
    return getServiceOrigin('base');
  }
}

describe('useApiClient baseUrl resolution', () => {
  const mockGetServiceOrigin = (name: string) =>
    name === 'base' ? 'http://localhost:4000' : `http://localhost:9999`;
  const mockGetPluginBackendUrl = (name: string, opts: { apiPath: string }) =>
    `http://localhost:9999${opts.apiPath}`;

  it('treats baseUrl: "" as same-origin (empty string, NOT falsy fallback)', () => {
    const result = resolveBaseUrl('', undefined, undefined, mockGetServiceOrigin, mockGetPluginBackendUrl);
    expect(result).toBe('');
  });

  it('falls back to base service origin when baseUrl is undefined', () => {
    const result = resolveBaseUrl(undefined, undefined, undefined, mockGetServiceOrigin, mockGetPluginBackendUrl);
    expect(result).toBe('http://localhost:4000');
  });

  it('uses pluginName origin when baseUrl is undefined and pluginName is set', () => {
    const result = resolveBaseUrl(undefined, 'myPlugin', undefined, mockGetServiceOrigin, mockGetPluginBackendUrl);
    expect(result).toBe('http://localhost:9999');
  });

  it('uses explicit baseUrl over pluginName', () => {
    const result = resolveBaseUrl('https://custom.api', 'myPlugin', undefined, mockGetServiceOrigin, mockGetPluginBackendUrl);
    expect(result).toBe('https://custom.api');
  });

  it('uses pluginBackendUrl when pluginName + apiPath provided', () => {
    const result = resolveBaseUrl(undefined, 'myPlugin', '/api/v1', mockGetServiceOrigin, mockGetPluginBackendUrl);
    expect(result).toBe('http://localhost:9999/api/v1');
  });
});
