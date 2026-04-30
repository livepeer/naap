import type { MileageRateProvider } from '../interfaces.js';

const RATES: Record<number, number> = { 2025: 0.70, 2026: 0.70 }; // $/mile

export const usMileageRate: MileageRateProvider = {
  getRate(taxYear: number, totalMiles: number) {
    return { rate: RATES[taxYear] ?? 0.70, unit: 'mile' as const };
  },
};
