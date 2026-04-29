/**
 * LPT/USD and ETH/USD from public exchange APIs (no API keys).
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

/** ETH vs USD/USDT — Binance ETHUSDT, then Kraken XETHZUSD. */
export async function fetchEthUsdFromPublicExchanges(): Promise<number | null> {
  const b = await fetchBinanceLastPrice('ETHUSDT');
  if (b != null) return b;
  return fetchKrakenTickerClose('XETHZUSD');
}

const KRAKEN_LPT_USD_PAIRS = ['LPTUSD', 'XLPTZUSD'] as const;

/** LPT vs USD/USDT — Binance LPTUSDT, then Kraken LPT pairs. */
export async function fetchLptUsdFromPublicExchanges(): Promise<number | null> {
  const b = await fetchBinanceLastPrice('LPTUSDT');
  if (b != null) return b;
  for (const pair of KRAKEN_LPT_USD_PAIRS) {
    const v = await fetchKrakenTickerClose(pair);
    if (v != null) return v;
  }
  return null;
}

/** Binance 24h rolling stats; `priceChangePercent` matches CoinGecko-style % vs open. */
export async function fetchLptUsd24hChangePercent(): Promise<number | null> {
  try {
    const res = await fetch(`${BINANCE_API}/ticker/24hr?symbol=LPTUSDT`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { priceChangePercent?: string };
    const n = j.priceChangePercent != null ? Number(j.priceChangePercent) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Daily LPT/USD closes from Binance klines (UTC day open times as timestamps).
 * Best-effort when Binance is reachable; otherwise [].
 */
export async function fetchLptUsdDailyCloseChart(
  days: number,
): Promise<Array<{ timestamp: number; price: number }>> {
  const limit = Math.min(Math.max(1, Math.ceil(days)), 1000);
  try {
    const res = await fetch(
      `${BINANCE_API}/klines?symbol=LPTUSDT&interval=1d&limit=${limit}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as unknown[][];
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => ({
        timestamp: Number(row[0]),
        price: Number(row[4]),
      }))
      .filter((p) => Number.isFinite(p.timestamp) && Number.isFinite(p.price) && p.price > 0);
  } catch {
    return [];
  }
}
