/**
 * Cash Flow Warning — "Cash drops to $1,200 on April 3"
 * Trigger: After cash flow projection recalculation
 */
import type { ProactiveMessage } from '../proactive-engine.js';

export interface CashFlowWarningData {
  tenantId: string;
  projectedLowBalanceCents: number;
  projectedLowDate: string;
  pendingBillsCents: number;
  expectedIncomeCents: number;
  suggestion: string; // "Follow up on overdue Acme invoice?"
}

export function handleCashFlowWarning(data: CashFlowWarningData): ProactiveMessage | null {
  if (data.projectedLowBalanceCents >= 0) return null; // No warning needed if positive

  return {
    id: `cashflow-warning-${data.tenantId}-${data.projectedLowDate}`,
    tenant_id: data.tenantId,
    category: 'cash_flow_warning',
    urgency: data.projectedLowBalanceCents < -100000 ? 'critical' : 'important',
    title_key: 'proactive.cash_flow_warning',
    body_key: 'proactive.cash_flow_warning',
    body_params: {
      low_balance: data.projectedLowBalanceCents,
      date: data.projectedLowDate,
      bills: data.pendingBillsCents,
      income: data.expectedIncomeCents,
      suggestion: data.suggestion,
    },
    actions: [
      { label_key: 'common.view_details', callback_data: 'view:cashflow', style: 'primary' },
      { label_key: 'proactive.remind_later', callback_data: 'snooze_3d:cashflow-warning' },
    ],
  };
}
