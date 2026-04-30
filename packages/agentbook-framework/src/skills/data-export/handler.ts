/**
 * Data Export — CSV, JSON, QBO-compatible formats.
 */

export async function exportExpenses(
  tenantId: string,
  startDate: string,
  endDate: string,
  format: 'csv' | 'json',
  db: any,
): Promise<string> {
  const expenses = await db.abExpense.findMany({
    where: { tenantId, date: { gte: new Date(startDate), lte: new Date(endDate) } },
    orderBy: { date: 'asc' },
  });

  if (format === 'json') return JSON.stringify(expenses, null, 2);

  const header = 'Date,Amount,Vendor,Description,Category,Personal,Receipt';
  const rows = expenses.map((e: any) =>
    `${e.date.toISOString().split('T')[0]},${e.amountCents / 100},${e.description || ''},${e.description || ''},,${e.isPersonal},${e.receiptUrl || ''}`
  );
  return [header, ...rows].join('\n');
}

export async function exportJournalEntries(
  tenantId: string,
  startDate: string,
  endDate: string,
  format: 'csv' | 'json',
  db: any,
): Promise<string> {
  const entries = await db.abJournalEntry.findMany({
    where: { tenantId, date: { gte: new Date(startDate), lte: new Date(endDate) } },
    include: { lines: { include: { account: true } } },
    orderBy: { date: 'asc' },
  });

  if (format === 'json') return JSON.stringify(entries, null, 2);

  const header = 'Date,Memo,Account,Debit,Credit';
  const rows: string[] = [];
  for (const entry of entries) {
    for (const line of entry.lines) {
      rows.push(`${entry.date.toISOString().split('T')[0]},${entry.memo},${line.account.code} ${line.account.name},${line.debitCents / 100},${line.creditCents / 100}`);
    }
  }
  return [header, ...rows].join('\n');
}

export async function exportInvoices(
  tenantId: string,
  format: 'csv' | 'json',
  db: any,
): Promise<string> {
  const invoices = await db.abInvoice.findMany({
    where: { tenantId },
    include: { client: true, lines: true },
    orderBy: { issuedDate: 'asc' },
  });

  if (format === 'json') return JSON.stringify(invoices, null, 2);

  const header = 'Number,Client,Amount,Issued,Due,Status';
  const rows = invoices.map((i: any) =>
    `${i.number},${i.client?.name || ''},${i.amountCents / 100},${i.issuedDate.toISOString().split('T')[0]},${i.dueDate.toISOString().split('T')[0]},${i.status}`
  );
  return [header, ...rows].join('\n');
}
