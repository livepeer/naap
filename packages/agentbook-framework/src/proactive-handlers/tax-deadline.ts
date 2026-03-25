/**
 * Tax Deadline Reminder — Fires 7 and 3 days before quarterly deadlines.
 * Trigger: Calendar engine (hourly check)
 */
import type { ProactiveMessage } from '../proactive-engine.js';

export interface TaxDeadlineData {
  tenantId: string;
  daysUntil: number;
  quarter: string;
  amountDueCents: number;
  jurisdiction: string;
  actionUrl?: string;
}

export function handleTaxDeadline(data: TaxDeadlineData): ProactiveMessage {
  return {
    id: `tax-deadline-${data.tenantId}-${data.quarter}-${data.daysUntil}d`,
    tenant_id: data.tenantId,
    category: 'tax_deadline',
    urgency: data.daysUntil <= 3 ? 'critical' : 'important',
    title_key: 'tax.quarterly_due',
    body_key: 'tax.quarterly_due',
    body_params: {
      days: data.daysUntil,
      amount: data.amountDueCents,
      quarter: data.quarter,
    },
    actions: [
      ...(data.actionUrl ? [{ label_key: 'tax.pay_now', callback_data: `open_url:${data.actionUrl}`, style: 'primary' as const }] : []),
      { label_key: 'tax.adjust', callback_data: `view:tax-quarterly` },
      { label_key: 'tax.remind_later', callback_data: `snooze_1d:tax-${data.quarter}` },
    ],
  };
}
