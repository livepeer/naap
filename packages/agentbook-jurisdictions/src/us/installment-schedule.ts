import type { InstallmentSchedule, InstallmentDeadline } from '../interfaces.js';

export const usInstallmentSchedule: InstallmentSchedule = {
  getDeadlines(taxYear: number): InstallmentDeadline[] {
    return [
      { quarter: 1, deadline: new Date(taxYear, 3, 15), label: 'Q1 Estimated Tax' },
      { quarter: 2, deadline: new Date(taxYear, 5, 15), label: 'Q2 Estimated Tax' },
      { quarter: 3, deadline: new Date(taxYear, 8, 15), label: 'Q3 Estimated Tax' },
      { quarter: 4, deadline: new Date(taxYear + 1, 0, 15), label: 'Q4 Estimated Tax' },
    ];
  },
  calculateAmount(method: string, ytdIncomeCents: number, priorYearTaxCents: number): number {
    if (method === 'annualized') {
      return Math.round(ytdIncomeCents * 0.25 * 0.30); // rough 30% rate
    }
    // Safe harbor: 100% of prior year (110% if AGI > $150k)
    return Math.round(priorYearTaxCents / 4);
  },
};
