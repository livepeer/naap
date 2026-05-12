/**
 * Conversation thread store — one row per (tenantId, channel, chatId) at
 * any moment with status='active'. Every coherent unit of dialogue lives
 * inside one thread; thread boundaries are managed in later PRs (idle
 * timeout, length cap, topic shift). This module is the foundation.
 *
 * What this owns:
 *   • openThread()       — return the active thread, or open a fresh one
 *   • addTurn()          — append role+text to verbatim history (capped 6)
 *   • setFocus()         — pick which entity "this" / "fix it" resolves to
 *   • attachEntity()     — add to the working set the user is operating on
 *   • detachEntity()     — remove from working set
 *   • setPendingSlots()  — track in-flight multi-turn slot fill
 *   • setTopic()         — label the thread's current top-level subject
 *   • closeThread()      — terminate with a reason; next addTurn opens fresh
 *
 * Storage: `AbConvThread` Prisma row keyed by (tenantId, channel, chatId,
 * status='active'). Coexists with the legacy `AbUserMemory:telegram:conv_ctx:*`
 * key — those will be retired in PR 2 (focused-entity migration).
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export type Channel = 'telegram' | 'web' | 'api';

export interface ThreadEntity {
  /** What kind of thing this is. */
  kind: 'invoice' | 'expense' | 'client' | 'todo' | 'budget' | 'mileage' | 'deduction' | 'recurring' | 'estimate' | 'bank_txn';
  /** Stable DB id. */
  id: string;
  /** Short human-readable label. */
  label: string;
  /** Optional short code (e.g. "INV-007"). */
  shortCode?: string;
  /** When this was added to the working set. */
  addedAt: string;
}

export interface ThreadTurn {
  role: 'user' | 'bot';
  text: string;
  at: string;
  /** Optional intent label so summarization can preserve "what we decided". */
  intent?: string;
}

export interface PendingSlots {
  intent: string;
  filled: Record<string, unknown>;
  awaiting: string;
  question: string;
  askedAt: string;
}

export interface ConvThread {
  id: string;
  tenantId: string;
  channel: Channel;
  chatId: string;
  status: 'active' | 'closed' | 'archived';
  startedAt: Date;
  lastActiveAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
  activeEntities: ThreadEntity[];
  focusedEntityId: string | null;
  pendingSlots: PendingSlots | null;
  parkedFills: PendingSlots[];
  topic: string | null;
  subtopic: string | null;
  turns: ThreadTurn[];
  turnCount: number;
  summary: string | null;
}

/** How many verbatim turns we keep before summarization (PR 4 implements summarize). */
export const KEEP_TURNS = 6;

/** Max length of one stored turn's text. */
const MAX_TURN_LEN = 300;

/**
 * Return the active thread for this (tenant, channel, chatId), opening
 * a new one if none exists. Never throws — falls back to a fresh
 * in-memory thread when the DB call fails.
 */
export async function openThread(
  tenantId: string,
  channel: Channel,
  chatId: string | number,
): Promise<ConvThread> {
  const chatIdStr = String(chatId);
  try {
    const existing = await db.abConvThread.findFirst({
      where: { tenantId, channel, chatId: chatIdStr, status: 'active' },
      orderBy: { lastActiveAt: 'desc' },
    });
    if (existing) return rowToThread(existing);
    const created = await db.abConvThread.create({
      data: {
        tenantId,
        channel,
        chatId: chatIdStr,
        status: 'active',
        activeEntities: [],
        parkedFills: [],
        turns: [],
      },
    });
    return rowToThread(created);
  } catch (err) {
    console.warn('[agentbook-thread] openThread failed, returning ephemeral:', err);
    return ephemeralThread(tenantId, channel, chatIdStr);
  }
}

/**
 * Append a turn to the thread. Truncates long text. Trims to KEEP_TURNS
 * recent — older content lives in `summary` (populated in PR 4).
 * Bumps `lastActiveAt` and `turnCount`. Best-effort persist.
 */
export async function addTurn(
  thread: ConvThread,
  role: 'user' | 'bot',
  text: string,
  intent?: string,
): Promise<ConvThread> {
  const trimmed = text.length > MAX_TURN_LEN ? text.slice(0, MAX_TURN_LEN - 3) + '...' : text;
  const turn: ThreadTurn = { role, text: trimmed, at: new Date().toISOString(), intent };
  const next: ConvThread = {
    ...thread,
    turns: [...thread.turns, turn].slice(-KEEP_TURNS),
    turnCount: thread.turnCount + 1,
    lastActiveAt: new Date(),
  };
  await persist(next);
  return next;
}

/**
 * Add an entity to the working set. If an entry with the same id already
 * exists, this is a no-op (entities don't get duplicated). The added
 * entity is NOT automatically focused — call setFocus() for that.
 */
export async function attachEntity(thread: ConvThread, entity: Omit<ThreadEntity, 'addedAt'>): Promise<ConvThread> {
  if (thread.activeEntities.some((e) => e.id === entity.id && e.kind === entity.kind)) {
    return thread;
  }
  const next: ConvThread = {
    ...thread,
    activeEntities: [...thread.activeEntities, { ...entity, addedAt: new Date().toISOString() }],
    lastActiveAt: new Date(),
  };
  await persist(next);
  return next;
}

export async function detachEntity(thread: ConvThread, id: string): Promise<ConvThread> {
  const next: ConvThread = {
    ...thread,
    activeEntities: thread.activeEntities.filter((e) => e.id !== id),
    focusedEntityId: thread.focusedEntityId === id ? null : thread.focusedEntityId,
    lastActiveAt: new Date(),
  };
  await persist(next);
  return next;
}

/**
 * Designate which entity is "current". This is what "this" / "fix it" /
 * "more details" resolve to before falling back to the recent-mention list.
 * Pass null to clear focus. If the entity isn't already attached, attach
 * it first (a setFocus on an unknown entity becomes attach+focus).
 */
export async function setFocus(thread: ConvThread, entity: Omit<ThreadEntity, 'addedAt'> | null): Promise<ConvThread> {
  if (!entity) {
    if (thread.focusedEntityId === null) return thread;
    const next: ConvThread = { ...thread, focusedEntityId: null, lastActiveAt: new Date() };
    await persist(next);
    return next;
  }
  // Attach if missing.
  let withEntity = thread;
  if (!thread.activeEntities.some((e) => e.id === entity.id && e.kind === entity.kind)) {
    withEntity = await attachEntity(thread, entity);
  }
  const next: ConvThread = { ...withEntity, focusedEntityId: entity.id, lastActiveAt: new Date() };
  await persist(next);
  return next;
}

export async function setPendingSlots(thread: ConvThread, pending: PendingSlots | null): Promise<ConvThread> {
  const next: ConvThread = { ...thread, pendingSlots: pending, lastActiveAt: new Date() };
  await persist(next);
  return next;
}

export async function setTopic(thread: ConvThread, topic: string | null, subtopic?: string | null): Promise<ConvThread> {
  const next: ConvThread = { ...thread, topic, subtopic: subtopic ?? thread.subtopic, lastActiveAt: new Date() };
  await persist(next);
  return next;
}

/**
 * Terminate the thread. Next openThread() call returns a fresh row.
 * Idempotent: closing an already-closed thread is a no-op.
 */
export async function closeThread(
  thread: ConvThread,
  reason: 'idle_timeout' | 'topic_shift' | 'explicit' | 'length_cap',
): Promise<void> {
  if (thread.status !== 'active') return;
  try {
    await db.abConvThread.update({
      where: { id: thread.id },
      data: { status: 'closed', closedAt: new Date(), closeReason: reason },
    });
  } catch (err) {
    console.warn('[agentbook-thread] closeThread failed (non-fatal):', err);
  }
}

/**
 * Return the currently-focused entity, if any. Cheap helper for call sites
 * that need to resolve "this" / "fix it" — falls back to most-recent
 * mentioned entity if no explicit focus is set.
 */
export function getFocus(thread: ConvThread): ThreadEntity | null {
  if (thread.focusedEntityId) {
    const focused = thread.activeEntities.find((e) => e.id === thread.focusedEntityId);
    if (focused) return focused;
  }
  return thread.activeEntities.length > 0
    ? thread.activeEntities[thread.activeEntities.length - 1]
    : null;
}

// ─── Internal helpers ───────────────────────────────────────────────────

interface ConvThreadRow {
  id: string;
  tenantId: string;
  channel: string;
  chatId: string;
  status: string;
  startedAt: Date;
  lastActiveAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
  activeEntities: unknown;
  focusedEntityId: string | null;
  pendingSlots: unknown;
  parkedFills: unknown;
  topic: string | null;
  subtopic: string | null;
  turns: unknown;
  turnCount: number;
  summary: string | null;
}

function rowToThread(row: ConvThreadRow): ConvThread {
  return {
    id: row.id,
    tenantId: row.tenantId,
    channel: row.channel as Channel,
    chatId: row.chatId,
    status: row.status as 'active' | 'closed' | 'archived',
    startedAt: row.startedAt,
    lastActiveAt: row.lastActiveAt,
    closedAt: row.closedAt,
    closeReason: row.closeReason,
    activeEntities: Array.isArray(row.activeEntities) ? (row.activeEntities as ThreadEntity[]) : [],
    focusedEntityId: row.focusedEntityId,
    pendingSlots: (row.pendingSlots as PendingSlots | null) ?? null,
    parkedFills: Array.isArray(row.parkedFills) ? (row.parkedFills as PendingSlots[]) : [],
    topic: row.topic,
    subtopic: row.subtopic,
    turns: Array.isArray(row.turns) ? (row.turns as ThreadTurn[]) : [],
    turnCount: row.turnCount,
    summary: row.summary,
  };
}

function ephemeralThread(tenantId: string, channel: Channel, chatId: string): ConvThread {
  return {
    id: 'ephemeral',
    tenantId,
    channel,
    chatId,
    status: 'active',
    startedAt: new Date(),
    lastActiveAt: new Date(),
    closedAt: null,
    closeReason: null,
    activeEntities: [],
    focusedEntityId: null,
    pendingSlots: null,
    parkedFills: [],
    topic: null,
    subtopic: null,
    turns: [],
    turnCount: 0,
    summary: null,
  };
}

async function persist(thread: ConvThread): Promise<void> {
  if (thread.id === 'ephemeral') return; // nothing to persist
  try {
    await db.abConvThread.update({
      where: { id: thread.id },
      data: {
        lastActiveAt: thread.lastActiveAt,
        activeEntities: thread.activeEntities as never,
        focusedEntityId: thread.focusedEntityId,
        pendingSlots: thread.pendingSlots as never,
        parkedFills: thread.parkedFills as never,
        topic: thread.topic,
        subtopic: thread.subtopic,
        turns: thread.turns as never,
        turnCount: thread.turnCount,
        summary: thread.summary,
      },
    });
  } catch (err) {
    console.warn('[agentbook-thread] persist failed (non-fatal):', err);
  }
}
