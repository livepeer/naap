/**
 * Fetch LPT/USD + ETH/USD from CoinGecko → WalletPriceCache
 */

import { fetchAndCachePrices } from '../lib/priceService.js';

export async function fetchPrices(): Promise<void> {
  const prices = await fetchAndCachePrices();
  console.log(`[prices] LPT=$${prices.lptUsd} ETH=$${prices.ethUsd}`);
}
