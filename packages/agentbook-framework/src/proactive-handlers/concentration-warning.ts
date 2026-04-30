import type { ProactiveMessage } from '../proactive-engine.js';

export interface ConcentrationWarningData {
  tenantId: string;
  clientName: string;
  revenueShare: number;
}

export function handleConcentrationWarning(data: ConcentrationWarningData): ProactiveMessage | null {
  if (data.revenueShare < 0.4) return null;
  return {
    id: `concentration-${data.tenantId}-${data.clientName}`,
    tenant_id: data.tenantId,
    category: 'cash_flow_warning' as any,
    urgency: data.revenueShare > 0.7 ? 'critical' : 'important',
    title_key: 'proactive.concentration_warning',
    body_key: 'proactive.concentration_warning',
    body_params: { client: data.clientName, share: Math.round(data.revenueShare * 100) },
    actions: [
      { label_key: 'common.view_details', callback_data: 'view:concentration' },
    ],
  };
}
