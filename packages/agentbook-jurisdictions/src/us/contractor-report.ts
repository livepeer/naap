import type { ContractorReportGenerator, ContractorReport } from '../interfaces.js';

export const usContractorReport: ContractorReportGenerator = {
  threshold: 60000, // $600 in cents
  formId: '1099-NEC',
  generate(payments, taxYear): ContractorReport[] {
    return payments
      .filter(p => p.totalCents >= 60000)
      .map(p => ({ contractorName: p.name, totalPaidCents: p.totalCents, formId: '1099-NEC' }));
  },
};
