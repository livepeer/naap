/**
 * Contractor Threshold Warning — "You've paid Alex $550. Next payment triggers 1099/T4A."
 * Trigger: After recording expense to a contractor vendor
 */
import type { ProactiveMessage } from '../proactive-engine.js';

export interface ContractorThresholdData {
  tenantId: string;
  contractorName: string;
  totalPaidCents: number;
  thresholdCents: number;
  jurisdiction: string;
  formId: string; // 1099-NEC or T4A
}

export function handleContractorThreshold(data: ContractorThresholdData): ProactiveMessage | null {
  // Alert when within 90% of threshold
  if (data.totalPaidCents < data.thresholdCents * 0.9) return null;
  const overThreshold = data.totalPaidCents >= data.thresholdCents;

  return {
    id: `contractor-${data.tenantId}-${data.contractorName}-${data.thresholdCents}`,
    tenant_id: data.tenantId,
    category: 'tax_deadline',
    urgency: overThreshold ? 'important' : 'informational',
    title_key: overThreshold ? 'proactive.contractor_over_threshold' : 'proactive.contractor_near_threshold',
    body_key: overThreshold ? 'proactive.contractor_over_threshold' : 'proactive.contractor_near_threshold',
    body_params: {
      name: data.contractorName,
      total_paid: data.totalPaidCents,
      threshold: data.thresholdCents,
      form: data.formId,
    },
    actions: [
      { label_key: 'common.view_details', callback_data: 'view:contractor-reports' },
    ],
  };
}
