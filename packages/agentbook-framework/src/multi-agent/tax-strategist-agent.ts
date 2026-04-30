/**
 * Tax Strategist Agent — Continuously monitors tax position and optimizes strategy.
 * Jurisdiction-aware: switches approach based on US/CA/UK/AU rules.
 */

import type { AgentProfile } from './types.js';

export const taxStrategistProfile: AgentProfile = {
  id: 'tax-strategist',
  name: 'Tax Strategist',
  description: 'Monitors tax position, hunts for deductions, manages quarterly payments, generates tax forms. Jurisdiction-aware.',
  ownedSkills: ['tax-estimation', 'deduction-hunting', 'tax-forms', 'contractor-reporting', 'mileage-tracking', 'year-end-closing'],
  ownedIntents: ['estimate_tax', 'suggest_deductions', 'request_report', 'generate_tax_forms'],
  metrics: {
    totalActions: 0,
    successRate: 1.0,
    avgLatencyMs: 0,
    lastActiveAt: '',
    customMetrics: {
      taxSavingsIdentifiedCents: 0,
      estimateAccuracy: 0,
      deductionsFound: 0,
    },
  },
  config: {
    aggressiveness: 0.7,
    autoApprove: false,
    notificationFrequency: 'weekly',
    modelTier: 'standard',
  },
};
