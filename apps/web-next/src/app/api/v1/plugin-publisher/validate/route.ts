/**
 * Plugin Manifest Validation Endpoint
 * POST /api/v1/plugin-publisher/validate - Validate a plugin manifest
 */

import { NextRequest } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

// Validation patterns
const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

interface ValidationError {
  path: string;
  message: string;
  value?: unknown;
}

interface ValidationWarning {
  path: string;
  message: string;
  suggestion?: string;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

function validateManifest(manifest: unknown): ValidationResult {
  const validationErrors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!manifest || typeof manifest !== 'object') {
    validationErrors.push({ path: '', message: 'Manifest must be an object', value: manifest });
    return { valid: false, errors: validationErrors, warnings };
  }

  const m = manifest as Record<string, unknown>;

  // Required fields
  if (!m.name || typeof m.name !== 'string') {
    validationErrors.push({ path: 'name', message: 'name is required and must be a string' });
  } else if (!KEBAB_CASE_REGEX.test(m.name)) {
    validationErrors.push({ path: 'name', message: 'name must be kebab-case (e.g., "my-plugin")', value: m.name });
  }

  if (!m.displayName || typeof m.displayName !== 'string') {
    validationErrors.push({ path: 'displayName', message: 'displayName is required and must be a string' });
  }

  if (!m.version || typeof m.version !== 'string') {
    validationErrors.push({ path: 'version', message: 'version is required and must be a string' });
  } else if (!SEMVER_REGEX.test(m.version)) {
    validationErrors.push({ path: 'version', message: 'version must be valid semver (e.g., "1.0.0")', value: m.version });
  }

  // Validate frontend if present
  if (m.frontend && typeof m.frontend === 'object') {
    const frontend = m.frontend as Record<string, unknown>;
    if (!frontend.entry && !frontend.devEntry) {
      validationErrors.push({ path: 'frontend.entry', message: 'frontend.entry or frontend.devEntry is required' });
    }
    if (!frontend.routes || !Array.isArray(frontend.routes) || frontend.routes.length === 0) {
      validationErrors.push({ path: 'frontend.routes', message: 'frontend.routes must be a non-empty array' });
    }
  }

  // Validate backend if present
  if (m.backend && typeof m.backend === 'object') {
    const backend = m.backend as Record<string, unknown>;
    if (!backend.entry && !backend.devEntry) {
      validationErrors.push({ path: 'backend.entry', message: 'backend.entry or backend.devEntry is required' });
    }
  }

  // Must have either frontend or backend
  if (!m.frontend && !m.backend) {
    validationErrors.push({ path: '', message: 'Plugin must have at least a frontend or backend configuration' });
  }

  // Warnings for missing optional fields
  if (!m.description) {
    warnings.push({ path: 'description', message: 'description is recommended for marketplace listing' });
  }
  if (!m.author) {
    warnings.push({ path: 'author', message: 'author information is recommended' });
  }
  if (!m.license) {
    warnings.push({ path: 'license', message: 'license is recommended', suggestion: 'Consider adding "MIT" or another appropriate license' });
  }

  return { valid: validationErrors.length === 0, errors: validationErrors, warnings };
}

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const body = await request.json();
    const { manifest } = body;

    if (!manifest) {
      return errors.badRequest('manifest is required');
    }

    const result = validateManifest(manifest);
    return success(result);
  } catch (err) {
    console.error('Validation error:', err);
    return errors.internal('Validation failed');
  }
}
