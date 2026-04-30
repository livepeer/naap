import type { ContractorReportGenerator, ContractorReport } from '../interfaces.js';

// Taxable Payments Annual Report (TPAR) — required for certain industries
// Businesses in building/construction, cleaning, courier, IT, security, road freight
// must report payments to contractors
export const auContractorReport: ContractorReportGenerator = {
  threshold: 0, // All contractor payments in reportable industries must be included
  formId: 'TPAR',
  generate(payments, taxYear): ContractorReport[] {
    return payments.map(p => ({
      contractorName: p.name,
      totalPaidCents: p.totalCents,
      formId: 'TPAR',
    }));
  },
};
