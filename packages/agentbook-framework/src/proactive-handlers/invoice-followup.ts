/**
 * Invoice Follow-Up — Chase overdue invoices.
 * Trigger: Event (invoice.overdue) or daily check
 *
 * "Acme Corp is 7 days overdue on $5,000. Send a reminder?"
 */

import type { ProactiveMessage } from '../proactive-engine.js';

export interface InvoiceFollowUpData {
  tenantId: string;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  amountCents: number;
  daysOverdue: number;
}

export function handleInvoiceFollowUp(data: InvoiceFollowUpData): ProactiveMessage {
  const urgency = data.daysOverdue > 30 ? 'critical' : data.daysOverdue > 7 ? 'important' : 'informational';

  return {
    id: `invoice-followup-${data.invoiceId}-${data.daysOverdue}d`,
    tenant_id: data.tenantId,
    category: 'invoice_followup',
    urgency,
    title_key: 'invoice.invoice_overdue',
    body_key: 'invoice.invoice_overdue',
    body_params: {
      client: data.clientName,
      days: data.daysOverdue,
      amount: data.amountCents,
    },
    actions: [
      { label_key: 'invoice.send_reminder', callback_data: `send_reminder:${data.invoiceId}`, style: 'primary' },
      { label_key: 'invoice.wait', callback_data: `snooze_3d:invoice-${data.invoiceId}` },
      { label_key: 'invoice.skip', callback_data: `dismiss:invoice-${data.invoiceId}` },
    ],
  };
}
