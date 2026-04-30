/**
 * Insights Agent — Discovers patterns in financial data you can't see.
 * Runs nightly analytics, surfaces top insights weekly.
 */

import type { AgentProfile } from './types.js';

export const insightsProfile: AgentProfile = {
  id: 'insights',
  name: 'Insights',
  description: 'Runs analytics pipeline to discover patterns, trends, anomalies, and opportunities. Delivers top insights via Telegram weekly.',
  ownedSkills: ['expense-analytics', 'financial-copilot', 'pattern-learning'],
  ownedIntents: ['financial_advice', 'subscription_audit', 'concentration_check', 'pricing_suggestion', 'what_if_scenario', 'analyze_expenses'],
  metrics: {
    totalActions: 0,
    successRate: 1.0,
    avgLatencyMs: 0,
    lastActiveAt: '',
    customMetrics: {
      insightsDelivered: 0,
      insightsActedOn: 0,
      actionRate: 0,
    },
  },
  config: {
    aggressiveness: 0.5,
    autoApprove: true,         // Insights are read-only, safe to auto-deliver
    notificationFrequency: 'weekly',
    modelTier: 'standard',
  },
};
