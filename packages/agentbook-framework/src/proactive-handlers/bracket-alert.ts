/**
 * Tax Bracket Alert — Warn when user is close to the next tax bracket.
 * "You're $3,000 from the next bracket. Prepay expenses to save ~$660."
 * Trigger: After tax estimate recalculation or monthly
 */

import type { ProactiveMessage } from '../proactive-engine.js';

export interface BracketAlertData {
  tenantId: string;
  currentIncomeCents: number;
  nextBracketThresholdCents: number;
  currentRate: number;
  nextRate: number;
  gapCents: number;
  potentialSavingsCents: number;
  jurisdiction: string;
}

export function handleBracketAlert(data: BracketAlertData): ProactiveMessage | null {
  // Only alert when within $5,000 of next bracket
  if (data.gapCents > 500000 || data.gapCents <= 0) return null;

  return {
    id: `bracket-alert-${data.tenantId}-${data.currentRate}`,
    tenant_id: data.tenantId,
    category: 'deduction_hint',
    urgency: data.gapCents < 200000 ? 'important' : 'informational',
    title_key: 'tax.bracket_alert',
    body_key: 'tax.bracket_alert',
    body_params: {
      amount: data.gapCents,
      savings: data.potentialSavingsCents,
      current_rate: `${(data.currentRate * 100).toFixed(0)}%`,
      next_rate: `${(data.nextRate * 100).toFixed(0)}%`,
    },
    actions: [
      { label_key: 'tax.adjust', callback_data: 'view:tax-deductions', style: 'primary' },
      { label_key: 'common.view_details', callback_data: 'view:tax-estimate' },
      { label_key: 'common.dismiss', callback_data: `dismiss:bracket-${data.currentRate}` },
    ],
  };
}

/**
 * Calculate bracket gap from tax estimate data.
 * Returns null if not near a bracket boundary.
 */
export function calculateBracketGap(
  netIncomeCents: number,
  brackets: { min: number; max: number | null; rate: number }[],
): { gapCents: number; currentRate: number; nextRate: number; potentialSavingsCents: number } | null {
  for (let i = 0; i < brackets.length - 1; i++) {
    const bracket = brackets[i];
    const nextBracket = brackets[i + 1];

    if (netIncomeCents >= bracket.min && (bracket.max === null || netIncomeCents < bracket.max)) {
      const gapCents = (bracket.max || Infinity) - netIncomeCents;

      if (gapCents <= 500000 && gapCents > 0) {
        const rateDiff = nextBracket.rate - bracket.rate;
        const potentialSavings = Math.round(gapCents * rateDiff);

        return {
          gapCents,
          currentRate: bracket.rate,
          nextRate: nextBracket.rate,
          potentialSavingsCents: potentialSavings,
        };
      }
      return null;
    }
  }
  return null;
}
