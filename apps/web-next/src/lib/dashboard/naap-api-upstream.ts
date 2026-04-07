/**
 * Build absolute URLs for the versioned NAAP API HTTP server.
 *
 * `NAAP_API_SERVER_URL` must be set in the environment. It is the full base
 * URL through the API version prefix (for example `/v1`), with no trailing slash.
 *
 * Resource paths are joined after it, e.g. `pipelines`, `sla/compliance`.
 */

function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, '');
}

/** Base URL including the version prefix (e.g. `/v1`), no trailing slash. */
export function naapApiBaseUrl(): string {
  const raw = process.env.NAAP_API_SERVER_URL?.trim();
  if (!raw) {
    throw new Error(
      '[naap-api-upstream] NAAP_API_SERVER_URL is not set. ' +
      'Add it to apps/web-next/.env.local (see .env.local.example).'
    );
  }
  return stripTrailingSlashes(raw);
}

/** Safe label for logs when the env var may be unset (never throws). */
export function naapApiBaseLabel(): string {
  const raw = process.env.NAAP_API_SERVER_URL?.trim();
  return raw ? stripTrailingSlashes(raw) : '<NAAP_API_SERVER_URL unset>';
}

/**
 * @param resourcePath e.g. `pipelines` or `sla/compliance` (leading slashes OK)
 */
export function naapApiUpstreamUrl(resourcePath: string): string {
  const rel = resourcePath.replace(/^\/+/, '');
  const base = naapApiBaseUrl();
  if (!rel) return base;
  return `${base}/${rel}`;
}
