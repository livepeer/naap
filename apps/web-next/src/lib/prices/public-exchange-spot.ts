/**
 * ETH/USD from public exchange APIs (no API keys).
 *
 * Binance is tried first; Kraken public ticker is the fallback. USDT prices
 * are treated as USD for spot estimates.
 */

const BINANCE_API = 'https://api.binance.com/api/v3';

const FETCH_TIMEOUT_MS = 3000;

async function fetchBinanceLastPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`${BINANCE_API}/ticker/price?symbol=${encodeURIComponent(symbol)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { price?: string };
    const n = j.price != null ? Number(j.price) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function fetchKrakenTickerClose(pair: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(pair)}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      error?: string[];
      result?: Record<string, { c?: [string, string] }>;
    };
    if (json.error && json.error.length > 0) return null;
    const result = json.result;
    if (!result) return null;
    const key = Object.keys(result)[0];
    if (!key) return null;
    const last = result[key]?.c?.[0];
    const n = last != null ? Number(last) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Which public venue produced a spot quote (for provenance / logging). */
export type PublicExchangeSpotSource = 'binance' | 'kraken';

/** ETH vs USD/USDT — Binance ETHUSDT, then Kraken XETHZUSD. */
export async function fetchEthUsdFromPublicExchangesWithSource(): Promise<{
  price: number | null;
  source: PublicExchangeSpotSource | null;
}> {
  const b = await fetchBinanceLastPrice('ETHUSDT');
  if (b != null) return { price: b, source: 'binance' };
  const k = await fetchKrakenTickerClose('XETHZUSD');
  if (k != null) return { price: k, source: 'kraken' };
  return { price: null, source: null };
}

/** ETH vs USD/USDT — Binance ETHUSDT, then Kraken XETHZUSD. */
export async function fetchEthUsdFromPublicExchanges(): Promise<number | null> {
  const { price } = await fetchEthUsdFromPublicExchangesWithSource();
  return price;
}
