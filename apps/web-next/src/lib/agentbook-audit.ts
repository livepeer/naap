/**
 * PR 10 — structured audit trail.
 *
 * Every mutation by user, bot, or cron should call audit() AFTER the
 * underlying DB write succeeded but BEFORE the response is returned.
 *
 * Design rules (locked in by the unit tests in agentbook-audit.test.ts):
 *
 *   • Sparse diff. We don't dump the whole row; we record only the
 *     keys that were ADDED, REMOVED, or CHANGED between before/after.
 *     For create-only or delete-only calls we record just the relevant
 *     side. This keeps the audit table compact and easy to render in
 *     the activity log.
 *
 *   • Sensitive-field redaction. Password hashes, encrypted tokens,
 *     API keys, and anything matching `secret*` are stripped from
 *     the diff regardless of whether they changed. The audit log
 *     must never become a leak vector.
 *
 *   • Best-effort. The helper catches its own errors and logs them
 *     to the server console. An audit-write failure must NEVER bubble
 *     up to break the caller's mutation.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export type AuditSource = 'web' | 'telegram' | 'cron' | 'api';

export interface AuditInput {
  tenantId: string;
  /** 'user:<userId>' | 'bot' | 'cron' | 'api'. Default: 'api'. */
  actor?: string;
  source: AuditSource;
  /** Domain action: 'invoice.create' | 'expense.delete' | 'budget.update' etc. */
  action: string;
  /** Prisma model name, e.g. 'AbInvoice', 'AbExpense', 'AbBudget'. */
  entityType: string;
  /** Affected row id. */
  entityId: string;
  before?: unknown;
  after?: unknown;
}

const SENSITIVE_KEY_PATTERNS: Array<RegExp> = [
  /^passwordhash$/i,
  /^password$/i,
  /^accesstoken/i,    // accessToken, accessTokenEnc, accessTokenHash
  /^refreshtoken/i,
  /^apikey$/i,
  /^secret/i,         // secret, secretAnswer, secretQuestion
  /token.*enc$/i,     // anyTokenEnc
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Strip sensitive keys recursively. Arrays/scalars pass through. */
function redact(input: unknown): unknown {
  if (!isPlainObject(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (isSensitiveKey(k)) continue;
    out[k] = isPlainObject(v) ? redact(v) : v;
  }
  return out;
}

/** Stable JSON-shape equality check (orders shallow keys). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  // Dates: compare by epoch millis. Two Date instances have no enumerable
  // keys, so the plain-object branch below would incorrectly return true.
  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    return a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Compute a sparse diff: { beforeDiff, afterDiff } where each side
 * contains only keys that changed (added / removed / value-different).
 * Sensitive keys are dropped from BOTH sides regardless of whether
 * they changed — they should never enter the audit log.
 */
function diff(
  before: unknown,
  after: unknown,
): { beforeDiff: unknown; afterDiff: unknown; changed: boolean } {
  const beforeRedacted = redact(before);
  const afterRedacted = redact(after);

  // Pure create (no before): record full after.
  if (before === undefined || before === null) {
    if (after === undefined || after === null) {
      return { beforeDiff: null, afterDiff: null, changed: false };
    }
    return { beforeDiff: null, afterDiff: afterRedacted, changed: true };
  }
  // Pure delete (no after): record full before.
  if (after === undefined || after === null) {
    return { beforeDiff: beforeRedacted, afterDiff: null, changed: true };
  }

  // Both sides — compute key-level sparse diff.
  if (isPlainObject(beforeRedacted) && isPlainObject(afterRedacted)) {
    const bDiff: Record<string, unknown> = {};
    const aDiff: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(beforeRedacted),
      ...Object.keys(afterRedacted),
    ]);
    for (const k of keys) {
      const bv = beforeRedacted[k];
      const av = afterRedacted[k];
      if (!deepEqual(bv, av)) {
        if (k in beforeRedacted) bDiff[k] = bv;
        if (k in afterRedacted) aDiff[k] = av;
      }
    }
    const changed =
      Object.keys(bDiff).length > 0 || Object.keys(aDiff).length > 0;
    return {
      beforeDiff: changed ? bDiff : null,
      afterDiff: changed ? aDiff : null,
      changed,
    };
  }

  // Scalar / array case: record full values if they differ.
  if (deepEqual(beforeRedacted, afterRedacted)) {
    return { beforeDiff: null, afterDiff: null, changed: false };
  }
  return {
    beforeDiff: beforeRedacted,
    afterDiff: afterRedacted,
    changed: true,
  };
}

/**
 * Write a structured audit row. Best-effort: never throws.
 *
 * Required: tenantId, source, action, entityType, entityId. Empty
 * strings are treated as missing and the call is a no-op.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    if (
      !input ||
      typeof input.tenantId !== 'string' || !input.tenantId ||
      typeof input.source !== 'string' || !input.source ||
      typeof input.action !== 'string' || !input.action ||
      typeof input.entityType !== 'string' || !input.entityType ||
      typeof input.entityId !== 'string' || !input.entityId
    ) {
      return;
    }

    const { beforeDiff, afterDiff, changed } = diff(input.before, input.after);
    if (!changed) return;

    const actor = input.actor || 'api';

    await db.abAuditEvent.create({
      data: {
        tenantId: input.tenantId,
        actor,
        source: input.source,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        // Prisma JSON fields accept `null`; cast through unknown so
        // strict-mode catches a real type mismatch but lets `null`
        // through as JsonNull semantics.
        before: (beforeDiff ?? null) as never,
        after: (afterDiff ?? null) as never,
      },
    });
  } catch (err) {
    // Audit failures must never break the underlying mutation. Log
    // server-side and move on. We intentionally do NOT re-throw.
    // eslint-disable-next-line no-console
    console.error('[agentbook-audit] write failed (non-fatal):', err);
  }
}
