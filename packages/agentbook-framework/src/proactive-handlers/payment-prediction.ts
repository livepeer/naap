/**
 * Client Payment Prediction — "Acme will likely pay next Tuesday"
 * Trigger: Daily for outstanding invoices
 */
import type { ProactiveMessage } from '../proactive-engine.js';

export interface PaymentPredictionData {
  tenantId: string;
  clientName: string;
  invoiceNumber: string;
  amountCents: number;
  predictedPayDate: string;
  avgDaysToPay: number;
  daysOverdue: number;
  confidence: number;
}

export function handlePaymentPrediction(data: PaymentPredictionData): ProactiveMessage | null {
  if (data.confidence < 0.4) return null; // Not enough data

  const daysUntilPredicted = Math.ceil(
    (new Date(data.predictedPayDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  // Only alert within 7 days of predicted payment or if overdue
  if (daysUntilPredicted > 7 && data.daysOverdue <= 0) return null;

  const isOverdue = data.daysOverdue > 0;

  return {
    id: `prediction-${data.tenantId}-${data.invoiceNumber}`,
    tenant_id: data.tenantId,
    category: 'invoice_followup',
    urgency: isOverdue ? 'important' : 'informational',
    title_key: 'proactive.payment_prediction',
    body_key: 'proactive.payment_prediction',
    body_params: {
      client: data.clientName,
      invoice: data.invoiceNumber,
      amount: data.amountCents,
      predicted_date: data.predictedPayDate,
      avg_days: data.avgDaysToPay,
    },
    actions: isOverdue
      ? [
          { label_key: 'invoice.send_reminder', callback_data: `send_reminder:${data.invoiceNumber}`, style: 'primary' },
          { label_key: 'invoice.wait', callback_data: `snooze_3d:prediction-${data.invoiceNumber}` },
        ]
      : [
          { label_key: 'common.view_details', callback_data: `view:invoice-${data.invoiceNumber}` },
        ],
  };
}
