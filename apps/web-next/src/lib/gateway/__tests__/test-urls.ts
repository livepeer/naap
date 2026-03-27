/**
 * URLs for gateway unit tests. Auth strategies like `none` do not read the host;
 * we still use a real URL shape. Prefer `LEADERBOARD_API_URL` when set so local
 * runs match your config; otherwise RFC 2606 `example.com` (never a real upstream).
 */
export function leaderboardUrlForAuthTests(): URL {
  const raw = process.env.LEADERBOARD_API_URL?.trim();
  if (raw) {
    try {
      return new URL(raw);
    } catch {
      /* ignore */
    }
  }
  return new URL('https://example.com');
}
