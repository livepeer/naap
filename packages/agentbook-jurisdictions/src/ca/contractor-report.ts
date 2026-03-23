import type { ContractorReportGenerator, ContractorReport } from '../interfaces.js';

export const caContractorReport: ContractorReportGenerator = {
  threshold: 50000, // $500 CAD in cents
  formId: 'T4A',
  generate(payments, taxYear): ContractorReport[] {
    return payments
      .filter(p => p.totalCents >= 50000)
      .map(p => ({ contractorName: p.name, totalPaidCents: p.totalCents, formId: 'T4A' }));
  },
};
