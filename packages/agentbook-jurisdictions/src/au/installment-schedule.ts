import type { InstallmentSchedule, InstallmentDeadline } from '../interfaces.js';

// PAYG Instalments — quarterly payments towards expected annual income tax
// Australian financial year: July 1 — June 30
export const auInstallmentSchedule: InstallmentSchedule = {
  getDeadlines(taxYear: number): InstallmentDeadline[] {
    return [
      { quarter: 1, deadline: new Date(taxYear, 9, 28), label: 'PAYG Q1 Instalment (Jul-Sep)' },      // October 28
      { quarter: 2, deadline: new Date(taxYear + 1, 1, 28), label: 'PAYG Q2 Instalment (Oct-Dec)' },   // February 28
      { quarter: 3, deadline: new Date(taxYear + 1, 3, 28), label: 'PAYG Q3 Instalment (Jan-Mar)' },   // April 28
      { quarter: 4, deadline: new Date(taxYear + 1, 6, 28), label: 'PAYG Q4 Instalment (Apr-Jun)' },   // July 28
    ];
  },
  calculateAmount(method: string, ytdIncomeCents: number, priorYearTaxCents: number): number {
    if (method === 'current_year') {
      // Estimate based on current-year income, rough 30% combined rate (income tax + Medicare)
      return Math.round(ytdIncomeCents * 0.25 * 0.30);
    }
    // Prior-year method (instalment amount from ATO notice): divide prior year tax by 4
    return Math.round(priorYearTaxCents / 4);
  },
};
