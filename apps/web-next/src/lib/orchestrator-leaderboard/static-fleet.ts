/**
 * NAAP-9 — Static-fleet fallback.
 *
 * ClickHouse discovery (`semantic.network_capabilities`, warm rows in the last
 * hour) silently drops orchestrators that lack warm rows for a requested
 * capability — e.g. the scope staging orchs (`orch-staging-1/2/3`) when they
 * have no warm `scope` rows. The static fleet is the known-good fallback set
 * (mirrors `simple-infra/discovery/staging.json` + `fleet.yaml`, plus the BYOC
 * tool host) so the Daydream→NaaP switch never loses an orchestrator.
 *
 * The static fleet is a property of the PLAN (provider-agnostic), not of
 * Storyboard. The addresses come from each plan category's `staticOrchestrators`.
 */

/** Normalize an address: trim and drop empties. */
function normalizeAddress(raw: string): string {
  return raw.trim();
}

/**
 * Merge a discovered, ranked address list with a static-fleet fallback.
 *
 * Discovered addresses keep their (ranked) order and come first; static-fleet
 * addresses not already discovered are appended (so they land in the lowest
 * tier of the subsequent tier shuffle, never displacing live-ranked orchs).
 * The result is de-duplicated, first-occurrence wins.
 */
export function mergeStaticFleet(
  discovered: readonly string[],
  staticFallback: readonly string[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const raw of [...discovered, ...staticFallback]) {
    const address = normalizeAddress(raw);
    if (!address || seen.has(address)) {
      continue;
    }
    seen.add(address);
    merged.push(address);
  }

  return merged;
}

/**
 * Returns the static-fleet addresses that are MISSING from the discovered set.
 * Useful for structured logging (how many fallbacks were injected) without
 * leaking the full address list.
 */
export function staticFleetGaps(
  discovered: readonly string[],
  staticFallback: readonly string[],
): string[] {
  const discoveredSet = new Set(discovered.map(normalizeAddress).filter(Boolean));
  const gaps: string[] = [];
  const seen = new Set<string>();
  for (const raw of staticFallback) {
    const address = normalizeAddress(raw);
    if (!address || discoveredSet.has(address) || seen.has(address)) {
      continue;
    }
    seen.add(address);
    gaps.push(address);
  }
  return gaps;
}
