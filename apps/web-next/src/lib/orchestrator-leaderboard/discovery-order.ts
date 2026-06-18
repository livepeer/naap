/**
 * Tiered randomization for python-gateway discovery responses.
 *
 * Keeps global preference order by splitting the ranked list into consecutive
 * tiers, then shuffles only within each tier so repeat requests spread across
 * comparable orchestrators.
 */

export type RandomSource = () => number;

function shuffleInPlace<T>(items: T[], random: RandomSource): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

/**
 * Split `n` items into `tierCount` consecutive index ranges (as equal as possible).
 */
export function tierIndexRanges(n: number, tierCount: number): Array<{ start: number; end: number }> {
  const k = Math.max(1, Math.min(tierCount, Math.max(1, n)));
  const base = Math.floor(n / k);
  const rem = n % k;
  const ranges: Array<{ start: number; end: number }> = [];
  let idx = 0;
  for (let i = 0; i < k; i += 1) {
    const size = base + (i < rem ? 1 : 0);
    const end = idx + size;
    ranges.push({ start: idx, end });
    idx = end;
  }
  return ranges;
}

/**
 * Choose a tier count close to `requested` while keeping average tier size at
 * least 2 when possible, so small lists still get within-tier shuffles.
 */
export function effectiveDiscoveryTierCount(n: number, requested: number): number {
  if (n <= 1) {
    return 1;
  }
  const targetSize = Math.max(2, Math.ceil(n / requested));
  return Math.min(n, Math.max(1, Math.ceil(n / targetSize)));
}

export interface TieredShuffleDiscoveryOptions {
  /** Number of ordered tiers (default 5). Capped by list length. */
  tierCount?: number;
  /** RNG returning values in [0, 1); defaults to `Math.random`. */
  random?: RandomSource;
}

/**
 * De-duplicate addresses (first occurrence wins), then shuffle within each tier.
 */
export function tieredShuffleDiscoveryAddresses(
  orderedAddresses: string[],
  options?: TieredShuffleDiscoveryOptions,
): string[] {
  const tierCount = options?.tierCount ?? 5;
  const random = options?.random ?? Math.random;

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of orderedAddresses) {
    const a = raw.trim();
    if (!a || seen.has(a)) {
      continue;
    }
    seen.add(a);
    unique.push(a);
  }

  const n = unique.length;
  if (n <= 1) {
    return unique;
  }

  const k = effectiveDiscoveryTierCount(n, tierCount);
  const ranges = tierIndexRanges(n, k);
  for (const { start, end } of ranges) {
    if (end <= start) {
      continue;
    }
    const slice = unique.slice(start, end);
    shuffleInPlace(slice, random);
    for (let i = 0; i < slice.length; i += 1) {
      unique[start + i] = slice[i]!;
    }
  }

  return unique;
}

/**
 * Tiered shuffle where a static-fleet fallback joins the shuffle (NAAP-9).
 *
 * Live-ranked `discovered` addresses keep their order and are tiered first;
 * `staticFallback` addresses not already discovered are appended so they land
 * in the lowest tier — present (never silently dropped) but not displacing
 * live-ranked orchestrators. De-duplication is first-occurrence wins.
 */
export function tieredShuffleWithStaticFallback(
  discovered: string[],
  staticFallback: string[],
  options?: TieredShuffleDiscoveryOptions,
): string[] {
  // Tier the live-ranked discovered set first so it owns the top tiers, then
  // append static-fallback addresses (not already discovered) shuffled among
  // themselves. This keeps fallback in the lowest tier — present but never
  // displacing live-ranked orchestrators via within-tier shuffling.
  const shuffledDiscovered = tieredShuffleDiscoveryAddresses([...discovered], options);

  const seen = new Set(shuffledDiscovered.map((a) => a.trim()).filter(Boolean));
  const staticOnly: string[] = [];
  for (const raw of staticFallback) {
    const a = raw.trim();
    if (!a || seen.has(a)) continue;
    seen.add(a);
    staticOnly.push(a);
  }

  const shuffledStatic = tieredShuffleDiscoveryAddresses(staticOnly, options);
  return [...shuffledDiscovered, ...shuffledStatic];
}
