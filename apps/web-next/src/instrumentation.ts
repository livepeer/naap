/**
 * Next.js Instrumentation — runs once on server startup.
 *
 * Used for:
 * - Validating required environment variables
 * - Logging deployment stage and feature flags
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run validation on the server (Node.js runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv, deployStage, isVercel, features } = await import('@/lib/env');

    const { valid, missing, warnings } = validateEnv();

    // Log deployment context
    console.log(
      `[naap] Starting in ${deployStage} mode` +
        (isVercel ? ' (Vercel)' : ' (self-hosted)'),
    );

    // Log feature detection
    const enabledFeatures = Object.entries(features)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (enabledFeatures.length > 0) {
      console.log(`[naap] Features: ${enabledFeatures.join(', ')}`);
    }

    // Report missing required env vars
    if (!valid) {
      console.error(
        `[naap] FATAL: Missing required environment variables: ${missing.join(', ')}`,
      );
      // In production on Vercel, don't crash — let the health endpoint report the issue.
      // In development, crash early so developers notice immediately.
      if (!isVercel && process.env.NODE_ENV !== 'production') {
        throw new Error(
          `Missing required environment variables: ${missing.join(', ')}. ` +
            'See .env.example for configuration reference.',
        );
      }
    }

    // Log warnings for recommended vars
    for (const warning of warnings) {
      console.warn(`[naap] Warning: ${warning}`);
    }

    // Pre-warm NAAP API caches so the first dashboard request is instant.
    // `register()` completes before Next.js serves any request, so awaiting
    // here guarantees no user ever hits a cold in-process cache.
    const { warmDashboardCaches, NAAP_API_CACHE_TTLS } = await import(
      '@/lib/dashboard/raw-data'
    );
    const { warmNetworkData } = await import('@/lib/facade/network-data');

    try {
      const [warmResult, networkResult] = await Promise.all([
        warmDashboardCaches(),
        warmNetworkData(),
      ]);
      console.log('[naap] NAAP API cache warmed on startup:', warmResult);
      console.log('[naap] Network data cache warmed on startup:', networkResult);
    } catch (err) {
      console.warn('[naap] Startup cache warm failed (non-fatal):', err);
    }

    // Re-warm in the background at ~90% of the longest NAAP raw-cache TTL.
    // NAAP_API_CACHE_TTLS values are in seconds (see raw-data.ts).
    const MIN_REWARM_INTERVAL_MS = 60_000;
    const demandSec =
      typeof NAAP_API_CACHE_TTLS.demand === 'number' && Number.isFinite(NAAP_API_CACHE_TTLS.demand) && NAAP_API_CACHE_TTLS.demand > 0
        ? NAAP_API_CACHE_TTLS.demand
        : 180;
    const slaSec =
      typeof NAAP_API_CACHE_TTLS.sla === 'number' && Number.isFinite(NAAP_API_CACHE_TTLS.sla) && NAAP_API_CACHE_TTLS.sla > 0
        ? NAAP_API_CACHE_TTLS.sla
        : 300;
    const maxTtlSec = Math.max(demandSec, slaSec);
    const rewarmMs = Math.max(MIN_REWARM_INTERVAL_MS, Math.floor(maxTtlSec * 0.9 * 1000));
    setInterval(() => {
      Promise.all([warmDashboardCaches(), warmNetworkData()])
        .then(([r, n]) => console.log('[naap] Background cache re-warm:', r, n))
        .catch((err) => console.warn('[naap] Background re-warm failed:', err));
    }, rewarmMs);
  }
}
