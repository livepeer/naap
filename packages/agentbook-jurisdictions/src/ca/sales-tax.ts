import type { SalesTaxEngine, SalesTaxRate, SalesTaxResult } from '../interfaces.js';

interface ProvinceTax {
  components: { type: string; rate: number; name: string }[];
}

const PROVINCE_TAXES: Record<string, ProvinceTax> = {
  'AB': { components: [{ type: 'GST', rate: 0.05, name: 'GST' }] },
  'BC': { components: [{ type: 'GST', rate: 0.05, name: 'GST' }, { type: 'PST', rate: 0.07, name: 'BC PST' }] },
  'SK': { components: [{ type: 'GST', rate: 0.05, name: 'GST' }, { type: 'PST', rate: 0.06, name: 'SK PST' }] },
  'MB': { components: [{ type: 'GST', rate: 0.05, name: 'GST' }, { type: 'PST', rate: 0.07, name: 'MB RST' }] },
  'ON': { components: [{ type: 'HST', rate: 0.13, name: 'ON HST' }] },
  'QC': { components: [{ type: 'GST', rate: 0.05, name: 'GST' }, { type: 'PST', rate: 0.09975, name: 'QC QST' }] },
  'NB': { components: [{ type: 'HST', rate: 0.15, name: 'NB HST' }] },
  'NS': { components: [{ type: 'HST', rate: 0.15, name: 'NS HST' }] },
  'NL': { components: [{ type: 'HST', rate: 0.15, name: 'NL HST' }] },
  'PE': { components: [{ type: 'HST', rate: 0.15, name: 'PE HST' }] },
  'NT': { components: [{ type: 'GST', rate: 0.05, name: 'GST' }] },
  'NU': { components: [{ type: 'GST', rate: 0.05, name: 'GST' }] },
  'YT': { components: [{ type: 'GST', rate: 0.05, name: 'GST' }] },
};

export const caSalesTax: SalesTaxEngine = {
  getRates(region: string): SalesTaxRate[] {
    const province = PROVINCE_TAXES[region.toUpperCase()];
    if (!province) return [];
    return province.components.map(c => ({
      region,
      taxType: c.type,
      rate: c.rate,
      name: c.name,
    }));
  },

  calculateTax(amountCents: number, region: string): SalesTaxResult {
    const province = PROVINCE_TAXES[region.toUpperCase()];
    if (!province) {
      return { totalRate: 0, totalCents: 0, components: [] };
    }

    const components = province.components.map(c => ({
      type: c.type,
      rate: c.rate,
      amountCents: Math.round(amountCents * c.rate),
    }));

    const totalCents = components.reduce((sum, c) => sum + c.amountCents, 0);
    const totalRate = province.components.reduce((sum, c) => sum + c.rate, 0);

    return { totalRate, totalCents, components };
  },

  getFilingDeadlines(region: string, taxYear: number): Date[] {
    // GST/HST filing deadlines — quarterly for most small businesses
    return [
      new Date(taxYear, 3, 30),   // Q1: April 30
      new Date(taxYear, 6, 31),   // Q2: July 31
      new Date(taxYear, 9, 31),   // Q3: October 31
      new Date(taxYear + 1, 0, 31), // Q4: January 31
    ];
  },
};
