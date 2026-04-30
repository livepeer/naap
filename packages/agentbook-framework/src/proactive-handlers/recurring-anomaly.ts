/**
 * Recurring Anomaly — Detect unexpected changes in recurring expenses.
 * Trigger: Event (expense.recorded) when it matches a recurring rule but amount differs
 *
 * "Your Figma subscription charged $59.99 instead of the usual $49.99."
 */

import type { ProactiveMessage } from '../proactive-engine.js';

export interface RecurringAnomalyData {
  tenantId: string;
  vendorName: string;
  expectedAmountCents: number;
  actualAmountCents: number;
  expenseId: string;
  ruleId: string;
}

export function handleRecurringAnomaly(data: RecurringAnomalyData): ProactiveMessage {
  const diff = data.actualAmountCents - data.expectedAmountCents;
  const isIncrease = diff > 0;

  return {
    id: `recurring-anomaly-${data.ruleId}-${Date.now()}`,
    tenant_id: data.tenantId,
    category: 'recurring_anomaly',
    urgency: Math.abs(diff) > 1000 ? 'important' : 'informational', // > $10 difference
    title_key: 'proactive.recurring_anomaly',
    body_key: 'proactive.recurring_anomaly',
    body_params: {
      vendor: data.vendorName,
      actual: data.actualAmountCents,
      expected: data.expectedAmountCents,
    },
    actions: [
      { label_key: 'proactive.accept_new_amount', callback_data: `accept_recurring:${data.ruleId}:${data.actualAmountCents}`, style: 'primary' },
      { label_key: 'proactive.investigate', callback_data: `view:expense-${data.expenseId}` },
    ],
  };
}
