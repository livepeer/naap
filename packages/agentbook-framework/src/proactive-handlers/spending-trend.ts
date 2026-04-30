/**
 * Spending Trend Alert — "Software subscriptions up 40% vs last quarter"
 * Trigger: Weekly or monthly analysis
 */
import type { ProactiveMessage } from '../proactive-engine.js';

export interface SpendingTrendData {
  tenantId: string;
  category: string;
  currentPeriodCents: number;
  priorPeriodCents: number;
  changePercent: number;
  newItems: string[]; // new vendors/subscriptions
}

export function handleSpendingTrend(data: SpendingTrendData): ProactiveMessage | null {
  if (Math.abs(data.changePercent) < 20) return null; // Only alert on 20%+ changes

  const isIncrease = data.changePercent > 0;
  return {
    id: `spending-trend-${data.tenantId}-${data.category}-${new Date().toISOString().slice(0, 7)}`,
    tenant_id: data.tenantId,
    category: 'spending_trend' as any,
    urgency: Math.abs(data.changePercent) > 50 ? 'important' : 'informational',
    title_key: isIncrease ? 'proactive.spending_trend_up' : 'proactive.spending_trend_down',
    body_key: isIncrease ? 'proactive.spending_trend_up' : 'proactive.spending_trend_down',
    body_params: {
      category: data.category,
      change_percent: Math.abs(data.changePercent),
      current: data.currentPeriodCents,
      prior: data.priorPeriodCents,
      new_items: data.newItems.join(', '),
    },
    actions: [
      { label_key: 'common.view_details', callback_data: `view:expense-analytics-${data.category}` },
      { label_key: 'common.dismiss', callback_data: `dismiss:trend-${data.category}` },
    ],
  };
}
