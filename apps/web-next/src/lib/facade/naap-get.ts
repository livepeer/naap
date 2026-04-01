/**
 * Shared NAAP API fetch helper for facade resolvers.
 *
 * Builds the upstream URL via naapApiUpstreamUrl, appends optional query
 * params, and fetches with a 60-second Next.js revalidation window.
 */

import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';

export async function naapGet<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(naapApiUpstreamUrl(path));
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) {
    throw new Error(`[facade/naap-get] ${path} returned HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
