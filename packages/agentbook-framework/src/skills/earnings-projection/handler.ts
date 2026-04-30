/**
 * Earnings Projection — Revenue forecasting and client payment prediction.
 */

export interface EarningsProjection {
  ytdRevenueCents: number;
  projectedAnnualCents: number;
  confidenceLow: number;  // cents (10th percentile)
  confidenceHigh: number; // cents (90th percentile)
  monthsOfData: number;
  methodology: string;
}

export interface PaymentPrediction {
  clientId: string;
  clientName: string;
  invoiceId: string;
  invoiceAmountCents: number;
  predictedPayDate: string;
  avgDaysToPay: number;
  confidence: number;
  pattern: string; // "typically pays in N days"
}

/**
 * Project annual revenue from YTD data.
 * Uses linear extrapolation with seasonal adjustment placeholder.
 */
export async function projectAnnualRevenue(
  tenantId: string,
  db: any,
): Promise<EarningsProjection> {
  const currentYear = new Date().getFullYear();
  const yearStart = new Date(currentYear, 0, 1);
  const now = new Date();
  const monthsElapsed = now.getMonth() + (now.getDate() / 30);

  // Get YTD revenue from journal entries (credit to revenue accounts)
  const revenueAccounts = await db.abAccount.findMany({
    where: { tenantId, accountType: 'revenue', isActive: true },
    select: { id: true },
  });
  const revenueIds = revenueAccounts.map((a: any) => a.id);

  const ytdLines = await db.abJournalLine.findMany({
    where: {
      accountId: { in: revenueIds },
      entry: { tenantId, date: { gte: yearStart } },
    },
    select: { creditCents: true },
  });

  const ytdRevenue = ytdLines.reduce((s: number, l: any) => s + l.creditCents, 0);

  if (monthsElapsed < 1) {
    return {
      ytdRevenueCents: ytdRevenue,
      projectedAnnualCents: ytdRevenue * 12,
      confidenceLow: 0,
      confidenceHigh: ytdRevenue * 24,
      monthsOfData: 0,
      methodology: 'Insufficient data — using simple 12x multiplier',
    };
  }

  // Linear extrapolation
  const monthlyRate = ytdRevenue / monthsElapsed;
  const projected = Math.round(monthlyRate * 12);

  // Confidence bands: ±20% at start of year, narrowing to ±5% by December
  const uncertaintyFactor = Math.max(0.05, 0.20 * (1 - monthsElapsed / 12));
  const low = Math.round(projected * (1 - uncertaintyFactor));
  const high = Math.round(projected * (1 + uncertaintyFactor));

  return {
    ytdRevenueCents: ytdRevenue,
    projectedAnnualCents: projected,
    confidenceLow: low,
    confidenceHigh: high,
    monthsOfData: Math.floor(monthsElapsed),
    methodology: `Linear extrapolation from ${Math.floor(monthsElapsed)} months of data (±${(uncertaintyFactor * 100).toFixed(0)}% confidence band)`,
  };
}

/**
 * Predict when a client will pay an outstanding invoice.
 * Based on their historical average payment time.
 */
export async function predictClientPayment(
  tenantId: string,
  invoiceId: string,
  db: any,
): Promise<PaymentPrediction | null> {
  const invoice = await db.abInvoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { client: true },
  });
  if (!invoice || !invoice.client) return null;

  // Get client's payment history
  const paidInvoices = await db.abInvoice.findMany({
    where: { tenantId, clientId: invoice.clientId, status: 'paid' },
    include: { payments: true },
    orderBy: { issuedDate: 'desc' },
    take: 10,
  });

  if (paidInvoices.length === 0) {
    // No history — use default terms
    const dueDate = invoice.dueDate;
    return {
      clientId: invoice.clientId,
      clientName: invoice.client.name,
      invoiceId,
      invoiceAmountCents: invoice.amountCents,
      predictedPayDate: dueDate.toISOString().split('T')[0],
      avgDaysToPay: 30,
      confidence: 0.3,
      pattern: 'No payment history — using invoice due date',
    };
  }

  // Calculate average days to pay
  const daysToPayList = paidInvoices
    .filter((inv: any) => inv.payments.length > 0)
    .map((inv: any) => {
      const firstPayment = inv.payments[0];
      return Math.ceil((new Date(firstPayment.date).getTime() - new Date(inv.issuedDate).getTime()) / (1000 * 60 * 60 * 24));
    });

  if (daysToPayList.length === 0) {
    return {
      clientId: invoice.clientId,
      clientName: invoice.client.name,
      invoiceId,
      invoiceAmountCents: invoice.amountCents,
      predictedPayDate: invoice.dueDate.toISOString().split('T')[0],
      avgDaysToPay: 30,
      confidence: 0.3,
      pattern: 'No completed payments — using due date',
    };
  }

  const avgDays = Math.round(daysToPayList.reduce((s: number, d: number) => s + d, 0) / daysToPayList.length);
  const predictedDate = new Date(invoice.issuedDate);
  predictedDate.setDate(predictedDate.getDate() + avgDays);

  const confidence = Math.min(0.95, 0.5 + daysToPayList.length * 0.05);

  return {
    clientId: invoice.clientId,
    clientName: invoice.client.name,
    invoiceId,
    invoiceAmountCents: invoice.amountCents,
    predictedPayDate: predictedDate.toISOString().split('T')[0],
    avgDaysToPay: avgDays,
    confidence,
    pattern: `${invoice.client.name} typically pays in ${avgDays} days (based on ${daysToPayList.length} invoices)`,
  };
}
