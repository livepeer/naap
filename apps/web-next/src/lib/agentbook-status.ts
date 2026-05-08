/**
 * Status snapshot helper (PR 22).
 *
 * Maya types `/status` and the bot replies with a one-glance health
 * panel: bot connected, database latency, last bank sync, last morning
 * digest, open CPA requests, recent error events. Same payload feeds
 * the GET /agentbook-core/status web endpoint.
 *
 * This module owns ONLY the DB-read aggregation + a tiny in-process
 * health probe. Rendering (Telegram lines, web chips) lives at the
 * call sites. The helper is a pure read with no LLM and no destructive
 * side effects, so it stays cheap (one query per bucket, all fired in
 * parallel) and is trivially unit-testable.
 *
 * Tenant scoping: every Prisma call here passes `tenantId` in the
 * where-clause. Cross-tenant leakage is impossible at this layer.
 *
 * Database probe: we run a `SELECT 1`-style query and time it. A
 * failure marks `database.ok=false` rather than throwing — the
 * `/status` reply is meant to be diagnostic, so degrading gracefully
 * is the entire point.
 *
 * Recent errors are intentionally capped at 3. The Telegram renderer
 * is line-budgeted, and three is enough to spot a pattern without
 * paginating.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface StatusSnapshot {
  /** In-process bot reachability. Always `ok=true` from the helper —
   *  the act of returning means the route handler is alive. */
  bot: { ok: boolean; usernameKnown: boolean };
  /** DB probe — `ok=true` if the SELECT 1 round-trip succeeded; the
   *  measured wall-clock latency is reported regardless. */
  database: { ok: boolean; latencyMs: number };
  /** Last successful bank sync across all the tenant's connected
   *  accounts, plus the count of currently-connected accounts. */
  bankSync: { lastSyncedAt: Date | null; connectedAccounts: number };
  /** When the morning digest last fired for this tenant (any of the
   *  per-day stamps — bank.digest_sent_today, deduction.digest_sent_today). */
  morningDigest: { lastSentAt: Date | null };
  /** Open AbAccountantRequest rows — CPA waiting on Maya. */
  cpaRequests: { open: number };
  /** Most-recent ≤3 error rows from the structured audit log
   *  (action prefix `error.`). Most recent first. */
  recentErrors: Array<{ when: Date; eventType: string }>;
}

/** Event types the morning-digest cron stamps when it sends. We match
 *  on these instead of writing a new "digest sent" stamp because they
 *  already exist (and are tenant-scoped + day-keyed). */
const DIGEST_EVENT_TYPES = [
  'bank.digest_sent_today',
  'deduction.digest_sent_today',
] as const;

/** Hard cap on `recentErrors`. The Telegram renderer assumes ≤3 lines. */
const MAX_RECENT_ERRORS = 3;

/**
 * Probe the database with a tiny query and time the round-trip.
 *
 * Returns `{ ok: false, latencyMs }` on any error. We never let the
 * probe throw — the whole point of `/status` is to surface a failed DB
 * connection, not to hide it behind a 500.
 */
async function probeDatabase(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    // `SELECT 1` is the universal liveness probe. Tagged-template form
    // is required by Prisma's $queryRaw.
    await db.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

/**
 * Aggregate the status snapshot for a tenant. Pure DB read — no LLM,
 * no destructive side effects.
 *
 * All queries run in parallel via `Promise.all` so the worst-case
 * latency is the slowest single query, not their sum.
 */
export async function getStatusSnapshot(tenantId: string): Promise<StatusSnapshot> {
  const [
    dbProbe,
    connectedAccounts,
    lastSyncedRow,
    lastDigestEvent,
    cpaOpen,
    errorRows,
  ] = await Promise.all([
    probeDatabase(),
    db.abBankAccount.count({
      where: { tenantId, connected: true },
    }),
    db.abBankAccount.findFirst({
      where: { tenantId, connected: true, lastSynced: { not: null } },
      orderBy: { lastSynced: 'desc' },
      select: { lastSynced: true },
    }),
    db.abEvent.findFirst({
      where: {
        tenantId,
        eventType: { in: [...DIGEST_EVENT_TYPES] },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    db.abAccountantRequest.count({
      where: { tenantId, status: 'open' },
    }),
    db.abAuditEvent.findMany({
      where: {
        tenantId,
        action: { startsWith: 'error.' },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_RECENT_ERRORS,
      select: { createdAt: true, action: true },
    }),
  ]);

  // Bot reachability: the helper running at all means the in-process
  // bot route is alive. `usernameKnown` reflects whether the env has a
  // bot token configured (and therefore a resolvable @username); we
  // don't actually round-trip Telegram here — that would be a per-call
  // 100-300ms tax on every /status invocation.
  const botTokenConfigured = Boolean(
    process.env.AGENTBOOK_TELEGRAM_BOT_TOKEN
      || process.env.TELEGRAM_BOT_TOKEN,
  );

  return {
    bot: { ok: true, usernameKnown: botTokenConfigured },
    database: dbProbe,
    bankSync: {
      lastSyncedAt: lastSyncedRow?.lastSynced ?? null,
      connectedAccounts,
    },
    morningDigest: {
      lastSentAt: lastDigestEvent?.createdAt ?? null,
    },
    cpaRequests: { open: cpaOpen },
    recentErrors: errorRows.map((r) => ({ when: r.createdAt, eventType: r.action })),
  };
}

/**
 * Render a StatusSnapshot as ≤6 lines suitable for Telegram or the web
 * status panel. Returns an array (caller joins with `\n`) so consumers
 * can splice in a custom header. Lines are ordered head-to-toe: bot,
 * database, bank, digest, CPA, errors.
 *
 * Status emoji legend:
 *   ✅ ok / fresh
 *   ⚠ stale (>24h) or zero-but-expected
 *   ❌ unreachable / failure
 */
export function renderStatusLines(s: StatusSnapshot): string[] {
  const lines: string[] = [];
  const now = Date.now();
  const STALE_MS = 24 * 60 * 60 * 1000;

  lines.push(s.bot.ok ? '✅ Bot: connected' : '❌ Bot: unreachable');

  if (s.database.ok) {
    lines.push(`✅ Database: ${s.database.latencyMs}ms`);
  } else {
    lines.push('❌ Database: unreachable');
  }

  if (s.bankSync.connectedAccounts === 0) {
    lines.push('🏦 Bank: no accounts connected');
  } else {
    const ago = s.bankSync.lastSyncedAt
      ? formatAgo(now - s.bankSync.lastSyncedAt.getTime())
      : 'never';
    const stale = s.bankSync.lastSyncedAt
      && now - s.bankSync.lastSyncedAt.getTime() > STALE_MS;
    const icon = !s.bankSync.lastSyncedAt ? '⚠' : stale ? '⚠' : '🏦';
    const accts = `${s.bankSync.connectedAccounts} account${s.bankSync.connectedAccounts === 1 ? '' : 's'}`;
    lines.push(`${icon} Bank: synced ${ago}, ${accts}`);
  }

  if (s.morningDigest.lastSentAt) {
    const ms = now - s.morningDigest.lastSentAt.getTime();
    const stale = ms > STALE_MS;
    lines.push(`${stale ? '⚠' : '📒'} Digest: sent ${formatAgo(ms)}`);
  } else {
    lines.push('⚠ Digest: not sent yet');
  }

  if (s.cpaRequests.open > 0) {
    lines.push(`📋 CPA: ${s.cpaRequests.open} request${s.cpaRequests.open === 1 ? '' : 's'} open`);
  } else {
    lines.push('✅ CPA: no open requests');
  }

  if (s.recentErrors.length > 0) {
    lines.push(`⚠ Recent errors (${s.recentErrors.length}): ${s.recentErrors.map((e) => e.eventType).join(', ')}`);
  }

  return lines;
}

/** Compact human-friendly age — "12s ago", "3m ago", "2h ago", "4d ago". */
function formatAgo(ms: number): string {
  if (ms < 0) return 'just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
