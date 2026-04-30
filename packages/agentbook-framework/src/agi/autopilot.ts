/**
 * Financial Autopilot — Full autonomous operation after trust is earned.
 *
 * Trust curve: Month 1 → ask everything. Month 6 → 95% auto. Month 12 → full autopilot.
 */

export interface AutopilotStatus {
  enabled: boolean;
  trustLevel: number; // 0-1 (earned over time)
  trustPhase: 'training' | 'learning' | 'confident' | 'autopilot';
  autoRecordRate: number;
  correctionRate: number;
  monthsActive: number;
  recommendation: string;
}

export async function getAutopilotStatus(tenantId: string, db: any): Promise<AutopilotStatus> {
  const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
  const createdAt = config?.createdAt || new Date();
  const monthsActive = Math.floor((Date.now() - new Date(createdAt).getTime()) / (30 * 24 * 60 * 60 * 1000));

  // Calculate trust from learning events
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const corrections = await db.abLearningEvent.count({
    where: { tenantId, eventType: 'correction', createdAt: { gte: thirtyDaysAgo } },
  });
  const confirmations = await db.abLearningEvent.count({
    where: { tenantId, eventType: 'confirmation', createdAt: { gte: thirtyDaysAgo } },
  });
  const total = corrections + confirmations;
  const accuracy = total > 0 ? confirmations / total : 0.5;

  // Trust level based on accuracy + tenure
  const tenureFactor = Math.min(1, monthsActive / 6); // Max trust from tenure at 6 months
  const accuracyFactor = accuracy;
  const trustLevel = tenureFactor * 0.4 + accuracyFactor * 0.6;

  let trustPhase: AutopilotStatus['trustPhase'] = 'training';
  if (trustLevel > 0.9) trustPhase = 'autopilot';
  else if (trustLevel > 0.7) trustPhase = 'confident';
  else if (trustLevel > 0.4) trustPhase = 'learning';

  const recommendations: Record<string, string> = {
    training: 'Agent is learning your patterns. Confirm or correct categorizations to help it improve.',
    learning: `Accuracy is ${Math.round(accuracy * 100)}%. A few more weeks and auto-approve can be enabled.`,
    confident: `Agent is ${Math.round(accuracy * 100)}% accurate. Consider enabling auto-approve for high-confidence items.`,
    autopilot: `Agent is highly accurate (${Math.round(accuracy * 100)}%). Full autopilot recommended.`,
  };

  return {
    enabled: trustPhase === 'autopilot',
    trustLevel,
    trustPhase,
    autoRecordRate: accuracy,
    correctionRate: total > 0 ? corrections / total : 0,
    monthsActive,
    recommendation: recommendations[trustPhase],
  };
}
