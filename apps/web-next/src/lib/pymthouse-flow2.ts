/**
 * Flow 2 (gist): subscribe and provision via PymtHouse.
 *
 * NaaP does not mirror the billing marketplace catalog. Users complete plan
 * selection and subscription in PymtHouse; NaaP links there and may later call
 * PymtHouse APIs server-side where machine credentials exist.
 *
 * Gap (2026): PymtHouse `POST /api/v1/subscriptions` is session-cookie auth only.
 * Fully automated checkout from NaaP requires a PymtHouse follow-up (e.g. OIDC
 * client_credentials or signed deep links). User provisioning and programmatic
 * tokens use `POST /api/v1/apps/{app_id}/users` and `.../token` with a
 * confidential client when scopes and auth are enabled on PymtHouse.
 */

const TRAILING_SLASH = /\/+$/;

/**
 * Public marketplace / plans UI on PymtHouse. Set in deployment env.
 * Example: https://pymthouse.io/marketplace
 */
export function getPymthouseMarketplaceUrl(): string | null {
  const direct = process.env.PYMTHOUSE_MARKETPLACE_URL?.trim();
  if (direct) {
    return direct.replace(TRAILING_SLASH, '');
  }
  const issuer = process.env.PYMTHOUSE_ISSUER_URL?.trim().replace(TRAILING_SLASH, '');
  if (issuer) {
    try {
      const u = new URL(issuer);
      if (u.hostname.startsWith('api.')) {
        u.hostname = u.hostname.slice(4);
      }
      u.pathname = '/marketplace';
      u.search = '';
      u.hash = '';
      return u.toString().replace(TRAILING_SLASH, '');
    } catch {
      return null;
    }
  }
  return null;
}

/** Base URL for NaaP plan-builder JSON (same origin in prod). */
export function getNaapPlanBuilderBaseUrl(): string {
  const v = process.env.NAAP_PLAN_BUILDER_API_BASE?.trim();
  if (v) return v.replace(TRAILING_SLASH, '');
  const app = process.env.BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN?.trim();
  if (app) return app.replace(TRAILING_SLASH, '');
  return '';
}
