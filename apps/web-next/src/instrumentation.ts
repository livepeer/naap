/**
 * Next.js Instrumentation — runs once on server startup.
 *
 * Used for:
 * - Validating required environment variables
 * - Logging deployment stage and feature flags
 * - Auto-registering plugins discovered from plugins/\*\/plugin.json
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

    // ─── Plugin Auto-Registration ─────────────────────────────────────────
    // Discover plugins from plugins/*/plugin.json and ensure all necessary
    // DB records exist (WorkflowPlugin, PluginPackage, Roles, etc.).
    // This eliminates the need to re-run the seed when adding new plugins.
    // Non-fatal: logs a warning and continues if the DB isn't ready.
    // ──────────────────────────────────────────────────────────────────────
    try {
      const { autoRegisterPlugins } = await import('@/lib/plugins/auto-register');
      await autoRegisterPlugins();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[naap] Plugin auto-registration skipped: ${msg}`);
    }
  }
}
