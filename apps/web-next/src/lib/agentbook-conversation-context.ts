/**
 * Conversation context for the Telegram bot.
 *
 * Every turn of a bot ↔ user interaction carries memory: what the bot
 * just said, which entities it mentioned (so "the second one" or
 * "INV-007" resolves), what multi-turn slot fill is in flight, and a
 * short rolling history of recent turns to feed the LLM classifier.
 *
 * Storage: a single `AbUserMemory` row per chat keyed by
 * `telegram:conv_ctx:<chatId>` (or `:<tenantId>` when the chat ID
 * isn't known — the bot path always knows it though). Context expires
 * after 10 minutes of inactivity so an old "first one" pronoun can't
 * resolve to an entity from yesterday's conversation.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface MentionedEntity {
  /** 1-based index matching the order the bot listed it in. */
  index: number;
  /** What kind of thing this is, for downstream dispatch. */
  kind: 'invoice' | 'expense' | 'client' | 'todo' | 'budget' | 'mileage' | 'deduction' | 'recurring' | 'estimate' | 'bank_txn';
  /** Stable DB id of the underlying row. */
  id: string;
  /** Short human-readable label the user might echo back. */
  label: string;
  /** Optional short code the user is likely to abbreviate to. */
  shortCode?: string;
}

export interface PendingSlots {
  /** Which intent we're filling slots for, e.g. 'create_invoice_from_chat'. */
  intent: string;
  /** Slots filled so far. */
  filled: Record<string, unknown>;
  /** The next slot the bot is waiting on. */
  awaiting: string;
  /** Human-readable question the bot asked. */
  question: string;
  /** ISO timestamp the question was asked; used for staleness check. */
  askedAt: string;
}

export interface ConversationTurn {
  role: 'user' | 'bot';
  text: string;
  at: string;
}

export interface ConversationContext {
  /** Short label for what topic the bot last spoke on. */
  lastBotTopic: string | null;
  /** Last 3 turns (alternating user/bot), oldest first. */
  recentTurns: ConversationTurn[];
  /** Entities the bot just listed, addressable by index/shortCode/label. */
  mentionedEntities: MentionedEntity[];
  /** Multi-turn slot accumulator, or null if no fill is in flight. */
  pendingSlots: PendingSlots | null;
  /** ISO timestamp of the last context update. */
  lastActiveAt: string;
}

/** Context older than this is considered stale and not used for reference resolution. */
export const CONTEXT_TTL_MS = 10 * 60 * 1000;

/** Cap how many recent turns we keep. Three is enough for "yes/no/which?" loops. */
export const MAX_RECENT_TURNS = 3;

function keyFor(chatId: string | number): string {
  return `telegram:conv_ctx:${chatId}`;
}

function emptyContext(): ConversationContext {
  return {
    lastBotTopic: null,
    recentTurns: [],
    mentionedEntities: [],
    pendingSlots: null,
    lastActiveAt: new Date().toISOString(),
  };
}

/**
 * Load the current conversation context. Returns a fresh empty context
 * if no row exists or the existing row is past TTL. Never throws.
 */
export async function getContext(
  tenantId: string,
  chatId: string | number,
): Promise<ConversationContext> {
  try {
    const row = await db.abUserMemory.findUnique({
      where: { tenantId_key: { tenantId, key: keyFor(chatId) } },
    });
    if (!row) return emptyContext();
    const parsed = JSON.parse(row.value) as ConversationContext;
    const lastActive = new Date(parsed.lastActiveAt).getTime();
    if (!isFinite(lastActive) || Date.now() - lastActive > CONTEXT_TTL_MS) {
      return emptyContext();
    }
    return parsed;
  } catch {
    return emptyContext();
  }
}

/**
 * Persist context. Best-effort — a write failure logs but doesn't
 * disrupt the underlying turn (the bot can still reply even if memory
 * write fails).
 */
export async function setContext(
  tenantId: string,
  chatId: string | number,
  ctx: ConversationContext,
): Promise<void> {
  try {
    const value = JSON.stringify({ ...ctx, lastActiveAt: new Date().toISOString() });
    await db.abUserMemory.upsert({
      where: { tenantId_key: { tenantId, key: keyFor(chatId) } },
      update: { value, lastUsed: new Date() },
      create: { tenantId, key: keyFor(chatId), value, type: 'context', confidence: 1 },
    });
  } catch (err) {
    console.warn('[conv-context] write failed (non-fatal):', err);
  }
}

/**
 * Convenience: append a user/bot turn, capping the history at
 * MAX_RECENT_TURNS. Returns the updated context but does not persist —
 * caller is expected to set the rest of the context shape and call
 * setContext once at the end of the turn.
 */
export function appendTurn(
  ctx: ConversationContext,
  role: 'user' | 'bot',
  text: string,
  now: Date = new Date(),
): ConversationContext {
  const trimmed = text.length > 300 ? text.slice(0, 297) + '...' : text;
  const turn: ConversationTurn = { role, text: trimmed, at: now.toISOString() };
  const recentTurns = [...ctx.recentTurns, turn].slice(-MAX_RECENT_TURNS);
  return { ...ctx, recentTurns };
}

/**
 * Replace the mentioned entities. Called whenever the bot's reply
 * surfaces a list — review queue, picker, TODO. Subsequent user
 * messages can then refer to "1", "the second", "INV-007", etc.
 */
export function setMentionedEntities(
  ctx: ConversationContext,
  entities: MentionedEntity[],
  topic?: string,
): ConversationContext {
  return {
    ...ctx,
    mentionedEntities: entities,
    lastBotTopic: topic ?? ctx.lastBotTopic,
  };
}

/**
 * Clear the entity list. Use after the user picks one (so a later
 * stray "first one" doesn't resolve against a stale list) or after a
 * topic shift.
 */
export function clearMentionedEntities(ctx: ConversationContext): ConversationContext {
  return { ...ctx, mentionedEntities: [] };
}

export function setPendingSlots(
  ctx: ConversationContext,
  pending: PendingSlots | null,
): ConversationContext {
  return { ...ctx, pendingSlots: pending };
}
