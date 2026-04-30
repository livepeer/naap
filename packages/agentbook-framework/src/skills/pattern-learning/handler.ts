/**
 * Pattern Learning — The agent gets smarter over time.
 * Tracks categorization accuracy per vendor pattern.
 * Detects drift when user corrections increase (pattern no longer accurate).
 */

export interface PatternAccuracyResult {
  vendorPattern: string;
  currentConfidence: number;
  trailingAccuracy: number; // last 30 categorizations
  totalUsages: number;
  isDrifting: boolean;
  recommendation: string;
}

/**
 * Recalculate pattern confidence based on recent accuracy.
 * Called after each user correction or confirmation.
 */
export async function updatePatternConfidence(
  tenantId: string,
  vendorPattern: string,
  wasCorrect: boolean,
  db: any,
): Promise<PatternAccuracyResult | null> {
  const pattern = await db.abPattern.findFirst({
    where: { tenantId, vendorPattern },
  });
  if (!pattern) return null;

  // Exponential moving average: new_confidence = α * observation + (1-α) * old_confidence
  const alpha = 0.1; // learning rate
  const observation = wasCorrect ? 1.0 : 0.0;
  const newConfidence = alpha * observation + (1 - alpha) * pattern.confidence;

  // Track trailing accuracy (simplified: use usageCount as denominator)
  const newAccuracy = pattern.usageCount > 0
    ? ((pattern.accuracyTrailing30 || pattern.confidence) * (pattern.usageCount - 1) + observation) / pattern.usageCount
    : observation;

  await db.abPattern.update({
    where: { id: pattern.id },
    data: {
      confidence: Math.max(0.1, Math.min(1.0, newConfidence)),
      accuracyTrailing30: newAccuracy,
      usageCount: { increment: 1 },
      lastUsed: new Date(),
    },
  });

  const isDrifting = newAccuracy < 0.85 && pattern.usageCount > 10;

  return {
    vendorPattern,
    currentConfidence: newConfidence,
    trailingAccuracy: newAccuracy,
    totalUsages: pattern.usageCount + 1,
    isDrifting,
    recommendation: isDrifting
      ? `Pattern accuracy for "${vendorPattern}" dropped to ${(newAccuracy * 100).toFixed(0)}%. Consider re-categorizing recent expenses.`
      : `Pattern for "${vendorPattern}" is healthy at ${(newAccuracy * 100).toFixed(0)}% accuracy.`,
  };
}

/**
 * Scan all patterns for drift — called periodically.
 * Returns patterns where accuracy dropped below 85%.
 */
export async function detectDriftingPatterns(
  tenantId: string,
  db: any,
  threshold: number = 0.85,
): Promise<PatternAccuracyResult[]> {
  const patterns = await db.abPattern.findMany({
    where: { tenantId, usageCount: { gte: 10 } },
  });

  return patterns
    .filter((p: any) => (p.accuracyTrailing30 || p.confidence) < threshold)
    .map((p: any) => ({
      vendorPattern: p.vendorPattern,
      currentConfidence: p.confidence,
      trailingAccuracy: p.accuracyTrailing30 || p.confidence,
      totalUsages: p.usageCount,
      isDrifting: true,
      recommendation: `Pattern "${p.vendorPattern}" accuracy is ${((p.accuracyTrailing30 || p.confidence) * 100).toFixed(0)}% — below ${(threshold * 100).toFixed(0)}% threshold.`,
    }));
}
