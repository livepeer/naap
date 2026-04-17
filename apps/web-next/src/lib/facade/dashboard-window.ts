/**
 * OpenAPI `DashboardWindow` query value for dashboard endpoints (`window` param).
 *
 * @see openapi.yaml components/parameters/DashboardWindow — e.g. 1h, 24h, 7d; max 168h.
 */

/**
 * Prefer `Xd` for multi-day windows (OpenAPI examples include `7d`; single-day stays `24h`).
 */
export function formatDashboardWindow(hours: number): string {
  if (hours >= 48 && hours % 24 === 0) {
    const days = hours / 24;
    if (days >= 2 && days <= 7) {
      return `${days}d`;
    }
  }
  return `${hours}h`;
}

/**
 * Larger `window` values can exceed the default 30s upstream fetch budget; keep below route
 * `maxDuration` (see dashboard/kpi/route.ts).
 */
export function dashboardUpstreamTimeoutMs(hours: number): number {
  if (hours <= 24) {
    return 30_000;
  }
  if (hours <= 72) {
    return 55_000;
  }
  return 55_000;
}
