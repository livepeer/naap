import type { SalesTaxEngine, SalesTaxRate, SalesTaxResult } from '../interfaces.js';

const STATE_RATES: Record<string, number> = {
  'CA': 0.0725, 'NY': 0.04, 'TX': 0.0625, 'FL': 0.06, 'WA': 0.065,
  'IL': 0.0625, 'PA': 0.06, 'OH': 0.0575, 'GA': 0.04, 'NC': 0.0475,
  'OR': 0, 'NH': 0, 'MT': 0, 'DE': 0, 'AK': 0,
};

export const usSalesTax: SalesTaxEngine = {
  getRates(region: string): SalesTaxRate[] {
    const rate = STATE_RATES[region.toUpperCase()] ?? 0;
    return rate > 0 ? [{ region, taxType: 'state', rate, name: `${region} State Tax` }] : [];
  },
  calculateTax(amountCents: number, region: string): SalesTaxResult {
    const rate = STATE_RATES[region.toUpperCase()] ?? 0;
    const taxCents = Math.round(amountCents * rate);
    return {
      totalRate: rate,
      totalCents: taxCents,
      components: rate > 0 ? [{ type: 'state', rate, amountCents: taxCents }] : [],
    };
  },
  getFilingDeadlines(region: string, taxYear: number): Date[] {
    // Quarterly filing for most states
    return [
      new Date(taxYear, 3, 30), new Date(taxYear, 6, 31),
      new Date(taxYear, 9, 31), new Date(taxYear + 1, 0, 31),
    ];
  },
};
