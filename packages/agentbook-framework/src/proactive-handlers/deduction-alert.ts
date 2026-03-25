/**
 * Deduction Hunting Alert — Proactively suggests missing deductions.
 * Trigger: Weekly analysis or on significant income change
 */
import type { ProactiveMessage } from '../proactive-engine.js';

export interface DeductionAlertData {
  tenantId: string;
  category: string;
  description: string;
  estimatedSavingsCents: number;
  suggestion: string;
}

export function handleDeductionAlert(data: DeductionAlertData): ProactiveMessage {
  return {
    id: `deduction-${data.tenantId}-${data.category}`,
    tenant_id: data.tenantId,
    category: 'deduction_hint',
    urgency: data.estimatedSavingsCents > 100000 ? 'important' : 'informational',
    title_key: 'tax.deduction_found',
    body_key: 'tax.deduction_found',
    body_params: {
      category: data.category,
      suggestion: data.description,
      savings: data.estimatedSavingsCents,
    },
    actions: [
      { label_key: 'common.view_details', callback_data: `view:deductions` },
      { label_key: 'common.dismiss', callback_data: `dismiss:deduction-${data.category}` },
    ],
  };
}
