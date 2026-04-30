import type { MileageRateProvider, MileageRate } from '../interfaces.js';

// ATO cents per kilometre method — flat rate for 2024-25
// 88 cents per km (no tiering, max 5,000 km for this method)
const ATO_RATE_PER_KM: Record<number, number> = {
  2024: 0.85,
  2025: 0.88,
  2026: 0.88,
};

const MAX_KM_CENTS_METHOD = 5000;

export const auMileageRate: MileageRateProvider = {
  getRate(taxYear: number, totalKm: number): MileageRate {
    const rate = ATO_RATE_PER_KM[taxYear] ?? 0.88;

    if (totalKm > MAX_KM_CENTS_METHOD) {
      return {
        rate,
        unit: 'km',
        tierDescription: `${rate * 100}c/km (cents per km method capped at ${MAX_KM_CENTS_METHOD} km — consider logbook method for higher distances)`,
      };
    }

    return {
      rate,
      unit: 'km',
      tierDescription: `ATO rate ${rate * 100}c/km`,
    };
  },
};
