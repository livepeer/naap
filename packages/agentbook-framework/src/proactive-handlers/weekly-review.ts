/**
 * Weekly Review — Monday financial summary.
 * Trigger: Cron (Monday 9 AM tenant timezone)
 *
 * "This week: $4,200 revenue, $1,340 expenses. Top spend: Software ($420)."
 */

import type { ProactiveMessage } from '../proactive-engine.js';

export interface WeeklyReviewData {
  tenantId: string;
  revenueCents: number;
  expensesCents: number;
  topCategory: string;
  topCategoryAmountCents: number;
  effectiveTaxRate: number;
  revenueChangePercent: number; // vs prior week
}

export function handleWeeklyReview(data: WeeklyReviewData): ProactiveMessage {
  return {
    id: `weekly-review-${data.tenantId}-${new Date().toISOString().split('T')[0]}`,
    tenant_id: data.tenantId,
    category: 'weekly_review',
    urgency: 'informational',
    title_key: 'proactive.weekly_review',
    body_key: 'proactive.weekly_review',
    body_params: {
      revenue: data.revenueCents,
      expenses: data.expensesCents,
      top_category: data.topCategory,
      top_amount: data.topCategoryAmountCents,
      tax_rate: `${(data.effectiveTaxRate * 100).toFixed(1)}%`,
    },
    actions: [
      { label_key: 'common.view_details', callback_data: 'action:view_reports' },
    ],
  };
}
