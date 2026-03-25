/**
 * Bank Anomaly Alert — Unusual bank transaction detected.
 * Trigger: After bank sync, when unmatched tx has unusual amount
 */
import type { ProactiveMessage } from '../proactive-engine.js';

export interface BankAnomalyData {
  tenantId: string;
  transactionId: string;
  merchantName: string;
  amountCents: number;
  date: string;
  suggestedCategory?: string;
}

export function handleBankAnomaly(data: BankAnomalyData): ProactiveMessage {
  return {
    id: `bank-anomaly-${data.transactionId}`,
    tenant_id: data.tenantId,
    category: 'receipt_reminder', // reuse category
    urgency: data.amountCents > 50000 ? 'important' : 'informational',
    title_key: 'proactive.receipt_reminder',
    body_key: 'proactive.receipt_reminder',
    body_params: {
      merchant: data.merchantName,
      amount: data.amountCents,
      date: data.date,
      category: data.suggestedCategory,
    },
    actions: [
      { label_key: 'common.correct', callback_data: `confirm_bank:${data.transactionId}`, style: 'primary' },
      { label_key: 'common.mark_personal', callback_data: `personal_bank:${data.transactionId}` },
      { label_key: 'common.dismiss', callback_data: `ignore_bank:${data.transactionId}` },
    ],
  };
}
