/**
 * Canonical base URL for Playwright API requests and navigation.
 * Matches playwright.config.ts `use.baseURL`.
 */
export function e2eBaseUrl(): string {
  const raw = process.env.PLAYWRIGHT_BASE_URL?.trim() || 'http://localhost:3000';
  return raw.replace(/\/$/, '');
}
