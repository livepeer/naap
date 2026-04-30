/**
 * Financial Copilot — The agent becomes a proactive financial advisor.
 * Goes beyond recording transactions to actively advising on decisions.
 */

export interface SubscriptionAuditResult {
  subscriptions: {
    vendorName: string;
    monthlyCostCents: number;
    annualCostCents: number;
    frequency: string;
    lastCharge: string;
    suggestion: 'keep' | 'review' | 'cancel';
    reason: string;
  }[];
  totalMonthlyCents: number;
  potentialSavingsCents: number;
}

export interface ConcentrationResult {
  clients: {
    clientName: string;
    revenueCents: number;
    revenueShare: number;
    riskLevel: 'low' | 'moderate' | 'high' | 'critical';
  }[];
  topClientShare: number;
  diversificationScore: number; // 0-100, higher = more diversified
  recommendation: string;
}

export interface SeasonalPattern {
  month: number;
  avgRevenueCents: number;
  avgExpenseCents: number;
  isHighSeason: boolean;
  isLowSeason: boolean;
}

export interface SeasonalAnalysis {
  patterns: SeasonalPattern[];
  hasSeasonality: boolean;
  peakMonths: number[];
  lowMonths: number[];
  recommendedReserveCents: number;
  recommendation: string;
}

export interface PricingSuggestion {
  clientName: string;
  effectiveRateCents: number;
  totalHours: number;
  totalRevenueCents: number;
  averageRateCents: number;
  suggestion: string;
  potentialIncreaseCents: number;
}

/**
 * Subscription audit: find recurring expenses and flag potential savings.
 */
export async function auditSubscriptions(
  tenantId: string,
  db: any,
): Promise<SubscriptionAuditResult> {
  const rules = await db.abRecurringRule.findMany({
    where: { tenantId, active: true },
  });

  // Get vendor names
  const vendorIds = rules.map((r: any) => r.vendorId);
  const vendors = await db.abVendor.findMany({ where: { id: { in: vendorIds } } });
  const nameMap = new Map(vendors.map((v: any) => [v.id, v.name]));

  // Get last expense date per vendor
  const lastExpenses = await db.abExpense.findMany({
    where: { tenantId, vendorId: { in: vendorIds } },
    orderBy: { date: 'desc' },
    distinct: ['vendorId'],
  });
  const lastDateMap = new Map(lastExpenses.map((e: any) => [e.vendorId, e.date]));

  const subscriptions = rules.map((r: any) => {
    const monthlyCost = r.frequency === 'annual'
      ? Math.round(r.amountCents / 12)
      : r.frequency === 'weekly'
        ? r.amountCents * 4
        : r.amountCents;

    const lastCharge = lastDateMap.get(r.vendorId);
    const daysSinceLastCharge = lastCharge
      ? Math.floor((Date.now() - new Date(lastCharge).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    // Suggest cancel if no charge in 60+ days (may be unused)
    let suggestion: 'keep' | 'review' | 'cancel' = 'keep';
    let reason = 'Active subscription';
    if (daysSinceLastCharge > 90) {
      suggestion = 'cancel';
      reason = `No charges in ${daysSinceLastCharge} days — may be unused`;
    } else if (daysSinceLastCharge > 60) {
      suggestion = 'review';
      reason = `No charges in ${daysSinceLastCharge} days — verify still needed`;
    }

    return {
      vendorName: nameMap.get(r.vendorId) || 'Unknown',
      monthlyCostCents: monthlyCost,
      annualCostCents: monthlyCost * 12,
      frequency: r.frequency,
      lastCharge: lastCharge?.toISOString() || '',
      suggestion,
      reason,
    };
  });

  const totalMonthly = subscriptions.reduce((s: number, sub: any) => s + sub.monthlyCostCents, 0);
  const potentialSavings = subscriptions
    .filter((s: any) => s.suggestion === 'cancel')
    .reduce((sum: number, s: any) => sum + s.annualCostCents, 0);

  return { subscriptions, totalMonthlyCents: totalMonthly, potentialSavingsCents: potentialSavings };
}

/**
 * Client concentration: analyze revenue risk.
 */
export async function analyzeConcentration(
  tenantId: string,
  db: any,
): Promise<ConcentrationResult> {
  const clients = await db.abClient.findMany({ where: { tenantId } });
  const totalRevenue = clients.reduce((s: number, c: any) => s + c.totalBilledCents, 0);

  const clientData = clients
    .map((c: any) => {
      const share = totalRevenue > 0 ? c.totalBilledCents / totalRevenue : 0;
      let riskLevel: 'low' | 'moderate' | 'high' | 'critical' = 'low';
      if (share > 0.7) riskLevel = 'critical';
      else if (share > 0.5) riskLevel = 'high';
      else if (share > 0.3) riskLevel = 'moderate';

      return {
        clientName: c.name,
        revenueCents: c.totalBilledCents,
        revenueShare: share,
        riskLevel,
      };
    })
    .sort((a: any, b: any) => b.revenueCents - a.revenueCents);

  const topShare = clientData[0]?.revenueShare || 0;

  // Herfindahl-Hirschman Index for diversification
  const hhi = clientData.reduce((s: number, c: any) => s + Math.pow(c.revenueShare, 2), 0);
  const diversificationScore = Math.round((1 - hhi) * 100);

  let recommendation = 'Revenue is well diversified.';
  if (topShare > 0.5) {
    recommendation = `${clientData[0]?.clientName} represents ${Math.round(topShare * 100)}% of revenue. Consider diversifying to reduce risk.`;
  } else if (topShare > 0.3) {
    recommendation = `Moderate concentration: top client is ${Math.round(topShare * 100)}% of revenue. Continue building other relationships.`;
  }

  return { clients: clientData, topClientShare: topShare, diversificationScore, recommendation };
}

/**
 * Seasonal pattern detection: analyze 12+ months for cyclicality.
 */
export async function detectSeasonalPatterns(
  tenantId: string,
  db: any,
): Promise<SeasonalAnalysis> {
  const now = new Date();
  const patterns: SeasonalPattern[] = [];

  // Get monthly data for last 24 months
  const monthlyData: { month: number; revenue: number; expenses: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);

    const expenses = await db.abExpense.findMany({
      where: { tenantId, isPersonal: false, date: { gte: start, lte: end } },
      select: { amountCents: true },
    });
    const expTotal = expenses.reduce((s: number, e: any) => s + e.amountCents, 0);

    monthlyData.push({
      month: start.getMonth() + 1,
      revenue: 0, // Would need journal line aggregation for accuracy
      expenses: expTotal,
    });
  }

  // Average by month across years
  for (let m = 1; m <= 12; m++) {
    const monthEntries = monthlyData.filter(d => d.month === m);
    const avgExp = monthEntries.length > 0
      ? Math.round(monthEntries.reduce((s, d) => s + d.expenses, 0) / monthEntries.length)
      : 0;

    patterns.push({
      month: m,
      avgRevenueCents: 0,
      avgExpenseCents: avgExp,
      isHighSeason: false,
      isLowSeason: false,
    });
  }

  // Detect high/low seasons
  const avgExpense = patterns.reduce((s, p) => s + p.avgExpenseCents, 0) / 12;
  const threshold = avgExpense * 0.3;

  const peakMonths: number[] = [];
  const lowMonths: number[] = [];

  for (const p of patterns) {
    if (p.avgExpenseCents > avgExpense + threshold) {
      p.isHighSeason = true;
      peakMonths.push(p.month);
    }
    if (p.avgExpenseCents < avgExpense - threshold) {
      p.isLowSeason = true;
      lowMonths.push(p.month);
    }
  }

  const hasSeasonality = peakMonths.length > 0 || lowMonths.length > 0;
  const recommendedReserve = hasSeasonality
    ? Math.round(avgExpense * 2) // 2 months of average expenses
    : 0;

  return {
    patterns,
    hasSeasonality,
    peakMonths,
    lowMonths,
    recommendedReserveCents: recommendedReserve,
    recommendation: hasSeasonality
      ? `Seasonal patterns detected. Recommend keeping $${(recommendedReserve / 100).toFixed(0)} in cash reserves to cover low months.`
      : 'No significant seasonal patterns detected in your expense data.',
  };
}

/**
 * Pricing suggestions: analyze effective hourly rates per client.
 */
export async function analyzePricing(
  tenantId: string,
  db: any,
): Promise<PricingSuggestion[]> {
  const clients = await db.abClient.findMany({ where: { tenantId } });

  const suggestions: PricingSuggestion[] = [];
  let totalRate = 0;
  let rateCount = 0;

  for (const client of clients) {
    // Get time entries for this client
    const timeEntries = await db.abTimeEntry.findMany({
      where: { tenantId, clientId: client.id, endedAt: { not: null } },
    });

    if (timeEntries.length === 0) continue;

    const totalMinutes = timeEntries.reduce((s: number, e: any) => s + (e.durationMinutes || 0), 0);
    const totalHours = totalMinutes / 60;
    const effectiveRate = totalHours > 0 ? Math.round(client.totalBilledCents / totalHours) : 0;

    if (effectiveRate > 0) {
      totalRate += effectiveRate;
      rateCount++;
    }

    suggestions.push({
      clientName: client.name,
      effectiveRateCents: effectiveRate,
      totalHours: Math.round(totalHours * 10) / 10,
      totalRevenueCents: client.totalBilledCents,
      averageRateCents: 0, // filled below
      suggestion: '',
      potentialIncreaseCents: 0,
    });
  }

  // Calculate average and fill suggestions
  const avgRate = rateCount > 0 ? Math.round(totalRate / rateCount) : 0;

  for (const s of suggestions) {
    s.averageRateCents = avgRate;
    if (s.effectiveRateCents > 0 && s.effectiveRateCents < avgRate * 0.7) {
      const increase = Math.round((avgRate - s.effectiveRateCents) * s.totalHours);
      s.suggestion = `Rate is ${Math.round((1 - s.effectiveRateCents / avgRate) * 100)}% below average. A rate increase could add $${(increase / 100).toFixed(0)}/year.`;
      s.potentialIncreaseCents = increase;
    } else {
      s.suggestion = 'Rate is competitive.';
    }
  }

  return suggestions.sort((a, b) => a.effectiveRateCents - b.effectiveRateCents);
}
