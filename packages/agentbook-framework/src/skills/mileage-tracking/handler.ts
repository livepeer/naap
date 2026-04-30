/**
 * Mileage Tracking — IRS standard rate (US) or CRA tiered rate (CA).
 */

export interface MileageEntry {
  date: string;
  distance: number; // miles or km
  purpose: string;
  fromLocation?: string;
  toLocation?: string;
}

export interface MileageDeduction {
  totalDistance: number;
  unit: 'mile' | 'km';
  rate: number;
  deductionCents: number;
  entries: number;
  jurisdiction: string;
}

export function calculateMileageDeduction(
  entries: MileageEntry[],
  jurisdiction: string,
  taxYear: number,
): MileageDeduction {
  const totalDistance = entries.reduce((s, e) => s + e.distance, 0);

  if (jurisdiction === 'ca') {
    // CRA tiered: $0.72/km first 5000, $0.66 after
    const tier1 = Math.min(totalDistance, 5000);
    const tier2 = Math.max(0, totalDistance - 5000);
    const deduction = Math.round(tier1 * 72 + tier2 * 66); // cents
    return { totalDistance, unit: 'km', rate: totalDistance <= 5000 ? 0.72 : 0.66, deductionCents: deduction, entries: entries.length, jurisdiction };
  }

  // US: flat rate $0.70/mile (2025)
  const rate = 70; // cents per mile
  return { totalDistance, unit: 'mile', rate: 0.70, deductionCents: Math.round(totalDistance * rate), entries: entries.length, jurisdiction };
}
