/**
 * Engagement-Driven Frequency Tuning — Learn from user behavior.
 * Boosts notifications the user acts on, demotes ignored ones.
 *
 * Per agentbook.md: "The engine learns: This tenant acts on invoice reminders
 * within 2 hours but ignores spending anomaly alerts."
 */

export interface EngagementStats {
  category: string;
  totalSent: number;
  totalActedOn: number;
  totalDismissed: number;
  totalSnoozed: number;
  avgResponseSeconds: number | null;
  actionRate: number; // acted_on / total_sent
  effectiveScore: number; // 0-1, higher = more engaged
}

export interface FrequencyAdjustment {
  category: string;
  currentFrequency: string; // 'daily' | 'weekly' | 'monthly'
  recommendedFrequency: string;
  reason: string;
}

/**
 * Calculate engagement stats per notification category for a tenant.
 */
export async function getEngagementStats(
  tenantId: string,
  db: any,
  daysSince: number = 30,
): Promise<EngagementStats[]> {
  const since = new Date();
  since.setDate(since.getDate() - daysSince);

  const logs = await db.abEngagementLog.findMany({
    where: { tenantId, sentAt: { gte: since } },
  });

  // Group by category
  const groups: Map<string, any[]> = new Map();
  for (const log of logs) {
    const g = groups.get(log.category) || [];
    g.push(log);
    groups.set(log.category, g);
  }

  return Array.from(groups.entries()).map(([category, entries]) => {
    const total = entries.length;
    const actedOn = entries.filter((e: any) => e.actedOnAt).length;
    const dismissed = entries.filter((e: any) => e.dismissed).length;
    const snoozed = entries.filter((e: any) => e.snoozed).length;
    const responseTimes = entries
      .filter((e: any) => e.responseTimeSeconds)
      .map((e: any) => e.responseTimeSeconds);
    const avgResponse = responseTimes.length > 0
      ? responseTimes.reduce((s: number, t: number) => s + t, 0) / responseTimes.length
      : null;

    const actionRate = total > 0 ? actedOn / total : 0;
    // Score: action rate * 0.7 + (1 - dismiss rate) * 0.3
    const dismissRate = total > 0 ? dismissed / total : 0;
    const effectiveScore = actionRate * 0.7 + (1 - dismissRate) * 0.3;

    return {
      category,
      totalSent: total,
      totalActedOn: actedOn,
      totalDismissed: dismissed,
      totalSnoozed: snoozed,
      avgResponseSeconds: avgResponse,
      actionRate,
      effectiveScore,
    };
  });
}

/**
 * Recommend frequency adjustments based on engagement data.
 */
export function recommendFrequencyAdjustments(
  stats: EngagementStats[],
): FrequencyAdjustment[] {
  const adjustments: FrequencyAdjustment[] = [];

  for (const stat of stats) {
    if (stat.totalSent < 5) continue; // Need enough data

    if (stat.effectiveScore < 0.2) {
      // Very low engagement — reduce to monthly
      adjustments.push({
        category: stat.category,
        currentFrequency: 'daily',
        recommendedFrequency: 'monthly',
        reason: `Only ${(stat.actionRate * 100).toFixed(0)}% action rate (${stat.totalActedOn}/${stat.totalSent}). ${stat.totalDismissed} dismissed.`,
      });
    } else if (stat.effectiveScore < 0.4) {
      // Low engagement — reduce to weekly
      adjustments.push({
        category: stat.category,
        currentFrequency: 'daily',
        recommendedFrequency: 'weekly',
        reason: `${(stat.actionRate * 100).toFixed(0)}% action rate. Reducing frequency to avoid fatigue.`,
      });
    } else if (stat.effectiveScore > 0.8 && stat.avgResponseSeconds && stat.avgResponseSeconds < 300) {
      // High engagement, fast response — keep or increase
      adjustments.push({
        category: stat.category,
        currentFrequency: 'weekly',
        recommendedFrequency: 'daily',
        reason: `${(stat.actionRate * 100).toFixed(0)}% action rate, avg response ${Math.round(stat.avgResponseSeconds / 60)}min. User values these.`,
      });
    }
  }

  return adjustments;
}
