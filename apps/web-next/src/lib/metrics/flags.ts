/**
 * Feature flags for cross-provider usage telemetry (NAAP-2).
 */

/** Gates the usage ingest endpoint + cross-provider dashboard BFF (default OFF). */
export const USAGE_INGEST_FLAG = 'usage_ingest';

/**
 * Gates the spend-dashboard live PULL path (default OFF). When OFF the dashboard
 * BFF reads `ProviderUsageRecord` rows exactly as today (push-fed). When ON the
 * BFF pulls usage live from a pull-capable provider adapter (e.g. pymthouse via
 * the M2M client) and falls back to `ProviderUsageRecord` on any pull failure.
 * Independent of `usage_ingest`, which still gates whether the endpoint exists.
 */
export const USAGE_PULL_FLAG = 'usage_pull';

/**
 * TTL (ms) for the in-memory spend-pull cache. Configurable via
 * `USAGE_PULL_CACHE_TTL_MS`; defaults to 60s. A non-positive value disables
 * caching (every request pulls live). Clamped to a sane ceiling.
 */
export function usagePullCacheTtlMs(): number {
  const raw = process.env.USAGE_PULL_CACHE_TTL_MS;
  if (raw == null || raw.trim() === '') return 60_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 60_000;
  if (parsed <= 0) return 0;
  // Ceiling guards against an accidental huge TTL serving very stale spend.
  return Math.min(parsed, 3_600_000);
}

/**
 * Per-scope timeout (ms) for a live provider spend pull. Configurable via
 * `USAGE_PULL_TIMEOUT_MS`; defaults to 10s. A non-positive value disables the
 * timeout (await indefinitely — not recommended). A hung provider call hits this
 * deadline, throws, and is caught so the scope degrades to the stored DB rows
 * instead of stalling the dashboard request. Clamped to a sane ceiling.
 */
export function usagePullTimeoutMs(): number {
  const raw = process.env.USAGE_PULL_TIMEOUT_MS;
  if (raw == null || raw.trim() === '') return 10_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 10_000;
  if (parsed <= 0) return 0;
  return Math.min(parsed, 60_000);
}
