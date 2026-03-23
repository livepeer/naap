import type { MileageRateProvider, MileageRate } from '../interfaces.js';

// CRA automobile allowance rates (per km)
// 2025: $0.72 for the first 5,000 km, $0.66 for each additional km
const FIRST_TIER_RATES: Record<number, number> = { 2025: 0.72, 2026: 0.72 };
const SECOND_TIER_RATES: Record<number, number> = { 2025: 0.66, 2026: 0.66 };
const TIER_THRESHOLD_KM = 5000;

export const caMileageRate: MileageRateProvider = {
  getRate(taxYear: number, totalKm: number): MileageRate {
    const firstRate = FIRST_TIER_RATES[taxYear] ?? 0.72;
    const secondRate = SECOND_TIER_RATES[taxYear] ?? 0.66;

    if (totalKm <= TIER_THRESHOLD_KM) {
      return {
        rate: firstRate,
        unit: 'km',
        tierDescription: `First ${TIER_THRESHOLD_KM} km at $${firstRate}/km`,
      };
    }

    // Blended rate for total distance
    const firstTierAmount = TIER_THRESHOLD_KM * firstRate;
    const secondTierAmount = (totalKm - TIER_THRESHOLD_KM) * secondRate;
    const blendedRate = (firstTierAmount + secondTierAmount) / totalKm;

    return {
      rate: Math.round(blendedRate * 100) / 100,
      unit: 'km',
      tierDescription: `$${firstRate}/km for first ${TIER_THRESHOLD_KM} km, $${secondRate}/km thereafter`,
    };
  },
};
