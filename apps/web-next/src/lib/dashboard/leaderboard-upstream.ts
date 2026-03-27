/**
 * Build absolute URLs for the versioned leaderboard HTTP API.
 *
 * `LEADERBOARD_API_URL` must be set in the environment. It is the full base
 * URL through the API prefix segment, with no trailing slash. Livepeer's
 * canonical host uses `/api`; some mirrors use `/v1`.
 *
 * Resource paths are joined after it, e.g. `pipelines`, `network/demand`.
 */

function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, '');
}

/** Base URL including `/api` or `/v1` (per upstream), no trailing slash. */
export function leaderboardApiBaseUrl(): string {
  const raw = process.env.LEADERBOARD_API_URL?.trim();
  if (!raw) {
    throw new Error(
      '[leaderboard-upstream] LEADERBOARD_API_URL is not set. ' +
      'Add it to apps/web-next/.env.local (see .env.local.example).'
    );
  }
  return stripTrailingSlashes(raw);
}

/** Same as {@link leaderboardApiBaseUrl} — useful for logs and errors. */
export function leaderboardApiBaseLabel(): string {
  return leaderboardApiBaseUrl();
}

/**
 * @param resourcePath e.g. `pipelines` or `network/demand` (leading slashes OK)
 */
export function leaderboardUpstreamUrl(resourcePath: string): string {
  const rel = resourcePath.replace(/^\/+/, '');
  return `${leaderboardApiBaseUrl()}/${rel}`;
}
