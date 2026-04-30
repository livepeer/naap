/**
 * Unbilled Hours Alert — "You spent 12 hours on Acme this week = $1,800 unbilled"
 * Trigger: Weekly or after time entry exceeds threshold
 */
import type { ProactiveMessage } from '../proactive-engine.js';

export interface UnbilledHoursData {
  tenantId: string;
  clientName: string;
  totalHours: number;
  hourlyRateCents: number;
  unbilledAmountCents: number;
  daysSinceOldest: number;
}

export function handleUnbilledHours(data: UnbilledHoursData): ProactiveMessage | null {
  if (data.unbilledAmountCents < 10000) return null; // Don't alert under $100

  return {
    id: `unbilled-${data.tenantId}-${data.clientName}-${new Date().toISOString().slice(0, 10)}`,
    tenant_id: data.tenantId,
    category: 'invoice_followup',
    urgency: data.unbilledAmountCents > 100000 ? 'important' : 'informational',
    title_key: 'proactive.unbilled_hours',
    body_key: 'proactive.unbilled_hours',
    body_params: {
      client: data.clientName,
      hours: data.totalHours,
      rate: data.hourlyRateCents,
      amount: data.unbilledAmountCents,
    },
    actions: [
      { label_key: 'invoice.create_invoice', callback_data: `auto_invoice:${data.clientName}`, style: 'primary' },
      { label_key: 'proactive.remind_later', callback_data: `snooze_7d:unbilled-${data.clientName}` },
    ],
  };
}
