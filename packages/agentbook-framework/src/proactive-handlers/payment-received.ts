/**
 * Payment Received — Celebrate money coming in.
 * Trigger: Event (payment.received)
 *
 * "Acme Corp just paid $5,000! Net after Stripe fees: $4,854.50."
 */

import type { ProactiveMessage } from '../proactive-engine.js';

export interface PaymentReceivedData {
  tenantId: string;
  clientName: string;
  invoiceNumber: string;
  amountCents: number;
  feesCents: number;
  netAmountCents: number;
  method: string;
}

export function handlePaymentReceived(data: PaymentReceivedData): ProactiveMessage {
  return {
    id: `payment-received-${data.invoiceNumber}-${Date.now()}`,
    tenant_id: data.tenantId,
    category: 'payment_received',
    urgency: 'informational',
    title_key: 'proactive.payment_received',
    body_key: 'proactive.payment_received',
    body_params: {
      client: data.clientName,
      amount: data.amountCents,
      net_amount: data.netAmountCents,
    },
    actions: [
      { label_key: 'invoice.view_invoice', callback_data: `view:invoice-${data.invoiceNumber}` },
    ],
  };
}
