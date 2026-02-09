/**
 * Environment Detection and Configuration
 *
 * Provides consistent environment detection across the application.
 * The app automatically detects which environment it's running in.
 *
 * Hybrid Deployment Model:
 * - Vercel: web-next (Next.js shell), plugin frontends, API gateway routes
 * - Off-Vercel: base-svc, livepeer-svc, pipeline-gateway, plugin-server,
 *               storage-svc, infrastructure-svc
 */

// ─── Environment Detection ──────────────────────────────────────────────────

export const isVercel = !!process.env.VERCEL;
export const isProduction = process.env.NODE_ENV === 'production';
export const isDevelopment = process.env.NODE_ENV === 'development';
export const isTest = process.env.NODE_ENV === 'test';

/** Vercel environment: 'production' | 'preview' | 'development' */
export const vercelEnv = process.env.VERCEL_ENV as 'production' | 'preview' | 'development' | undefined;

/** Deployment stage derived from DEPLOY_ENV or VERCEL_ENV */
export type DeployStage = 'development' | 'staging' | 'production';

export const deployStage: DeployStage = (() => {
  const explicit = process.env.DEPLOY_ENV as DeployStage | undefined;
  if (explicit && ['development', 'staging', 'production'].includes(explicit)) {
    return explicit;
  }
  if (vercelEnv === 'production') return 'production';
  if (vercelEnv === 'preview') return 'staging';
  return 'development';
})();

// ─── Feature Flags ──────────────────────────────────────────────────────────

export const features = {
  // Use Vercel Blob storage (only in Vercel with token)
  useVercelBlob: !!process.env.BLOB_READ_WRITE_TOKEN,

  // Use Ably for realtime (only with API key)
  useAbly: !!process.env.ABLY_API_KEY,

  // OAuth providers
  hasGoogleOAuth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  hasGithubOAuth: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
};

// ─── Service URLs (Hybrid Deployment) ───────────────────────────────────────
//
// On Vercel: these point to the off-Vercel backend hosts.
// In development: default to localhost ports.
//
// The Next.js API routes at /api/v1/base/*, /api/v1/livepeer/*,
// /api/v1/pipelines/* proxy to these services, so frontends always
// talk to the same origin (Vercel) and never directly to backends.

export const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

/** base-svc: auth, plugin registry, lifecycle, teams, tenants, RBAC, secrets */
export const baseSvcUrl = process.env.BASE_SVC_URL || 'http://localhost:4000';

/** livepeer-svc: staking, orchestrators, protocol parameters, deposits (Phase 4) */
export const livepeerSvcUrl = process.env.LIVEPEER_SVC_URL || 'http://localhost:4010';

/** pipeline-gateway: AI pipelines, live video, BYOC (Phase 5) */
export const pipelineGatewayUrl = process.env.PIPELINE_GATEWAY_URL || 'http://localhost:4020';

/** plugin-server: serves plugin frontend assets */
export const pluginServerUrl = process.env.PLUGIN_SERVER_URL || 'http://localhost:3100';

/** storage-svc: artifact storage for plugin publishing */
export const storageSvcUrl = process.env.STORAGE_SVC_URL || 'http://localhost:4050';

/** infrastructure-svc: container/DB/port provisioning */
export const infrastructureSvcUrl = process.env.INFRASTRUCTURE_SVC_URL || 'http://localhost:4060';

// Database URL (works in both environments)
// - Local: postgresql://postgres:postgres@localhost:5432/naap
// - Vercel: postgres://... (from Neon Marketplace)
export const databaseUrl = process.env.DATABASE_URL;

// ─── Config Accessor ────────────────────────────────────────────────────────

/**
 * Get environment-specific configuration.
 * Safe for server components, API routes, and middleware.
 */
export function getEnvConfig() {
  return {
    // Environment
    isVercel,
    isProduction,
    isDevelopment,
    isTest,
    deployStage,
    vercelEnv,

    // Features
    features,

    // URLs
    appUrl,
    baseSvcUrl,
    livepeerSvcUrl,
    pipelineGatewayUrl,
    pluginServerUrl,
    storageSvcUrl,
    infrastructureSvcUrl,

    // Database
    hasDatabaseConnection: !!databaseUrl,
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate required environment variables.
 * Call this during startup to catch missing config early.
 */
export function validateEnv(): { valid: boolean; missing: string[]; warnings: string[] } {
  const required = ['DATABASE_URL', 'NEXTAUTH_SECRET'];
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  // Warn about optional but recommended vars in production
  if (isProduction) {
    const recommended = [
      'BASE_SVC_URL',
      'BLOB_READ_WRITE_TOKEN',
    ];
    for (const key of recommended) {
      if (!process.env[key]) {
        warnings.push(`${key} is not set (recommended for production)`);
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}
