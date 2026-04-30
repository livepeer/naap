/**
 * Year-End Closing Checklist — "Ready to close 2026? 2 items need attention."
 * Trigger: December cron
 */
import type { ProactiveMessage } from '../proactive-engine.js';

export interface YearEndClosingData {
  tenantId: string;
  year: number;
  pendingItems: string[];
  allClear: boolean;
}

export function handleYearEndClosingChecklist(data: YearEndClosingData): ProactiveMessage | null {
  if (data.allClear) {
    return {
      id: `year-close-ready-${data.tenantId}-${data.year}`,
      tenant_id: data.tenantId,
      category: 'daily_pulse' as any,
      urgency: 'informational',
      title_key: 'proactive.year_end_ready',
      body_key: 'proactive.year_end_ready',
      body_params: { year: data.year },
      actions: [
        { label_key: 'calendar.action_review', callback_data: `action:close-year-${data.year}`, style: 'primary' },
      ],
    };
  }

  return {
    id: `year-close-pending-${data.tenantId}-${data.year}`,
    tenant_id: data.tenantId,
    category: 'tax_deadline',
    urgency: 'important',
    title_key: 'proactive.year_end_checklist',
    body_key: 'proactive.year_end_checklist',
    body_params: {
      year: data.year,
      count: data.pendingItems.length,
      items: data.pendingItems.join(', '),
    },
    actions: [
      { label_key: 'common.view_details', callback_data: 'view:year-end-checklist', style: 'primary' },
      { label_key: 'proactive.remind_later', callback_data: `snooze_7d:year-close-${data.year}` },
    ],
  };
}
