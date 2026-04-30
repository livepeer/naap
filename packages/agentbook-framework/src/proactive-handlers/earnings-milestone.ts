/**
 * Earnings Milestone — "You've hit $100K revenue this year!"
 * Trigger: After revenue crosses a milestone threshold
 */
import type { ProactiveMessage } from '../proactive-engine.js';

export interface EarningsMilestoneData {
  tenantId: string;
  milestoneCents: number;
  ytdRevenueCents: number;
  projectedAnnualCents: number;
}

const MILESTONES = [1000000, 2500000, 5000000, 7500000, 10000000, 15000000, 20000000, 50000000, 100000000]; // $10K, $25K, $50K, etc.

export function handleEarningsMilestone(data: EarningsMilestoneData): ProactiveMessage | null {
  // Find the latest crossed milestone
  const crossed = MILESTONES.filter(m => data.ytdRevenueCents >= m);
  if (crossed.length === 0) return null;
  const milestone = crossed[crossed.length - 1];

  return {
    id: `milestone-${data.tenantId}-${milestone}`,
    tenant_id: data.tenantId,
    category: 'daily_pulse' as any,
    urgency: 'informational',
    title_key: 'proactive.milestone_revenue',
    body_key: 'proactive.milestone_revenue',
    body_params: {
      amount: milestone,
      projection: data.projectedAnnualCents,
    },
    actions: [
      { label_key: 'common.view_details', callback_data: 'view:reports' },
    ],
  };
}

/**
 * Check if YTD revenue just crossed a new milestone.
 * Returns the milestone amount if newly crossed, null otherwise.
 */
export function checkMilestoneCrossed(
  previousRevenueCents: number,
  currentRevenueCents: number,
): number | null {
  for (const milestone of MILESTONES) {
    if (previousRevenueCents < milestone && currentRevenueCents >= milestone) {
      return milestone;
    }
  }
  return null;
}
