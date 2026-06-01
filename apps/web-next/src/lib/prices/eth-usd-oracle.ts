/**
 * ETH/USD reference for dashboard pricing conversions.
 *
 * Order: in-process TTL coalesce (see {@link cachedFetch}) → public exchange
 * spot (Binance/Kraken) → `ETH_USD_PRICE` env (default 3000).
 *
 * Dashboard BFF `/api/v1/dashboard/eth-usd` also uses `bffStaleWhileRevalidate`
 * for cross-instance caching.
 */

import { cachedFetch } from '@/lib/facade/cache.js';
import { fetchEthUsdFromPublicExchanges } from './public-exchange-spot.js';

const ORACLE_CACHE_KEY = 'ethUsdOracle:v1';
/** Coalesce concurrent callers and limit upstream exchange hits per instance. */
const ORACLE_TTL_MS = 5 * 60 * 1000;

function parseEthUsdFromEnv(): number {
  const raw = process.env.ETH_USD_PRICE?.trim();
  if (!raw) return 3000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 3000;
  return n;
}

/**
 * Best-effort ETH/USD (USD per 1 ETH) for server-side pricing displays.
 */
export async function getEthUsdOracle(): Promise<number> {
  return cachedFetch(ORACLE_CACHE_KEY, ORACLE_TTL_MS, async () => {
    try {
      const live = await fetchEthUsdFromPublicExchanges();
      if (live != null && Number.isFinite(live) && live > 0) return live;
    } catch {
      /* fall through to env */
    }
    return parseEthUsdFromEnv();
  });
}
