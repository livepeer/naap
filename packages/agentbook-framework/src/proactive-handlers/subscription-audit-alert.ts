import type { ProactiveMessage } from '../proactive-engine.js';

export interface SubscriptionAuditAlertData {
  tenantId: string;
  unusedCount: number;
  potentialSavingsCents: number;
}

export function handleSubscriptionAuditAlert(data: SubscriptionAuditAlertData): ProactiveMessage | null {
  if (data.unusedCount === 0) return null;
  return {
    id: `sub-audit-${data.tenantId}-${new Date().toISOString().slice(0, 7)}`,
    tenant_id: data.tenantId,
    category: 'deduction_hint' as any,
    urgency: data.potentialSavingsCents > 100000 ? 'important' : 'informational',
    title_key: 'proactive.subscription_audit',
    body_key: 'proactive.subscription_audit',
    body_params: { count: data.unusedCount, savings: data.potentialSavingsCents },
    actions: [
      { label_key: 'common.view_details', callback_data: 'view:subscription-audit', style: 'primary' },
      { label_key: 'common.dismiss', callback_data: 'dismiss:sub-audit' },
    ],
  };
}
