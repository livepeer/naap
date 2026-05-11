/**
 * Slot accumulator. Drives multi-turn clarification: when an intent
 * needs N pieces of info but the user's message only carries M < N,
 * the bot asks for one missing slot at a time and remembers the
 * partial fill in the conversation context.
 *
 * Pure rule table — each intent declares its required slots and the
 * follow-up question for each. The webhook adapter wires this in:
 *
 *    1. User: "invoice Beta"
 *    2. Parser fills clientNameHint=Beta but amountCents is missing.
 *    3. accumulator says missing='amountCents', question="How much
 *       should the invoice be for?". Bot asks; saves PendingSlots.
 *    4. User: "$5K for the new website"
 *    5. Parser re-runs against the user's reply; amountCents=500000
 *       and description='the new website'. accumulator says all slots
 *       filled — execute the intent.
 */

import 'server-only';

export interface SlotSchema {
  /** Slot key (same name the executor reads). */
  key: string;
  /** Human-readable label used in error/clarify messages. */
  label: string;
  /** Question to ask when this slot is missing AND it's the next one to fill. */
  question: string;
  /** Validator — returns true if the value passes minimum bar (e.g. amount>0). */
  validate?: (v: unknown) => boolean;
}

export interface IntentSlotSpec {
  intent: string;
  required: SlotSchema[];
}

/**
 * Registry. Add new intents as we want multi-turn fill for them.
 * Order matters: slots are asked in the order they appear.
 */
export const SLOT_SPECS: IntentSlotSpec[] = [
  {
    intent: 'create_invoice_from_chat',
    required: [
      {
        key: 'clientNameHint',
        label: 'client',
        question: 'Who\'s the invoice for? Just the client name works ("Acme", "Beta Inc.").',
        validate: (v) => typeof v === 'string' && v.trim().length > 0,
      },
      {
        key: 'amountCents',
        label: 'amount',
        question: 'How much? You can say it like "$5,000" or "5K".',
        validate: (v) => typeof v === 'number' && v > 0,
      },
    ],
  },
  {
    intent: 'create_estimate',
    required: [
      {
        key: 'clientNameHint',
        label: 'client',
        question: 'Who\'s the estimate for? Just the client name works.',
        validate: (v) => typeof v === 'string' && v.trim().length > 0,
      },
      {
        key: 'amountCents',
        label: 'amount',
        question: 'How much? You can say it like "$4,000" or "4K".',
        validate: (v) => typeof v === 'number' && v > 0,
      },
      {
        key: 'description',
        label: 'description',
        question: 'What\'s the estimate for? One line is fine ("new website", "Q2 retainer").',
        validate: (v) => typeof v === 'string' && v.trim().length > 0,
      },
    ],
  },
  {
    intent: 'record_per_diem',
    required: [
      {
        key: 'cityHint',
        label: 'city',
        question: 'Which city are you traveling to? ("NYC", "San Francisco")',
        validate: (v) => typeof v === 'string' && v.trim().length > 0,
      },
      {
        key: 'days',
        label: 'days',
        question: 'How many days? (1-30)',
        validate: (v) => typeof v === 'number' && v >= 1 && v <= 30,
      },
    ],
  },
  {
    intent: 'set_budget',
    required: [
      {
        key: 'amountCents',
        label: 'amount',
        question: 'What\'s the cap? ("$200", "$500/mo")',
        validate: (v) => typeof v === 'number' && v > 0,
      },
      {
        key: 'categoryNameHint',
        label: 'category',
        question: 'Which category? ("Meals", "Travel", or "Total" for everything)',
        validate: (v) => typeof v === 'string' && v.trim().length > 0,
      },
    ],
  },
];

export interface SlotStatus {
  /** Filled slots so far. */
  filled: Record<string, unknown>;
  /** Missing slot keys in order. */
  missing: string[];
  /** First missing slot to ask about, if any. */
  awaiting: SlotSchema | null;
  /** True if every required slot has a valid value. */
  complete: boolean;
}

/**
 * Evaluate which slots are filled for a given intent.
 */
export function evaluateSlots(
  intent: string,
  candidate: Record<string, unknown>,
): SlotStatus {
  const spec = SLOT_SPECS.find((s) => s.intent === intent);
  if (!spec) {
    return { filled: { ...candidate }, missing: [], awaiting: null, complete: true };
  }

  const filled: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const slot of spec.required) {
    const v = candidate[slot.key];
    const ok = v != null && (slot.validate ? slot.validate(v) : true);
    if (ok) {
      filled[slot.key] = v;
    } else {
      missing.push(slot.key);
    }
  }

  // Always preserve non-required hints (description, dueDateHint, ...)
  // so the parser's optional outputs survive across turns.
  for (const [k, v] of Object.entries(candidate)) {
    if (!(k in filled) && !missing.includes(k) && v != null) {
      filled[k] = v;
    }
  }

  const awaiting = missing.length === 0
    ? null
    : spec.required.find((s) => s.key === missing[0]) ?? null;
  return {
    filled,
    missing,
    awaiting,
    complete: missing.length === 0,
  };
}

/**
 * Merge a fresh parse on top of previously-filled slots. Later (the
 * user's most-recent reply) wins per-field — so a user can correct
 * themselves mid-flow ("actually $3K not $5K").
 */
export function mergeSlots(
  prior: Record<string, unknown>,
  fresh: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...prior };
  for (const [k, v] of Object.entries(fresh)) {
    if (v != null && v !== '') out[k] = v;
  }
  return out;
}
