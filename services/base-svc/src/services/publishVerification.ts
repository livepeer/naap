/**
 * Publish Verification Service
 * 
 * Verifies that plugin resources are accessible before publishing:
 * - Route namespace enforcement (non-core plugins must use /plugins/{name})
 * - Frontend URL accessibility
 * - Docker image existence (if provided)
 * - Manifest validation
 */

import type { PluginManifest, DeepPartial } from '@naap/types';

export interface VerificationResult {
  valid: boolean;
  errors: VerificationError[];
  warnings: VerificationWarning[];
  checks: VerificationCheck[];
}

export interface VerificationError {
  code: string;
  message: string;
  field?: string;
}

export interface VerificationWarning {
  code: string;
  message: string;
  suggestion?: string;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  message: string;
  duration?: number;
}

export interface VerifyPublishOptions {
  manifest: DeepPartial<PluginManifest>;
  frontendUrl?: string;
  backendImage?: string;
  skipUrlCheck?: boolean;
  skipDockerCheck?: boolean;
  timeout?: number;
}

/**
 * Verify frontend URL is accessible
 */
export async function verifyUrlAccessible(
  url: string,
  timeout: number = 5000
): Promise<{ accessible: boolean; error?: string; responseTime?: number }> {
  const startTime = Date.now();

  try {
    // Require HTTPS to prevent insecure downloads
    if (!url.startsWith('https://')) {
      return { accessible: false, error: 'URL must use HTTPS' };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, { // lgtm[js/insecure-download] HTTPS enforced by check above
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    if (response.ok) {
      return { accessible: true, responseTime };
    }

    return {
      accessible: false,
      error: `HTTP ${response.status}: ${response.statusText}`,
      responseTime,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          accessible: false,
          error: `Request timed out after ${timeout}ms`,
          responseTime,
        };
      }
      return {
        accessible: false,
        error: error.message,
        responseTime,
      };
    }

    return {
      accessible: false,
      error: 'Unknown error',
      responseTime,
    };
  }
}

/**
 * Verify Docker image exists in registry
 * 
 * Supports:
 * - Docker Hub: image:tag or library/image:tag
 * - GitHub Container Registry: ghcr.io/owner/image:tag
 * - Other registries: registry.example.com/image:tag
 */
export async function verifyDockerImage(
  image: string,
  timeout: number = 10000
): Promise<{ exists: boolean; error?: string; size?: number }> {
  try {
    // Parse image reference
    let registry = 'registry-1.docker.io';
    let repository = image;
    let tag = 'latest';

    // Check for explicit registry
    if (image.includes('/') && (image.includes('.') || image.includes(':'))) {
      const parts = image.split('/');
      if (parts[0].includes('.')) {
        registry = parts[0];
        repository = parts.slice(1).join('/');
      }
    }

    // Extract tag
    if (repository.includes(':')) {
      const [repo, t] = repository.split(':');
      repository = repo;
      tag = t;
    }

    // For Docker Hub, add library prefix for official images
    if (registry === 'registry-1.docker.io' && !repository.includes('/')) {
      repository = `library/${repository}`;
    }

    // Check image using Docker Registry API v2
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Try to get the manifest
    const manifestUrl = registry === 'registry-1.docker.io'
      ? `https://hub.docker.com/v2/repositories/${repository}/tags/${tag}`
      : `https://${registry}/v2/${repository}/manifests/${tag}`;

    const response = await fetch(manifestUrl, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'Accept': 'application/vnd.docker.distribution.manifest.v2+json',
      },
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const contentLength = response.headers.get('content-length');
      return {
        exists: true,
        size: contentLength ? parseInt(contentLength, 10) : undefined,
      };
    }

    if (response.status === 404) {
      return {
        exists: false,
        error: `Image not found: ${image}`,
      };
    }

    if (response.status === 401) {
      // Private image or requires auth - we'll assume it exists
      // In production, we'd need proper auth handling
      return {
        exists: true, // Assume exists, installation will fail if not
      };
    }

    return {
      exists: false,
      error: `Registry returned ${response.status}`,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          exists: false,
          error: `Registry check timed out`,
        };
      }
      return {
        exists: false,
        error: error.message,
      };
    }
    return {
      exists: false,
      error: 'Unknown error',
    };
  }
}

/**
 * Validate manifest for publishing
 */
export function validatePublishManifest(manifest: DeepPartial<PluginManifest>): {
  valid: boolean;
  errors: VerificationError[];
  warnings: VerificationWarning[];
} {
  const errors: VerificationError[] = [];
  const warnings: VerificationWarning[] = [];

  // Required fields
  if (!manifest.name) {
    errors.push({ code: 'MISSING_NAME', message: 'Package name is required', field: 'name' });
  } else if (!/^[a-z][a-z0-9-]*$/.test(manifest.name)) {
    errors.push({
      code: 'INVALID_NAME',
      message: 'Package name must be kebab-case (lowercase letters, numbers, hyphens)',
      field: 'name',
    });
  }

  if (!manifest.version) {
    errors.push({ code: 'MISSING_VERSION', message: 'Version is required', field: 'version' });
  } else if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push({
      code: 'INVALID_VERSION',
      message: 'Version must be valid semver (e.g., 1.0.0)',
      field: 'version',
    });
  }

  // Must have frontend or backend
  if (!manifest.frontend && !manifest.backend) {
    errors.push({
      code: 'NO_COMPONENTS',
      message: 'Plugin must have at least frontend or backend',
    });
  }

  // Route namespace validation — non-core plugins must use /plugins/{name} routes.
  // Top-level routes are reserved for core platform plugins managed by admins.
  const RESERVED_PATHS = new Set([
    '/settings', '/admin', '/api', '/auth', '/login', '/signup',
    '/dashboard', '/onboarding', '/profile', '/notifications',
    '/cdn', '/plugins',
  ]);

  const routes: unknown[] =
    (manifest as any).frontend?.routes ||
    (manifest as any).routes ||
    [];

  if (Array.isArray(routes) && routes.length > 0) {
    for (const route of routes) {
      if (typeof route !== 'string') continue;
      const basePath = route.replace(/\/?\*$/, '').replace(/\/+$/, '') || '/';
      const pluginName = typeof manifest.name === 'string' ? manifest.name : '';
      const expectedPrefix = pluginName ? `/plugins/${pluginName}` : null;

      if (!basePath.startsWith('/plugins/') || basePath === '/plugins') {
        errors.push({
          code: 'ROUTE_NAMESPACE_VIOLATION',
          message: `Route "${route}" must be under /plugins/ namespace (e.g., /plugins/${manifest.name}/*). Top-level routes are reserved for core platform plugins.`,
          field: 'frontend.routes',
        });
      } else if (expectedPrefix && basePath !== expectedPrefix && !basePath.startsWith(`${expectedPrefix}/`)) {
        errors.push({
          code: 'ROUTE_NAMESPACE_VIOLATION',
          message: `Route "${route}" must be under /plugins/${pluginName}. Plugins cannot claim another plugin's namespace.`,
          field: 'frontend.routes',
        });
      }

      if (RESERVED_PATHS.has(basePath)) {
        errors.push({
          code: 'ROUTE_RESERVED_PATH',
          message: `Route "${route}" conflicts with a reserved platform path`,
          field: 'frontend.routes',
        });
      }
    }
  }

  // Warnings for marketplace presentation
  if (!manifest.description) {
    warnings.push({
      code: 'MISSING_DESCRIPTION',
      message: 'Description improves marketplace visibility',
      suggestion: 'Add a description to help users find your plugin',
    });
  }

  if (!manifest.displayName) {
    warnings.push({
      code: 'MISSING_DISPLAY_NAME',
      message: 'Display name improves presentation',
      suggestion: 'Add a display name for the marketplace',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Full pre-publish verification
 */
export async function verifyPublish(
  options: VerifyPublishOptions
): Promise<VerificationResult> {
  const {
    manifest,
    frontendUrl,
    backendImage,
    skipUrlCheck = false,
    skipDockerCheck = false,
    timeout = 5000,
  } = options;

  const errors: VerificationError[] = [];
  const warnings: VerificationWarning[] = [];
  const checks: VerificationCheck[] = [];

  // 1. Validate manifest
  const manifestResult = validatePublishManifest(manifest);
  errors.push(...manifestResult.errors);
  warnings.push(...manifestResult.warnings);
  
  checks.push({
    name: 'Manifest Validation',
    passed: manifestResult.valid,
    message: manifestResult.valid 
      ? 'Manifest is valid' 
      : `${manifestResult.errors.length} error(s) found`,
  });

  // 2. Verify frontend URL if provided
  if (frontendUrl && !skipUrlCheck) {
    const urlResult = await verifyUrlAccessible(frontendUrl, timeout);
    
    checks.push({
      name: 'Frontend URL',
      passed: urlResult.accessible,
      message: urlResult.accessible 
        ? `Accessible (${urlResult.responseTime}ms)` 
        : urlResult.error || 'Not accessible',
      duration: urlResult.responseTime,
    });

    if (!urlResult.accessible) {
      errors.push({
        code: 'FRONTEND_NOT_ACCESSIBLE',
        message: `Frontend URL not accessible: ${urlResult.error}`,
        field: 'frontendUrl',
      });
    }
  }

  // 3. Verify Docker image if provided
  if (backendImage && !skipDockerCheck) {
    const dockerResult = await verifyDockerImage(backendImage, timeout * 2);
    
    checks.push({
      name: 'Docker Image',
      passed: dockerResult.exists,
      message: dockerResult.exists
        ? dockerResult.size ? `Found (${(dockerResult.size / 1024 / 1024).toFixed(1)}MB)` : 'Found'
        : dockerResult.error || 'Not found',
    });

    if (!dockerResult.exists) {
      errors.push({
        code: 'DOCKER_IMAGE_NOT_FOUND',
        message: `Docker image not found: ${dockerResult.error}`,
        field: 'backendImage',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checks,
  };
}
