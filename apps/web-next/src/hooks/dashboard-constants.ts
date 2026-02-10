/**
 * Dashboard Event Bus Constants
 *
 * Duplicated from @naap/plugin-sdk/contracts/dashboard to avoid runtime
 * imports from the SDK package in the Next.js app (which can't resolve
 * the SDK's .js extension imports during webpack compilation).
 *
 * These MUST stay in sync with the SDK definitions. The SDK contract
 * tests validate the canonical values.
 */

/** Event name for dashboard GraphQL queries (request/response) */
export const DASHBOARD_QUERY_EVENT = 'dashboard:query' as const;

/** Event name for subscribing to the live job feed stream */
export const DASHBOARD_JOB_FEED_EVENT = 'dashboard:job-feed:subscribe' as const;

/** Event name for job feed entries emitted via event bus (local/dev fallback) */
export const DASHBOARD_JOB_FEED_EMIT_EVENT = 'dashboard:job-feed:event' as const;
