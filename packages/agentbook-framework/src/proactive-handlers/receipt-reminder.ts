/**
 * Receipt Reminder — Nudge about expenses without receipts.
 * Trigger: Daily cron or after bank sync
 *
 * "You have 3 bank transactions this week without receipts."
 */

import type { ProactiveMessage } from '../proactive-engine.js';

export interface ReceiptReminderData {
  tenantId: string;
  missingCount: number;
  totalAmountCents: number;
}

export function handleReceiptReminder(data: ReceiptReminderData): ProactiveMessage | null {
  // Don't nag if no missing receipts
  if (data.missingCount === 0) return null;

  return {
    id: `receipt-reminder-${data.tenantId}-${new Date().toISOString().split('T')[0]}`,
    tenant_id: data.tenantId,
    category: 'receipt_reminder',
    urgency: data.missingCount > 5 ? 'important' : 'informational',
    title_key: 'proactive.receipt_reminder',
    body_key: 'proactive.receipt_reminder',
    body_params: {
      count: data.missingCount,
    },
    actions: [
      { label_key: 'proactive.upload_now', callback_data: 'action:upload_receipts', style: 'primary' },
      { label_key: 'proactive.remind_later', callback_data: 'snooze_1d:receipt-reminder' },
    ],
  };
}
