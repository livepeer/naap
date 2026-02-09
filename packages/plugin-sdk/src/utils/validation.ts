/**
 * Plugin Manifest Validation
 */

import type { PluginManifest, PluginTemplate } from '../types/manifest.js';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  path: string;
  message: string;
  value?: unknown;
}

export interface ValidationWarning {
  path: string;
  message: string;
  suggestion?: string;
}

const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Validate a plugin manifest
 */
export function validateManifest(manifest: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!manifest || typeof manifest !== 'object') {
    errors.push({
      path: '',
      message: 'Manifest must be an object',
      value: manifest,
    });
    return { valid: false, errors, warnings };
  }

  const m = manifest as Record<string, unknown>;

  // Required fields
  if (!m.name || typeof m.name !== 'string') {
    errors.push({ path: 'name', message: 'name is required and must be a string' });
  } else if (!KEBAB_CASE_REGEX.test(m.name)) {
    errors.push({
      path: 'name',
      message: 'name must be kebab-case (e.g., "my-plugin")',
      value: m.name,
    });
  }

  if (!m.displayName || typeof m.displayName !== 'string') {
    errors.push({ path: 'displayName', message: 'displayName is required and must be a string' });
  }

  if (!m.version || typeof m.version !== 'string') {
    errors.push({ path: 'version', message: 'version is required and must be a string' });
  } else if (!SEMVER_REGEX.test(m.version)) {
    errors.push({
      path: 'version',
      message: 'version must be valid semver (e.g., "1.0.0")',
      value: m.version,
    });
  }

  // Validate frontend if present
  if (m.frontend) {
    validateFrontend(m.frontend, errors, warnings);
  }

  // Validate backend if present
  if (m.backend) {
    validateBackend(m.backend, errors, warnings);
  }

  // Validate database if present
  if (m.database) {
    validateDatabase(m.database, errors, warnings);
  }

  // Warnings for missing optional fields
  if (!m.description) {
    warnings.push({
      path: 'description',
      message: 'description is recommended for marketplace listing',
    });
  }

  if (!m.author) {
    warnings.push({
      path: 'author',
      message: 'author information is recommended',
    });
  }

  if (!m.license) {
    warnings.push({
      path: 'license',
      message: 'license is recommended',
      suggestion: 'Consider adding "MIT" or another appropriate license',
    });
  }

  // Must have either frontend or backend
  if (!m.frontend && !m.backend) {
    errors.push({
      path: '',
      message: 'Plugin must have at least a frontend or backend configuration',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateFrontend(
  frontend: unknown,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  if (typeof frontend !== 'object' || !frontend) {
    errors.push({ path: 'frontend', message: 'frontend must be an object' });
    return;
  }

  const f = frontend as Record<string, unknown>;

  if (!f.entry || typeof f.entry !== 'string') {
    errors.push({ path: 'frontend.entry', message: 'frontend.entry is required' });
  }

  if (!f.routes || !Array.isArray(f.routes) || f.routes.length === 0) {
    errors.push({ path: 'frontend.routes', message: 'frontend.routes must be a non-empty array' });
  } else {
    f.routes.forEach((route, i) => {
      if (typeof route !== 'string' || !route.startsWith('/')) {
        errors.push({
          path: `frontend.routes[${i}]`,
          message: 'Each route must be a string starting with "/"',
          value: route,
        });
      }
    });
  }

  if (!f.navigation) {
    warnings.push({
      path: 'frontend.navigation',
      message: 'navigation configuration is recommended for sidebar display',
    });
  } else {
    const nav = f.navigation as Record<string, unknown>;
    if (!nav.label || typeof nav.label !== 'string') {
      errors.push({ path: 'frontend.navigation.label', message: 'navigation.label is required' });
    }
    if (!nav.icon || typeof nav.icon !== 'string') {
      warnings.push({
        path: 'frontend.navigation.icon',
        message: 'navigation.icon is recommended',
        suggestion: 'Use a Lucide icon name like "BarChart3"',
      });
    }
  }
}

function validateBackend(
  backend: unknown,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  if (typeof backend !== 'object' || !backend) {
    errors.push({ path: 'backend', message: 'backend must be an object' });
    return;
  }

  const b = backend as Record<string, unknown>;

  if (!b.entry || typeof b.entry !== 'string') {
    errors.push({ path: 'backend.entry', message: 'backend.entry is required' });
  }

  if (typeof b.port !== 'number' || b.port < 1024 || b.port > 65535) {
    errors.push({
      path: 'backend.port',
      message: 'backend.port must be a number between 1024 and 65535',
      value: b.port,
    });
  }

  if (!b.apiPrefix || typeof b.apiPrefix !== 'string') {
    errors.push({ path: 'backend.apiPrefix', message: 'backend.apiPrefix is required' });
  } else if (!b.apiPrefix.startsWith('/api/')) {
    warnings.push({
      path: 'backend.apiPrefix',
      message: 'apiPrefix should start with "/api/"',
      suggestion: `Consider using "/api/v1/${b.apiPrefix.replace(/^\/+/, '')}"`,
    });
  }

  if (!b.healthCheck) {
    warnings.push({
      path: 'backend.healthCheck',
      message: 'healthCheck endpoint is recommended',
      suggestion: 'Add healthCheck: "/healthz"',
    });
  }
}

function validateDatabase(
  database: unknown,
  errors: ValidationError[],
  _warnings: ValidationWarning[]
): void {
  if (typeof database !== 'object' || !database) {
    errors.push({ path: 'database', message: 'database must be an object' });
    return;
  }

  const d = database as Record<string, unknown>;

  const validTypes = ['postgresql', 'mysql', 'mongodb'];
  if (!d.type || !validTypes.includes(d.type as string)) {
    errors.push({
      path: 'database.type',
      message: `database.type must be one of: ${validTypes.join(', ')}`,
      value: d.type,
    });
  }

  if (d.type === 'postgresql' || d.type === 'mysql') {
    if (!d.schema) {
      errors.push({
        path: 'database.schema',
        message: 'database.schema is required for SQL databases',
      });
    }
  }
}

/**
 * Validate plugin name
 */
export function validatePluginName(name: string): boolean {
  return KEBAB_CASE_REGEX.test(name);
}

/**
 * Validate version string
 */
export function validateVersion(version: string): boolean {
  return SEMVER_REGEX.test(version);
}

/**
 * Create a default manifest for a new plugin
 */
export function createDefaultManifest(
  name: string,
  template: PluginTemplate,
  options: {
    displayName?: string;
    description?: string;
    author?: string;
  } = {}
): PluginManifest {
  const manifest: PluginManifest = {
    $schema: 'https://plugins.naap.io/schema/plugin.json',
    name,
    displayName: options.displayName || name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    version: '0.1.0',
    description: options.description || `A NAAP plugin: ${name}`,
    author: options.author ? { name: options.author } : undefined,
    license: 'MIT',
    keywords: [],
    category: 'other',
    shell: {
      minVersion: '0.1.0',
    },
    permissions: {
      shell: ['navigation', 'notifications'],
    },
    lifecycle: {},
  };

  if (template === 'full-stack' || template === 'frontend-only') {
    manifest.frontend = {
      entry: `./frontend/dist/production/${name}.js`,
      devPort: 3010,
      routes: [`/${name}`, `/${name}/*`],
      navigation: {
        path: `/${name}`,
        label: manifest.displayName,
        icon: 'Box',
        order: 100,
      },
    };
  }

  if (template === 'full-stack' || template === 'backend-only') {
    manifest.backend = {
      entry: './backend/dist/server.js',
      devPort: 4010,
      port: 4100,
      healthCheck: '/healthz',
      apiPrefix: `/api/v1/${name}`,
      resources: {
        memory: '256Mi',
        cpu: '0.25',
      },
    };

    manifest.database = {
      type: 'postgresql',
      schema: './backend/prisma/schema.prisma',
      migrations: './backend/prisma/migrations',
      seed: './backend/prisma/seed.ts',
    };

    manifest.lifecycle = {
      postInstall: 'npm run db:migrate && npm run db:seed',
      postUpdate: 'npm run db:migrate',
    };
  }

  return manifest;
}
