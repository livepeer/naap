import { expect, type Page, type Response } from '@playwright/test';

/**
 * Waits for the public/authenticated overview to render real widget content (not skeletons).
 */
export async function waitForDashboardData(page: Page, timeoutMs = 30_000): Promise<void> {
  const dataOrUnavailable = page.locator(
    ':text("Success Rate"), :text("Orchestrators"), :text("Unavailable")',
  );
  await expect(dataOrUnavailable.first()).toBeVisible({ timeout: timeoutMs });
}

export const DASHBOARD_API_ROUTES = [
  '/api/v1/dashboard/kpi',
  '/api/v1/dashboard/pipelines',
  '/api/v1/dashboard/pipeline-catalog',
  '/api/v1/dashboard/orchestrators',
  '/api/v1/dashboard/protocol',
  '/api/v1/dashboard/gpu-capacity',
  '/api/v1/dashboard/pricing',
  '/api/v1/dashboard/fees',
  '/api/v1/dashboard/job-feed',
] as const;

export interface ApiTiming {
  route: string;
  durationMs: number;
  cacheControl: string | null;
  vercelCache: string | null;
}

export function trackApiTimings(page: Page): ApiTiming[] {
  const timings: ApiTiming[] = [];
  const requestStartMap = new Map<string, number>();

  page.on('request', (req) => {
    try {
      const url = new URL(req.url());
      if (DASHBOARD_API_ROUTES.some((r) => url.pathname.startsWith(r))) {
        requestStartMap.set(req.url(), Date.now());
      }
    } catch {
      // ignore malformed URLs
    }
  });

  page.on('response', (response: Response) => {
    try {
      const url = new URL(response.url());
      const match = DASHBOARD_API_ROUTES.find((r) => url.pathname.startsWith(r));
      if (!match) return;

      const startMs = requestStartMap.get(response.url()) ?? 0;
      const durationMs = startMs > 0 ? Date.now() - startMs : -1;

      timings.push({
        route: match,
        durationMs,
        cacheControl: response.headers()['cache-control'] ?? null,
        vercelCache: response.headers()['x-vercel-cache'] ?? null,
      });
    } catch {
      // ignore
    }
  });

  return timings;
}

export function isPlaywrightProductionBaseUrl(): boolean {
  return !!(
    process.env.PLAYWRIGHT_BASE_URL && !process.env.PLAYWRIGHT_BASE_URL.includes('localhost')
  );
}

/** 75th percentile of a sorted or unsorted list (inclusive). */
export function percentile75(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(0.75 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
