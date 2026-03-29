/**
 * GPS Mileage Tracking — Background location tracking via Service Worker.
 * Auto-detects trips (movement start/stop).
 * Calculates deduction at jurisdiction rate (IRS/CRA/HMRC/ATO).
 */

export interface MileageTrip {
  id: string;
  tenantId: string;
  startTime: string;
  endTime?: string;
  startLocation?: { lat: number; lng: number };
  endLocation?: { lat: number; lng: number };
  distanceMiles: number;
  distanceKm: number;
  purpose: 'business' | 'personal' | 'unclassified';
  deductionCents: number;
  jurisdiction: string;
}

export interface MileageRate {
  jurisdiction: string;
  ratePerMile: number;
  ratePerKm: number;
  year: number;
}

const RATES: Record<string, MileageRate> = {
  us: { jurisdiction: 'us', ratePerMile: 0.70, ratePerKm: 0.435, year: 2025 },
  ca: { jurisdiction: 'ca', ratePerMile: 0, ratePerKm: 0.72, year: 2025 }, // tiered
  uk: { jurisdiction: 'uk', ratePerMile: 0.45, ratePerKm: 0.28, year: 2025 },
  au: { jurisdiction: 'au', ratePerMile: 0, ratePerKm: 0.88, year: 2025 },
};

export function calculateMileageDeduction(
  distanceKm: number,
  jurisdiction: string,
): { deductionCents: number; rate: number; unit: string } {
  const rate = RATES[jurisdiction] || RATES.us;

  if (jurisdiction === 'us') {
    const miles = distanceKm * 0.621371;
    return { deductionCents: Math.round(miles * rate.ratePerMile * 100), rate: rate.ratePerMile, unit: 'mile' };
  }

  if (jurisdiction === 'ca') {
    // Tiered: $0.72/km first 5000, $0.66 after
    const tier1 = Math.min(distanceKm, 5000);
    const tier2 = Math.max(0, distanceKm - 5000);
    const cents = Math.round(tier1 * 72 + tier2 * 66);
    return { deductionCents: cents, rate: distanceKm <= 5000 ? 0.72 : 0.66, unit: 'km' };
  }

  if (jurisdiction === 'uk') {
    const miles = distanceKm * 0.621371;
    // 45p first 10,000 miles, 25p after
    const tier1 = Math.min(miles, 10000);
    const tier2 = Math.max(0, miles - 10000);
    const pence = Math.round(tier1 * 45 + tier2 * 25);
    return { deductionCents: pence, rate: miles <= 10000 ? 0.45 : 0.25, unit: 'mile' };
  }

  // Default (AU and others): flat rate per km
  return { deductionCents: Math.round(distanceKm * rate.ratePerKm * 100), rate: rate.ratePerKm, unit: 'km' };
}

/**
 * Calculate distance between two GPS coordinates (Haversine formula).
 */
export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
