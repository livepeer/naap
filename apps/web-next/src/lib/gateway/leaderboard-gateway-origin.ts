/**
 * Service Gateway `livepeer-leaderboard` connector stores upstreamBaseUrl as
 * a full versioned API base (e.g. https://naap-api.cloudspe.com/v1). Endpoint
 * upstream paths should only include the resource path after /v1.
 */
export function leaderboardGatewayOriginFromEnv(): string | null {
  const full = process.env.LEADERBOARD_API_URL?.trim();
  if (!full) return null;
  return full.replace(/\/+$/, '');
}
