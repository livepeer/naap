/**
 * Anomaly Detection — Statistical, not LLM-based.
 * Per architecture.md: "anomaly detection statistical not LLM"
 *
 * Flags expenses where amount > mean + 2*stddev for the category
 * over trailing 12 months.
 */

export interface AnomalyResult {
  isAnomaly: boolean;
  amountCents: number;
  categoryMeanCents: number;
  categoryStdDevCents: number;
  threshold: number; // mean + 2σ
  zScore: number;
  message?: string;
}

/**
 * Check if an expense amount is anomalous for its category.
 * Uses trailing 12 months of data for the same tenant + category.
 */
export async function checkAnomaly(
  tenantId: string,
  categoryId: string,
  amountCents: number,
  db: any,
): Promise<AnomalyResult> {
  // Get trailing 12 months of expenses in this category
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const expenses = await db.abExpense.findMany({
    where: {
      tenantId,
      categoryId,
      date: { gte: twelveMonthsAgo },
      isPersonal: false,
    },
    select: { amountCents: true },
  });

  if (expenses.length < 5) {
    // Not enough data for statistical analysis
    return {
      isAnomaly: false,
      amountCents,
      categoryMeanCents: 0,
      categoryStdDevCents: 0,
      threshold: 0,
      zScore: 0,
      message: 'Insufficient data for anomaly detection (need 5+ expenses)',
    };
  }

  const amounts = expenses.map((e: any) => e.amountCents);
  const mean = amounts.reduce((sum: number, a: number) => sum + a, 0) / amounts.length;
  const variance = amounts.reduce((sum: number, a: number) => sum + Math.pow(a - mean, 2), 0) / amounts.length;
  const stdDev = Math.sqrt(variance);

  const threshold = mean + 2 * stdDev;
  const zScore = stdDev > 0 ? (amountCents - mean) / stdDev : 0;
  const isAnomaly = amountCents > threshold;

  return {
    isAnomaly,
    amountCents,
    categoryMeanCents: Math.round(mean),
    categoryStdDevCents: Math.round(stdDev),
    threshold: Math.round(threshold),
    zScore: Math.round(zScore * 100) / 100,
    message: isAnomaly
      ? `Amount $${(amountCents/100).toFixed(2)} is ${zScore.toFixed(1)}σ above the category average of $${(mean/100).toFixed(2)}`
      : undefined,
  };
}

/**
 * Scan all recent expenses for anomalies.
 * Used by proactive engine to surface alerts.
 */
export async function scanForAnomalies(
  tenantId: string,
  db: any,
  daysSince: number = 7,
): Promise<AnomalyResult[]> {
  const since = new Date();
  since.setDate(since.getDate() - daysSince);

  const recentExpenses = await db.abExpense.findMany({
    where: {
      tenantId,
      date: { gte: since },
      isPersonal: false,
      categoryId: { not: null },
    },
  });

  const anomalies: AnomalyResult[] = [];

  for (const expense of recentExpenses) {
    const result = await checkAnomaly(tenantId, expense.categoryId, expense.amountCents, db);
    if (result.isAnomaly) {
      anomalies.push(result);
    }
  }

  return anomalies;
}
