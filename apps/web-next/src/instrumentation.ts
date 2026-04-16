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

    const { getNetworkModels, getDashboardPipelineCatalog } = await import('@/lib/facade');
    const { TTL } = await import('@/lib/facade/cache');

    try {
      const [modelsResult, catalog] = await Promise.all([
        getNetworkModels({ limit: 200 }),
        getDashboardPipelineCatalog(),
      ]);
      console.log(`[naap] Cache warmed on startup: ${modelsResult.total} models, ${catalog.length} pipelines`);
    } catch (err) {
      console.warn('[naap] Startup cache warm failed (non-fatal):', err);
    }

    const NETWORK_MODELS_TTL_SEC = Math.floor(TTL.NETWORK_MODELS / 1000);
    const MIN_REWARM_INTERVAL_MS = 60_000;
    const rewarmMs = Math.max(MIN_REWARM_INTERVAL_MS, Math.floor(NETWORK_MODELS_TTL_SEC * 0.9 * 1000));
    setInterval(() => {
      Promise.all([
        getNetworkModels({ limit: 200 }),
        getDashboardPipelineCatalog(),
      ])
        .then(([m, c]) => console.log(`[naap] Background cache re-warm: ${m.total} models, ${c.length} pipelines`))
        .catch((err) => console.warn('[naap] Background re-warm failed:', err));
    }, rewarmMs);
  }
}
