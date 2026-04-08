/**
 * True when PLAYWRIGHT_BASE_URL is set and not localhost (e.g. Vercel production URL).
 */
export function isNonLocalBaseUrl(): boolean {
  const raw = process.env.PLAYWRIGHT_BASE_URL?.trim() || '';
  return raw.length > 0 && !raw.includes('localhost');
}
