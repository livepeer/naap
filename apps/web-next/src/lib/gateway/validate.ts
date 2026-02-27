/**
 * Service Gateway — Request Validation
 *
 * Validates consumer request body against endpoint-configured rules:
 * - Required headers check
 * - Body regex pattern matching
 * - Keyword blacklist
 * - JSON Schema validation (lightweight, using Zod-like validation)
 */

import type { ResolvedEndpoint } from './types';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a consumer request against the endpoint's validation rules.
 */
export function validateRequest(
  request: Request,
  endpoint: ResolvedEndpoint,
  consumerBody: string | null
): ValidationResult {
  // ── Required Headers ──
  if (endpoint.requiredHeaders.length > 0) {
    for (const header of endpoint.requiredHeaders) {
      if (!request.headers.get(header)) {
        return { valid: false, error: `Missing required header: ${header}` };
      }
    }
  }

  if (!consumerBody) return { valid: true };

  // ── Body Regex Pattern ──
  if (endpoint.bodyPattern) {
    if (consumerBody.length > 1_000_000) {
      return { valid: false, error: 'Request body too large for pattern matching' };
    }
    try {
      const regex = new RegExp(endpoint.bodyPattern);
      if (!regex.test(consumerBody)) {
        return { valid: false, error: 'Request body does not match required pattern' };
      }
    } catch {
      console.warn(`[gateway] Invalid bodyPattern regex for endpoint ${endpoint.id}: ${endpoint.bodyPattern}`);
      return { valid: false, error: 'Invalid body pattern configuration' };
    }
  }

  // ── Keyword Blacklist ──
  if (endpoint.bodyBlacklist.length > 0) {
    const bodyLower = consumerBody.toLowerCase();
    for (const keyword of endpoint.bodyBlacklist) {
      if (bodyLower.includes(keyword.toLowerCase())) {
        return { valid: false, error: `Request body contains blocked keyword: "${keyword}"` };
      }
    }
  }

  // ── JSON Schema Validation ──
  if (endpoint.bodySchema) {
    const schemaResult = validateJsonSchema(consumerBody, endpoint.bodySchema);
    if (!schemaResult.valid) {
      return schemaResult;
    }
  }

  return { valid: true };
}

/**
 * Lightweight JSON Schema validation.
 * Supports basic type checking and required fields — not a full JSON Schema implementation.
 */
function validateJsonSchema(body: string, schema: unknown): ValidationResult {
  try {
    const parsed = JSON.parse(body);
    const s = schema as Record<string, unknown>;

    // Check type
    if (s.type === 'object' && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))) {
      return { valid: false, error: 'Request body must be a JSON object' };
    }

    if (s.type === 'array' && !Array.isArray(parsed)) {
      return { valid: false, error: 'Request body must be a JSON array' };
    }

    // Check required fields
    if (s.required && Array.isArray(s.required) && typeof parsed === 'object' && parsed !== null) {
      for (const field of s.required as string[]) {
        if (!(field in parsed)) {
          return { valid: false, error: `Missing required field: ${field}` };
        }
      }
    }

    // Check properties type
    if (s.properties && typeof s.properties === 'object' && typeof parsed === 'object' && parsed !== null) {
      const props = s.properties as Record<string, { type?: string }>;
      for (const [key, prop] of Object.entries(props)) {
        if (key in parsed && prop.type) {
          const val = (parsed as Record<string, unknown>)[key];
          if (prop.type === 'string' && typeof val !== 'string') {
            return { valid: false, error: `Field "${key}" must be a string` };
          }
          if (prop.type === 'number' && typeof val !== 'number') {
            return { valid: false, error: `Field "${key}" must be a number` };
          }
          if (prop.type === 'boolean' && typeof val !== 'boolean') {
            return { valid: false, error: `Field "${key}" must be a boolean` };
          }
        }
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Request body is not valid JSON' };
  }
}
