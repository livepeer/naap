/**
 * Daily Pulse — Morning financial summary.
 * Trigger: Cron (8 AM tenant timezone)
 *
 * "Today: $340 in, $127 out. Cash balance: $12,450. 1 invoice due tomorrow."
 */

import type { ProactiveMessage } from '../proactive-engine.js';

export interface DailyPulseData {
  tenantId: string;
  incomeTodayCents: number;
  expensesTodayCents: number;
  cashBalanceCents: number;
  invoicesDueSoon: number;
  pendingEscalations: number;
  missingReceipts: number;
}

export function handleDailyPulse(data: DailyPulseData): ProactiveMessage {
  const actionCount = data.invoicesDueSoon + data.pendingEscalations + data.missingReceipts;

  return {
    id: `daily-pulse-${data.tenantId}-${new Date().toISOString().split('T')[0]}`,
    tenant_id: data.tenantId,
    category: 'daily_pulse',
    urgency: actionCount > 3 ? 'important' : 'informational',
    title_key: 'proactive.daily_pulse',
    body_key: 'proactive.daily_pulse',
    body_params: {
      income: data.incomeTodayCents,
      expenses: data.expensesTodayCents,
      balance: data.cashBalanceCents,
      action_count: actionCount,
    },
    actions: [
      ...(data.missingReceipts > 0
        ? [{ label_key: 'proactive.upload_now', callback_data: 'action:upload_receipts', style: 'primary' as const }]
        : []),
      { label_key: 'common.view_details', callback_data: 'action:view_dashboard' },
    ],
  };
}
