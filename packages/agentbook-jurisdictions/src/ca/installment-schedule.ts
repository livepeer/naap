import type { InstallmentSchedule, InstallmentDeadline } from '../interfaces.js';

export const caInstallmentSchedule: InstallmentSchedule = {
  getDeadlines(taxYear: number): InstallmentDeadline[] {
    return [
      { quarter: 1, deadline: new Date(taxYear, 2, 15), label: 'Q1 Instalment' },  // March 15
      { quarter: 2, deadline: new Date(taxYear, 5, 15), label: 'Q2 Instalment' },  // June 15
      { quarter: 3, deadline: new Date(taxYear, 8, 15), label: 'Q3 Instalment' },  // September 15
      { quarter: 4, deadline: new Date(taxYear, 11, 15), label: 'Q4 Instalment' }, // December 15
    ];
  },
  calculateAmount(method: string, ytdIncomeCents: number, priorYearTaxCents: number): number {
    if (method === 'current_year') {
      // Estimate based on current-year income, rough 30% combined rate
      return Math.round(ytdIncomeCents * 0.25 * 0.30);
    }
    // Prior-year method: divide prior year tax owing by 4
    return Math.round(priorYearTaxCents / 4);
  },
};
