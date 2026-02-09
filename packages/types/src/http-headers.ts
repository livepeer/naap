/**
 * Shared HTTP Header Constants — Single Source of Truth
 *
 * Both the frontend SDK (@naap/plugin-sdk) and the backend SDK
 * (@naap/plugin-server-sdk) import from here so that CORS
 * `allowedHeaders` and outbound request headers can never drift apart.
 *
 * ──────────────────────────────────────────────────────────────────────
 * HOW TO ADD A NEW CUSTOM HEADER:
 *   1. Add the header name to CUSTOM_HEADERS below.
 *   2. That's it — both SDKs pick it up automatically:
 *      • plugin-server-sdk includes it in CORS allowedHeaders
 *      • plugin-sdk references it when building request headers
 *   3. Run `npx tsc --noEmit` across both packages to confirm.
 * ──────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
// Standard headers that browsers handle natively (Content-Type, Authorization)
// are listed here for completeness so the CORS config is assembled in one place.
// ─────────────────────────────────────────────────────────────────────────────

/** Standard headers required by every plugin API request. */
export const STANDARD_HEADERS = [
  'Content-Type',
  'Authorization',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Custom headers specific to NAAP platform
// ─────────────────────────────────────────────────────────────────────────────

/** Custom NAAP headers sent by plugin frontends and expected by backends. */
export const CUSTOM_HEADERS = [
  'X-CSRF-Token',        // CSRF protection token
  'X-Correlation-ID',    // Distributed tracing / request correlation
  'X-Plugin-Name',       // Identifies the calling plugin
  'X-Request-ID',        // Unique per-request ID (set by server middleware)
  'X-Trace-ID',          // End-to-end trace ID
  'X-Team-ID',           // Multi-tenant team identifier
  'X-WHIP-URL',          // WebRTC WHIP endpoint URL (used by daydream WHIP proxy)
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Derived constants — consumed by plugin-server-sdk (CORS) and plugin-sdk
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete list of headers that CORS must allow on every plugin backend.
 *
 * Usage (plugin-server-sdk):
 * ```ts
 * import { CORS_ALLOWED_HEADERS } from '@naap/types';
 * app.use(cors({ allowedHeaders: CORS_ALLOWED_HEADERS }));
 * ```
 */
export const CORS_ALLOWED_HEADERS: string[] = [
  ...STANDARD_HEADERS,
  ...CUSTOM_HEADERS,
];

// ─────────────────────────────────────────────────────────────────────────────
// Named constants for individual headers (avoids typos in application code)
// ─────────────────────────────────────────────────────────────────────────────

export const HEADER_CSRF_TOKEN   = 'X-CSRF-Token'     as const;
export const HEADER_CORRELATION  = 'X-Correlation-ID'  as const;
export const HEADER_PLUGIN_NAME  = 'X-Plugin-Name'     as const;
export const HEADER_REQUEST_ID   = 'X-Request-ID'      as const;
export const HEADER_TRACE_ID     = 'X-Trace-ID'        as const;
export const HEADER_TEAM_ID      = 'X-Team-ID'         as const;
