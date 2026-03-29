/**
 * Learning Feedback Processor — The agent gets smarter with every interaction.
 * Processes corrections, confirmations, and engagement signals.
 */

export interface CorrectionEvent {
  tenantId: string;
  agentId: string;
  skillName: string;
  original: Record<string, unknown>;
  corrected: Record<string, unknown>;
  context: Record<string, unknown>;
}

export interface LearningResult {
  patternsUpdated: number;
  personalityAdjusted: boolean;
  confidenceChange: number;
}

export async function processCorrection(
  event: CorrectionEvent,
  db: any,
): Promise<LearningResult> {
  let patternsUpdated = 0;
  let personalityAdjusted = false;

  // 1. Log the learning event
  await db.abLearningEvent.create({
    data: {
      tenantId: event.tenantId,
      agentId: event.agentId,
      eventType: 'correction',
      skillName: event.skillName,
      before: event.original,
      after: event.corrected,
      confidence: 0.95,
    },
  });

  // 2. Update vendor pattern if this is a categorization correction
  if (event.skillName === 'expense-recording' && event.context.vendorPattern) {
    const pattern = await db.abPattern.findFirst({
      where: { tenantId: event.tenantId, vendorPattern: event.context.vendorPattern as string },
    });

    if (pattern) {
      // Exponential moving average confidence decrease
      const newConfidence = Math.max(0.1, pattern.confidence * 0.8);
      await db.abPattern.update({
        where: { id: pattern.id },
        data: {
          categoryId: event.corrected.categoryId as string,
          confidence: 0.95, // User correction = high confidence for new value
          source: 'user_corrected',
          usageCount: { increment: 1 },
        },
      });
      patternsUpdated++;
    }
  }

  // 3. Check correction frequency — adjust agent personality
  const recentCorrections = await db.abLearningEvent.count({
    where: {
      tenantId: event.tenantId,
      agentId: event.agentId,
      eventType: 'correction',
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
  });

  if (recentCorrections > 10) {
    // Too many corrections — agent should ask more, auto-approve less
    await db.abAgentPersonality.upsert({
      where: { tenantId_agentId: { tenantId: event.tenantId, agentId: event.agentId } },
      update: { proactiveLevel: 'minimal' },
      create: { tenantId: event.tenantId, agentId: event.agentId, proactiveLevel: 'minimal' },
    });
    personalityAdjusted = true;
  }

  return { patternsUpdated, personalityAdjusted, confidenceChange: -0.05 };
}

export async function processConfirmation(
  tenantId: string,
  agentId: string,
  skillName: string,
  context: Record<string, unknown>,
  db: any,
): Promise<void> {
  // Log positive reinforcement
  await db.abLearningEvent.create({
    data: {
      tenantId, agentId,
      eventType: 'confirmation',
      skillName,
      before: context,
      after: context, // No change
      confidence: 1.0,
    },
  });

  // Boost pattern confidence if categorization confirmed
  if (context.vendorPattern) {
    const pattern = await db.abPattern.findFirst({
      where: { tenantId, vendorPattern: context.vendorPattern as string },
    });
    if (pattern) {
      const newConfidence = Math.min(0.99, pattern.confidence * 1.05);
      await db.abPattern.update({
        where: { id: pattern.id },
        data: { confidence: newConfidence, usageCount: { increment: 1 }, lastUsed: new Date() },
      });
    }
  }
}

/**
 * Agent self-assessment — run weekly to auto-adjust behavior.
 */
export async function agentSelfAssess(
  tenantId: string,
  agentId: string,
  db: any,
): Promise<{ adjusted: boolean; message: string }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const corrections = await db.abLearningEvent.count({
    where: { tenantId, agentId, eventType: 'correction', createdAt: { gte: sevenDaysAgo } },
  });

  const confirmations = await db.abLearningEvent.count({
    where: { tenantId, agentId, eventType: 'confirmation', createdAt: { gte: sevenDaysAgo } },
  });

  const total = corrections + confirmations;
  const accuracy = total > 0 ? confirmations / total : 1;

  if (accuracy < 0.85 && total >= 5) {
    // Accuracy dropping — increase confirmation prompts
    await db.abAgentConfig.upsert({
      where: { tenantId_agentId: { tenantId, agentId } },
      update: { autoApprove: false },
      create: { tenantId, agentId, autoApprove: false },
    });

    return {
      adjusted: true,
      message: `${agentId} accuracy dropped to ${Math.round(accuracy * 100)}% this week (${corrections} corrections, ${confirmations} confirmations). Switching to confirmation mode.`,
    };
  }

  if (accuracy > 0.95 && total >= 10) {
    // High accuracy — can auto-approve more
    return {
      adjusted: false,
      message: `${agentId} accuracy is ${Math.round(accuracy * 100)}% — excellent. No adjustment needed.`,
    };
  }

  return { adjusted: false, message: `${agentId}: ${total} actions, ${Math.round(accuracy * 100)}% accuracy.` };
}
