/**
 * Service Gateway `livepeer-leaderboard` connector stores upstreamBaseUrl as
 * scheme + host only (paths like /api/pipelines live on endpoints). Derive that
 * origin from LEADERBOARD_API_URL the same way as bin/seed-leaderboard-gateway.ts.
 */
export function leaderboardGatewayOriginFromEnv(): string | null {
  const full = process.env.LEADERBOARD_API_URL?.trim();
  if (!full) return null;
  return full.replace(/\/+$/, '').replace(/\/(api|v1)$/, '');
}
