import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';

/**
 * Assert a response was denied (401 or 403).
 *
 * Playwright's `request` fixture inherits session cookies from storageState,
 * so "unauthenticated" requests in the chromium project may actually carry a
 * valid session cookie.  The API then returns 403 (authenticated but not
 * authorised) instead of 401 (no auth).  Use this helper instead of a bare
 * `toBe(401)` so tests pass in both authenticated and anonymous contexts.
 */
export function expectDenied(
  res: APIResponse,
  context = 'Expected request to be denied (401 or 403)',
): void {
  const s = res.status();
  expect(
    s === 401 || s === 403,
    `${context}, got ${s}`,
  ).toBeTruthy();
}

/**
 * Pre-flight checks that Capacity Planner data APIs (via Next.js + Prisma) respond before plugin UI E2E.
 */
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 90_000;

export async function assertCapacityPlannerApiHealthy(
  request: APIRequestContext,
  baseURL: string,
  options?: { timeoutMs?: number },
): Promise<void> {
  const res = await request.get(`${baseURL}/api/v1/capacity-planner/summary`, {
    timeout: options?.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS,
  });
  expect(
    res.ok(),
    `GET /api/v1/capacity-planner/summary expected 2xx, got ${res.status()}`,
  ).toBeTruthy();
}

/**
 * Pre-flight checks that Community Hub data APIs respond before forum plugin E2E.
 */
export async function assertCommunityApiHealthy(
  request: APIRequestContext,
  baseURL: string,
  options?: { timeoutMs?: number },
): Promise<void> {
  const res = await request.get(`${baseURL}/api/v1/community/stats`, {
    timeout: options?.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS,
  });
  expect(
    res.ok(),
    `GET /api/v1/community/stats expected 2xx, got ${res.status()}`,
  ).toBeTruthy();
}

/**
 * Developer API models route may be public or auth-gated; accept 2xx/401/403 — fail only on 5xx.
 */
export async function assertDeveloperApiReachable(
  request: APIRequestContext,
  baseURL: string,
  options?: { timeoutMs?: number },
): Promise<void> {
  const res = await request.get(`${baseURL}/api/v1/developer/models`, {
    timeout: options?.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS,
  });
  expect(
    res.status() < 500,
    `GET /api/v1/developer/models expected non-5xx, got ${res.status()}`,
  ).toBeTruthy();
}

/** Wallet network history requires auth; without cookie expect 401/403, not 5xx. */
export async function assertWalletApiReachable(
  request: APIRequestContext,
  baseURL: string,
  options?: { timeoutMs?: number },
): Promise<void> {
  const res = await request.get(`${baseURL}/api/v1/wallet/network/history?limit=1`, {
    timeout: options?.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS,
  });
  expect(
    res.status() === 401 || res.status() === 403,
    `GET /api/v1/wallet/network/history expected 401/403 without auth, got ${res.status()}`,
  ).toBeTruthy();
}

/** Gateway list requires auth; without cookie expect 401/403, not 5xx. */
export async function assertGatewayApiReachable(
  request: APIRequestContext,
  baseURL: string,
  options?: { timeoutMs?: number },
): Promise<void> {
  const res = await request.get(`${baseURL}/api/v1/gateway`, {
    timeout: options?.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS,
  });
  expect(
    res.status() === 401 || res.status() === 403,
    `GET /api/v1/gateway expected 401/403 without auth, got ${res.status()}`,
  ).toBeTruthy();
}
