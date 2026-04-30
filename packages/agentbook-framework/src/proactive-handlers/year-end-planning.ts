/**
 * Year-End Planning — November optimization report.
 * "4 actions could save $2,840. [View optimization report]"
 * Trigger: November 1st cron
 */
import type { ProactiveMessage } from '../proactive-engine.js';

export interface YearEndPlanningData {
  tenantId: string;
  actionCount: number;
  potentialSavingsCents: number;
  actions: string[];
}

export function handleYearEndPlanning(data: YearEndPlanningData): ProactiveMessage | null {
  if (data.actionCount === 0) return null;

  return {
    id: `year-end-${data.tenantId}-${new Date().getFullYear()}`,
    tenant_id: data.tenantId,
    category: 'deduction_hint' as any,
    urgency: data.potentialSavingsCents > 200000 ? 'important' : 'informational',
    title_key: 'proactive.year_end_planning',
    body_key: 'proactive.year_end_planning',
    body_params: {
      count: data.actionCount,
      savings: data.potentialSavingsCents,
    },
    actions: [
      { label_key: 'proactive.view_report', callback_data: 'view:year-end-report', style: 'primary' },
      { label_key: 'proactive.remind_later', callback_data: 'snooze_7d:year-end' },
    ],
  };
}
