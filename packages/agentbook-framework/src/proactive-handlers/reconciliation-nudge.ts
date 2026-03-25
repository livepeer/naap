/**
 * Reconciliation Nudge — Remind about unmatched bank transactions.
 * Trigger: After bank sync completes
 */
import type { ProactiveMessage } from '../proactive-engine.js';

export interface ReconciliationNudgeData {
  tenantId: string;
  unmatchedCount: number;
  totalAmountCents: number;
}

export function handleReconciliationNudge(data: ReconciliationNudgeData): ProactiveMessage | null {
  if (data.unmatchedCount === 0) return null;

  return {
    id: `reconciliation-${data.tenantId}-${new Date().toISOString().split('T')[0]}`,
    tenant_id: data.tenantId,
    category: 'receipt_reminder',
    urgency: data.unmatchedCount > 10 ? 'important' : 'informational',
    title_key: 'proactive.receipt_reminder',
    body_key: 'proactive.receipt_reminder',
    body_params: {
      count: data.unmatchedCount,
      amount: data.totalAmountCents,
    },
    actions: [
      { label_key: 'common.view_details', callback_data: 'action:view_reconciliation', style: 'primary' },
      { label_key: 'proactive.remind_later', callback_data: 'snooze_1d:reconciliation' },
    ],
  };
}
