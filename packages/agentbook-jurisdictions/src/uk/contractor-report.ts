import type { ContractorReportGenerator, ContractorReport } from '../interfaces.js';

// UK Construction Industry Scheme (CIS) — simplified
// Contractors must deduct tax from payments to subcontractors and report to HMRC
export const ukContractorReport: ContractorReportGenerator = {
  threshold: 0, // CIS applies to all construction subcontractor payments
  formId: 'CIS300',
  generate(payments, taxYear): ContractorReport[] {
    // All subcontractor payments in construction are reportable under CIS
    return payments.map(p => ({
      contractorName: p.name,
      totalPaidCents: p.totalCents,
      formId: 'CIS300',
    }));
  },
};
