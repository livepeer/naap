/**
 * Client Relationship Intelligence — Know your clients better than they know themselves.
 */

export interface ClientHealthScore {
  clientId: string;
  clientName: string;
  lifetimeValueCents: number;
  effectiveRateCents: number;
  avgRateCents: number;
  rateVsAverage: number; // percentage difference
  paymentReliability: number; // 0-1
  avgDaysToPay: number;
  revenueTrend: 'growing' | 'stable' | 'declining';
  revenueGrowthPercent: number;
  scopeCreepScore: number; // 0-1, higher = more creep
  riskLevel: 'low' | 'moderate' | 'high';
  recommendation: string;
}

export async function analyzeClientHealth(tenantId: string, db: any): Promise<ClientHealthScore[]> {
  const clients = await db.abClient.findMany({ where: { tenantId } });
  if (clients.length === 0) return [];

  // Calculate average rate across all clients
  const allTimeEntries = await db.abTimeEntry.findMany({
    where: { tenantId, endedAt: { not: null } },
  });
  const totalMinutes = allTimeEntries.reduce((s: number, e: any) => s + (e.durationMinutes || 0), 0);
  const totalBilled = clients.reduce((s: number, c: any) => s + c.totalBilledCents, 0);
  const avgRate = totalMinutes > 0 ? Math.round(totalBilled / (totalMinutes / 60)) : 0;

  const results: ClientHealthScore[] = [];

  for (const client of clients) {
    // Time entries for this client
    const clientTime = await db.abTimeEntry.findMany({
      where: { tenantId, clientId: client.id, endedAt: { not: null } },
    });
    const clientMinutes = clientTime.reduce((s: number, e: any) => s + (e.durationMinutes || 0), 0);
    const clientHours = clientMinutes / 60;

    // Effective hourly rate
    const effectiveRate = clientHours > 0 ? Math.round(client.totalBilledCents / clientHours) : 0;
    const rateVsAverage = avgRate > 0 ? Math.round((effectiveRate / avgRate - 1) * 100) : 0;

    // Payment reliability
    const paidInvoices = await db.abInvoice.findMany({
      where: { tenantId, clientId: client.id, status: 'paid' },
      include: { payments: true },
    });
    const onTime = paidInvoices.filter((inv: any) => {
      if (inv.payments.length === 0) return false;
      const payDate = new Date(inv.payments[0].date);
      const dueDate = new Date(inv.dueDate);
      return payDate <= dueDate;
    }).length;
    const reliability = paidInvoices.length > 0 ? onTime / paidInvoices.length : 1;

    // Avg days to pay
    const daysList = paidInvoices
      .filter((inv: any) => inv.payments.length > 0)
      .map((inv: any) => Math.ceil((new Date(inv.payments[0].date).getTime() - new Date(inv.issuedDate).getTime()) / (1000 * 60 * 60 * 24)));
    const avgDays = daysList.length > 0 ? Math.round(daysList.reduce((s: number, d: number) => s + d, 0) / daysList.length) : 30;

    // Revenue trend (simplified)
    const trend = client.totalBilledCents > 0 ? 'stable' : 'stable'; // Would need YoY data
    const growthPercent = 0;

    // Scope creep (actual hours vs estimates — simplified)
    const scopeCreep = 0; // Would need estimate data

    // Risk level
    let risk: 'low' | 'moderate' | 'high' = 'low';
    let recommendation = `${client.name} is a healthy client.`;

    if (effectiveRate > 0 && effectiveRate < avgRate * 0.7) {
      risk = 'high';
      recommendation = `Effective rate is ${rateVsAverage}% below average. Consider a rate increase — could add $${Math.round((avgRate - effectiveRate) * clientHours / 100)}/year.`;
    } else if (reliability < 0.7) {
      risk = 'moderate';
      recommendation = `Payment reliability is ${Math.round(reliability * 100)}%. Consider requiring deposits or shorter payment terms.`;
    } else if (avgDays > 45) {
      risk = 'moderate';
      recommendation = `Average ${avgDays} days to pay. Consider net-15 terms or early payment incentives.`;
    }

    results.push({
      clientId: client.id,
      clientName: client.name,
      lifetimeValueCents: client.totalBilledCents,
      effectiveRateCents: effectiveRate,
      avgRateCents: avgRate,
      rateVsAverage,
      paymentReliability: reliability,
      avgDaysToPay: avgDays,
      revenueTrend: trend,
      revenueGrowthPercent: growthPercent,
      scopeCreepScore: scopeCreep,
      riskLevel: risk,
      recommendation,
    });
  }

  return results.sort((a, b) => b.lifetimeValueCents - a.lifetimeValueCents);
}
