/**
 * Bookkeeper Agent — Handles ALL expense recording, categorization, and reconciliation.
 * Goal: > 95% auto-categorization accuracy, < 5% reconciliation exception rate.
 */

import type { AgentProfile } from './types.js';

export const bookkeeperProfile: AgentProfile = {
  id: 'bookkeeper',
  name: 'Bookkeeper',
  description: 'Handles expense recording, categorization, vendor patterns, and bank reconciliation. Gets smarter with every transaction.',
  ownedSkills: ['expense-recording', 'receipt-ocr', 'bank-sync', 'pattern-learning', 'anomaly-detection'],
  ownedIntents: ['record_expense', 'categorize_expense', 'process_receipt', 'sync_bank_transactions', 'reconcile'],
  metrics: {
    totalActions: 0,
    successRate: 1.0,
    avgLatencyMs: 0,
    lastActiveAt: '',
    customMetrics: {
      categorizationAccuracy: 0,
      reconciliationMatchRate: 0,
      exceptionRate: 0,
    },
  },
  config: {
    aggressiveness: 0.5,
    autoApprove: false,
    notificationFrequency: 'realtime',
    modelTier: 'fast',
  },
};
