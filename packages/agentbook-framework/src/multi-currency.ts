/**
 * Multi-Currency Support — Exchange rate conversion and display.
 * MVP: USD + CAD as base currencies.
 * Phase 5+: Any base currency, cross-currency transactions.
 */

export interface ExchangeRate {
  from: string;
  to: string;
  rate: number;
  date: string;
  source: string;
}

export interface CurrencyAmount {
  amountCents: number;
  currency: string;
  originalAmountCents?: number;
  originalCurrency?: string;
  exchangeRate?: number;
}

// Hardcoded rates for MVP (in production, fetch from exchange rate API via service-gateway)
const EXCHANGE_RATES: Record<string, Record<string, number>> = {
  USD: { CAD: 1.37, GBP: 0.79, EUR: 0.92, AUD: 1.54 },
  CAD: { USD: 0.73, GBP: 0.58, EUR: 0.67, AUD: 1.12 },
  GBP: { USD: 1.27, CAD: 1.73, EUR: 1.17, AUD: 1.95 },
  EUR: { USD: 1.09, CAD: 1.49, GBP: 0.86, AUD: 1.67 },
  AUD: { USD: 0.65, CAD: 0.89, GBP: 0.51, EUR: 0.60 },
};

export function getExchangeRate(from: string, to: string): number {
  if (from === to) return 1.0;
  return EXCHANGE_RATES[from]?.[to] || 1.0;
}

export function convertCurrency(amountCents: number, from: string, to: string): CurrencyAmount {
  if (from === to) {
    return { amountCents, currency: to };
  }

  const rate = getExchangeRate(from, to);
  const convertedCents = Math.round(amountCents * rate);

  return {
    amountCents: convertedCents,
    currency: to,
    originalAmountCents: amountCents,
    originalCurrency: from,
    exchangeRate: rate,
  };
}

export function getSupportedCurrencies(): string[] {
  return Object.keys(EXCHANGE_RATES);
}

export function formatCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    USD: '$', CAD: 'C$', GBP: '\u00a3', EUR: '\u20ac', AUD: 'A$',
  };
  return symbols[currency] || currency;
}
