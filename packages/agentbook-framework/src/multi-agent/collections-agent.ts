/**
 * Collections Agent — Ensures you get paid on time.
 * Learns per-client optimal reminder timing and adjusts tone.
 */

import type { AgentProfile } from './types.js';

export const collectionsProfile: AgentProfile = {
  id: 'collections',
  name: 'Collections',
  description: 'Manages invoice follow-up, payment prediction, and escalation. Learns each client\'s payment pattern and adjusts reminder timing/tone.',
  ownedSkills: ['invoice-creation', 'earnings-projection', 'time-tracking'],
  ownedIntents: ['create_invoice', 'send_invoice', 'record_payment', 'auto_invoice_time'],
  metrics: {
    totalActions: 0,
    successRate: 1.0,
    avgLatencyMs: 0,
    lastActiveAt: '',
    customMetrics: {
      dsoReduction: 0,          // Days Sales Outstanding improvement
      paymentPredictionAccuracy: 0,
      remindersEffectiveness: 0,
    },
  },
  config: {
    aggressiveness: 0.3,       // Start gentle
    autoApprove: false,
    notificationFrequency: 'daily',
    modelTier: 'fast',
  },
};
