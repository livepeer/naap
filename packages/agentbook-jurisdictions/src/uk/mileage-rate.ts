import type { MileageRateProvider, MileageRate } from '../interfaces.js';

// HMRC Approved Mileage Allowance Payments (AMAP)
// 45p/mile for first 10,000 miles, 25p/mile thereafter
const FIRST_TIER_RATE = 0.45;  // £0.45 per mile
const SECOND_TIER_RATE = 0.25; // £0.25 per mile
const TIER_THRESHOLD_MILES = 10000;

export const ukMileageRate: MileageRateProvider = {
  getRate(taxYear: number, totalMiles: number): MileageRate {
    if (totalMiles <= TIER_THRESHOLD_MILES) {
      return {
        rate: FIRST_TIER_RATE,
        unit: 'mile',
        tierDescription: `First ${TIER_THRESHOLD_MILES} miles at ${FIRST_TIER_RATE * 100}p/mile`,
      };
    }

    // Blended rate for total distance
    const firstTierAmount = TIER_THRESHOLD_MILES * FIRST_TIER_RATE;
    const secondTierAmount = (totalMiles - TIER_THRESHOLD_MILES) * SECOND_TIER_RATE;
    const blendedRate = (firstTierAmount + secondTierAmount) / totalMiles;

    return {
      rate: Math.round(blendedRate * 100) / 100,
      unit: 'mile',
      tierDescription: `${FIRST_TIER_RATE * 100}p/mile for first ${TIER_THRESHOLD_MILES} miles, ${SECOND_TIER_RATE * 100}p/mile thereafter`,
    };
  },
};
