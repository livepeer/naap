import type { InstallmentSchedule, InstallmentDeadline } from '../interfaces.js';

// UK Payments on Account — two payments per year (Jan 31 and Jul 31)
export const ukInstallmentSchedule: InstallmentSchedule = {
  getDeadlines(taxYear: number): InstallmentDeadline[] {
    return [
      { quarter: 1, deadline: new Date(taxYear + 1, 0, 31), label: 'First Payment on Account' },  // January 31
      { quarter: 2, deadline: new Date(taxYear + 1, 6, 31), label: 'Second Payment on Account' }, // July 31
    ];
  },
  calculateAmount(method: string, ytdIncomeCents: number, priorYearTaxCents: number): number {
    if (method === 'current_year') {
      // Estimate based on current-year income, rough 30% combined rate (income tax + NI)
      return Math.round(ytdIncomeCents * 0.30 / 2);
    }
    // Prior-year method: each payment on account is half of previous year's tax bill
    return Math.round(priorYearTaxCents / 2);
  },
};
