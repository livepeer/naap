import type { SalesTaxEngine, SalesTaxRate, SalesTaxResult } from '../interfaces.js';

// UK VAT rates
interface VATCategory {
  components: { type: string; rate: number; name: string }[];
}

const VAT_CATEGORIES: Record<string, VATCategory> = {
  'standard': { components: [{ type: 'VAT', rate: 0.20, name: 'Standard Rate VAT' }] },
  'reduced': { components: [{ type: 'VAT', rate: 0.05, name: 'Reduced Rate VAT' }] },
  'zero': { components: [{ type: 'VAT', rate: 0.00, name: 'Zero Rate VAT' }] },
};

export const ukSalesTax: SalesTaxEngine = {
  getRates(region: string): SalesTaxRate[] {
    // UK has uniform VAT — region param used for rate category (standard/reduced/zero)
    const category = VAT_CATEGORIES[region.toLowerCase()] || VAT_CATEGORIES['standard'];
    return category.components.map(c => ({
      region: 'UK',
      taxType: c.type,
      rate: c.rate,
      name: c.name,
    }));
  },

  calculateTax(amountCents: number, region: string): SalesTaxResult {
    // Default to standard rate; region can specify 'reduced' or 'zero'
    const category = VAT_CATEGORIES[region.toLowerCase()] || VAT_CATEGORIES['standard'];

    const components = category.components.map(c => ({
      type: c.type,
      rate: c.rate,
      amountCents: Math.round(amountCents * c.rate),
    }));

    const totalCents = components.reduce((sum, c) => sum + c.amountCents, 0);
    const totalRate = category.components.reduce((sum, c) => sum + c.rate, 0);

    return { totalRate, totalCents, components };
  },

  getFilingDeadlines(region: string, taxYear: number): Date[] {
    // VAT Return deadlines — quarterly (Making Tax Digital)
    return [
      new Date(taxYear, 4, 7),     // Q1: May 7
      new Date(taxYear, 7, 7),     // Q2: August 7
      new Date(taxYear, 10, 7),    // Q3: November 7
      new Date(taxYear + 1, 1, 7), // Q4: February 7
    ];
  },
};
