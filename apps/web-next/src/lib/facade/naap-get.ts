/**
 * Shared NAAP API fetch helper for facade resolvers.
 *
 * Builds the upstream URL via naapApiUpstreamUrl, optional query params, and
 * fetches with Next.js cache hints (or no-store) and a bounded timeout.
 */

import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_REVALIDATE_SEC = 60;

export type NaapGetOptions = {
  /** Next.js segment cache revalidate (seconds). Ignored when {@link NaapGetOptions.cache} is `no-store`. */
  next?: { revalidate: number };
  cache?: RequestCache;
  timeoutMs?: number;
  /** Replaces default `naap-get` in error messages (e.g. `kpi`, `pipelines`). */
  errorLabel?: string;
};

export async function naapGet<T>(
  path: string,
  params?: Record<string, string>,
  options?: NaapGetOptions,
): Promise<T> {
  const url = new URL(naapApiUpstreamUrl(path));
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const label = options?.errorLabel ?? 'naap-get';
  const init = {
    signal: AbortSignal.timeout(timeoutMs),
    ...(options?.cache === 'no-store'
      ? { cache: 'no-store' as const }
      : { next: { revalidate: options?.next?.revalidate ?? DEFAULT_REVALIDATE_SEC } }),
  } as RequestInit & { next?: { revalidate: number } };

  const res = await fetch(url.toString(), init);
  if (!res.ok) {
    throw new Error(`[facade/${label}] ${path} returned HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
