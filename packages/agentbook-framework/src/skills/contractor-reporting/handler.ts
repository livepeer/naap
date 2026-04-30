/**
 * Contractor Reporting — Track payments to contractors.
 * US: 1099-NEC ($600 threshold), CA: T4A ($500 threshold)
 */

export interface ContractorPaymentSummary {
  contractorName: string;
  totalPaidCents: number;
  threshold: number;
  requiresReporting: boolean;
  nearThreshold: boolean; // within 90% of threshold
  jurisdiction: string;
  formId: string; // 1099-NEC or T4A
}

export async function getContractorSummaries(
  tenantId: string,
  jurisdiction: string,
  taxYear: number,
  db: any,
): Promise<ContractorPaymentSummary[]> {
  const yearStart = new Date(taxYear, 0, 1);
  const yearEnd = new Date(taxYear, 11, 31);
  const threshold = jurisdiction === 'ca' ? 50000 : 60000; // cents
  const formId = jurisdiction === 'ca' ? 'T4A' : '1099-NEC';

  // Get contract labor expenses (code 5300 for US, or matching tax category)
  const contractAccounts = await db.abAccount.findMany({
    where: {
      tenantId,
      OR: [
        { code: '5300' },
        { taxCategory: { contains: 'Contract' } },
        { name: { contains: 'Contract' } },
      ],
    },
  });

  // Get vendors paid through these accounts
  const expenses = await db.abExpense.findMany({
    where: {
      tenantId,
      date: { gte: yearStart, lte: yearEnd },
      categoryId: { in: contractAccounts.map((a: any) => a.id) },
      vendorId: { not: null },
      isPersonal: false,
    },
    select: { vendorId: true, amountCents: true },
  });

  // Group by vendor
  const vendorTotals: Map<string, number> = new Map();
  for (const exp of expenses) {
    vendorTotals.set(exp.vendorId, (vendorTotals.get(exp.vendorId) || 0) + exp.amountCents);
  }

  // Get vendor names
  const vendorIds = Array.from(vendorTotals.keys());
  const vendors = await db.abVendor.findMany({
    where: { id: { in: vendorIds } },
  });
  const nameMap = new Map(vendors.map((v: any) => [v.id, v.name]));

  return Array.from(vendorTotals.entries()).map(([vendorId, totalPaid]) => ({
    contractorName: nameMap.get(vendorId) || 'Unknown',
    totalPaidCents: totalPaid,
    threshold,
    requiresReporting: totalPaid >= threshold,
    nearThreshold: totalPaid >= threshold * 0.9 && totalPaid < threshold,
    jurisdiction,
    formId,
  }));
}
