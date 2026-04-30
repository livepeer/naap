import type { SalesTaxEngine, SalesTaxRate, SalesTaxResult } from '../interfaces.js';

// Australia GST: flat 10% on most goods and services
// Some items are GST-free (e.g., basic food, health, education)
const GST_CATEGORIES: Record<string, { components: { type: string; rate: number; name: string }[] }> = {
  'standard': { components: [{ type: 'GST', rate: 0.10, name: 'GST' }] },
  'gst-free': { components: [{ type: 'GST', rate: 0.00, name: 'GST-Free' }] },
  'input-taxed': { components: [{ type: 'GST', rate: 0.00, name: 'Input Taxed (no GST credit)' }] },
};

export const auSalesTax: SalesTaxEngine = {
  getRates(region: string): SalesTaxRate[] {
    // Australia has uniform GST — region param used for category (standard/gst-free/input-taxed)
    const category = GST_CATEGORIES[region.toLowerCase()] || GST_CATEGORIES['standard'];
    return category.components.map(c => ({
      region: 'AU',
      taxType: c.type,
      rate: c.rate,
      name: c.name,
    }));
  },

  calculateTax(amountCents: number, region: string): SalesTaxResult {
    const category = GST_CATEGORIES[region.toLowerCase()] || GST_CATEGORIES['standard'];

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
    // BAS (Business Activity Statement) quarterly deadlines
    // Australian financial year runs July 1 — June 30
    return [
      new Date(taxYear, 9, 28),     // Q1 (Jul-Sep): October 28
      new Date(taxYear + 1, 1, 28), // Q2 (Oct-Dec): February 28
      new Date(taxYear + 1, 3, 28), // Q3 (Jan-Mar): April 28
      new Date(taxYear + 1, 6, 28), // Q4 (Apr-Jun): July 28
    ];
  },
};
