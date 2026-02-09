/**
 * Manifest Validator
 * Comprehensive validation for plugin manifests
 *
 * Uses shared types from @naap/types for consistency
 */

import * as semver from 'semver';
import type {
  PluginManifest,
  PluginCategory,
  ManifestValidationError,
  ManifestValidationResult,
} from '@naap/types';

// Re-export types for backward compatibility
export type { PluginManifest, ManifestValidationError };
export type ValidationError = ManifestValidationError;
export type ValidationResult = ManifestValidationResult;

/**
 * Valid plugin categories for marketplace
 * Note: Defined locally to avoid ESM re-export issues with @naap/types
 * These values must match the PluginCategory type from @naap/types
 */
const VALID_CATEGORIES: PluginCategory[] = [
  'analytics',
  'communication',
  'developer-tools',
  'finance',
  'infrastructure',
  'integration',
  'monitoring',
  'networking',
  'security',
  'storage',
  'other',
];

/**
 * Reserved plugin names that cannot be used
 * Note: Defined locally to avoid ESM re-export issues with @naap/types
 */
const RESERVED_NAMES = [
  'shell',
  'core',
  'system',
  'admin',
  'api',
  'auth',
  'base',
  'naap',
  'plugin',
  'test',
];

// Valid route pattern
const ROUTE_PATTERN = /^\/[a-z0-9\-_/:*]+$/i;

// Valid icon names (Lucide icons)
const VALID_ICONS = [
  'Activity', 'AlertCircle', 'Archive', 'BarChart', 'Bell', 'Box', 'Calendar',
  'Camera', 'Check', 'Clock', 'Cloud', 'Code', 'Cpu', 'Database', 'Download',
  'Edit', 'File', 'Folder', 'Gift', 'Globe', 'Grid', 'Heart', 'Home', 'Image',
  'Inbox', 'Key', 'Layers', 'Layout', 'Link', 'List', 'Lock', 'Mail', 'Map',
  'MessageCircle', 'Mic', 'Monitor', 'Moon', 'Music', 'Network', 'Package',
  'PieChart', 'Play', 'Plus', 'Power', 'Radio', 'RefreshCw', 'Repeat', 'Rocket',
  'Save', 'Search', 'Send', 'Server', 'Settings', 'Share', 'Shield', 'Star',
  'Sun', 'Tag', 'Target', 'Terminal', 'Tool', 'Trash', 'Truck', 'Upload', 'User',
  'Users', 'Video', 'Wifi', 'Zap',
];

/**
 * Validate a plugin manifest
 */
export function validateManifest(manifest: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!manifest || typeof manifest !== 'object') {
    errors.push({ field: 'manifest', message: 'Manifest must be an object', severity: 'error' });
    return { valid: false, errors, warnings };
  }

  const m = manifest as Partial<PluginManifest>;

  // Required fields
  if (!m.name) {
    errors.push({ field: 'name', message: 'Name is required', severity: 'error' });
  } else if (typeof m.name !== 'string') {
    errors.push({ field: 'name', message: 'Name must be a string', severity: 'error' });
  } else {
    // Validate name format - accepts both kebab-case (my-wallet) and camelCase (myWallet)
    if (!/^[a-z][a-zA-Z0-9-]*$/.test(m.name)) {
      errors.push({
        field: 'name',
        message: 'Name must start with lowercase letter and contain only letters, numbers, and hyphens',
        severity: 'error'
      });
    }
    if (m.name.length < 3) {
      errors.push({ field: 'name', message: 'Name must be at least 3 characters', severity: 'error' });
    }
    if (m.name.length > 50) {
      errors.push({ field: 'name', message: 'Name must be at most 50 characters', severity: 'error' });
    }
    if (RESERVED_NAMES.includes(m.name)) {
      errors.push({ field: 'name', message: `"${m.name}" is a reserved name`, severity: 'error' });
    }
  }

  if (!m.displayName) {
    errors.push({ field: 'displayName', message: 'Display name is required', severity: 'error' });
  } else if (typeof m.displayName !== 'string') {
    errors.push({ field: 'displayName', message: 'Display name must be a string', severity: 'error' });
  } else if (m.displayName.length > 100) {
    errors.push({ field: 'displayName', message: 'Display name must be at most 100 characters', severity: 'error' });
  }

  if (!m.version) {
    errors.push({ field: 'version', message: 'Version is required', severity: 'error' });
  } else if (!semver.valid(m.version)) {
    errors.push({ 
      field: 'version', 
      message: `Invalid version format: "${m.version}". Use semver (e.g., 1.0.0)`, 
      severity: 'error' 
    });
  }

  // Optional fields with validation
  if (m.description !== undefined) {
    if (typeof m.description !== 'string') {
      errors.push({ field: 'description', message: 'Description must be a string', severity: 'error' });
    } else if (m.description.length > 500) {
      warnings.push({ field: 'description', message: 'Description is long (>500 chars)', severity: 'warning' });
    }
  } else {
    warnings.push({ field: 'description', message: 'Description is recommended', severity: 'warning' });
  }

  if (m.category !== undefined) {
    if (!VALID_CATEGORIES.includes(m.category)) {
      warnings.push({ 
        field: 'category', 
        message: `Unknown category "${m.category}". Valid: ${VALID_CATEGORIES.join(', ')}`, 
        severity: 'warning' 
      });
    }
  }

  // Author validation
  if (m.author) {
    if (typeof m.author !== 'object') {
      errors.push({ field: 'author', message: 'Author must be an object', severity: 'error' });
    } else {
      if (m.author.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.author.email)) {
        errors.push({ field: 'author.email', message: 'Invalid email format', severity: 'error' });
      }
      if (m.author.url && !/^https?:\/\//.test(m.author.url)) {
        errors.push({ field: 'author.url', message: 'URL must start with http:// or https://', severity: 'error' });
      }
    }
  }

  // Repository validation
  if (m.repository) {
    if (!/^https?:\/\//.test(m.repository) && !/^[^/]+\/[^/]+$/.test(m.repository)) {
      warnings.push({ 
        field: 'repository', 
        message: 'Repository should be a URL or "owner/repo" format', 
        severity: 'warning' 
      });
    }
  }

  // License validation
  if (m.license) {
    const validLicenses = ['MIT', 'Apache-2.0', 'GPL-3.0', 'BSD-3-Clause', 'ISC', 'UNLICENSED'];
    if (!validLicenses.includes(m.license)) {
      warnings.push({ 
        field: 'license', 
        message: `Non-standard license "${m.license}"`, 
        severity: 'warning' 
      });
    }
  }

  // Keywords validation
  if (m.keywords) {
    if (!Array.isArray(m.keywords)) {
      errors.push({ field: 'keywords', message: 'Keywords must be an array', severity: 'error' });
    } else {
      if (m.keywords.length > 10) {
        warnings.push({ field: 'keywords', message: 'More than 10 keywords is excessive', severity: 'warning' });
      }
      for (const kw of m.keywords) {
        if (typeof kw !== 'string') {
          errors.push({ field: 'keywords', message: 'Each keyword must be a string', severity: 'error' });
          break;
        }
      }
    }
  }

  // Frontend validation
  if (m.frontend) {
    if (typeof m.frontend !== 'object') {
      errors.push({ field: 'frontend', message: 'Frontend must be an object', severity: 'error' });
    } else {
      // Routes validation
      if (m.frontend.routes) {
        if (!Array.isArray(m.frontend.routes)) {
          errors.push({ field: 'frontend.routes', message: 'Routes must be an array', severity: 'error' });
        } else {
          for (const route of m.frontend.routes) {
            if (!ROUTE_PATTERN.test(route)) {
              errors.push({ 
                field: 'frontend.routes', 
                message: `Invalid route pattern: "${route}"`, 
                severity: 'error' 
              });
            }
          }
        }
      }

      // Navigation validation
      if (m.frontend.navigation) {
        if (!m.frontend.navigation.path) {
          errors.push({ field: 'frontend.navigation.path', message: 'Navigation path is required', severity: 'error' });
        } else if (!ROUTE_PATTERN.test(m.frontend.navigation.path)) {
          errors.push({ 
            field: 'frontend.navigation.path', 
            message: `Invalid navigation path: "${m.frontend.navigation.path}"`, 
            severity: 'error' 
          });
        }

        if (!m.frontend.navigation.label) {
          errors.push({ field: 'frontend.navigation.label', message: 'Navigation label is required', severity: 'error' });
        }

        if (m.frontend.navigation.icon && !VALID_ICONS.includes(m.frontend.navigation.icon)) {
          warnings.push({ 
            field: 'frontend.navigation.icon', 
            message: `Unknown icon "${m.frontend.navigation.icon}"`, 
            severity: 'warning' 
          });
        }
      }
    }
  }

  // Backend validation
  if (m.backend) {
    if (typeof m.backend !== 'object') {
      errors.push({ field: 'backend', message: 'Backend must be an object', severity: 'error' });
    } else {
      if (m.backend.port !== undefined) {
        if (typeof m.backend.port !== 'number' || m.backend.port < 1 || m.backend.port > 65535) {
          errors.push({ field: 'backend.port', message: 'Port must be a number between 1 and 65535', severity: 'error' });
        }
      }

      if (m.backend.healthCheck && !m.backend.healthCheck.startsWith('/')) {
        errors.push({ field: 'backend.healthCheck', message: 'Health check path must start with /', severity: 'error' });
      }
    }
  }

  // Version compatibility
  if (m.minShellVersion && !semver.valid(m.minShellVersion)) {
    errors.push({ 
      field: 'minShellVersion', 
      message: `Invalid version: "${m.minShellVersion}"`, 
      severity: 'error' 
    });
  }

  if (m.maxShellVersion && !semver.valid(m.maxShellVersion)) {
    errors.push({ 
      field: 'maxShellVersion', 
      message: `Invalid version: "${m.maxShellVersion}"`, 
      severity: 'error' 
    });
  }

  if (m.minShellVersion && m.maxShellVersion && semver.gt(m.minShellVersion, m.maxShellVersion)) {
    errors.push({ 
      field: 'minShellVersion', 
      message: 'minShellVersion cannot be greater than maxShellVersion', 
      severity: 'error' 
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Create manifest validator instance
 */
export function createManifestValidator() {
  return {
    validate: validateManifest,

    /**
     * Quick check if manifest is minimally valid
     */
    isValid(manifest: unknown): boolean {
      return validateManifest(manifest).valid;
    },

    /**
     * Get just the error messages
     */
    getErrors(manifest: unknown): string[] {
      const result = validateManifest(manifest);
      return result.errors.map(e => `${e.field}: ${e.message}`);
    },

    /**
     * Validate and throw on error
     */
    assertValid(manifest: unknown): void {
      const result = validateManifest(manifest);
      if (!result.valid) {
        const messages = result.errors.map(e => `${e.field}: ${e.message}`).join('; ');
        throw new Error(`Invalid manifest: ${messages}`);
      }
    },
  };
}

export const manifestValidator = createManifestValidator();
