/**
 * Shared client resolver for chat-driven flows.
 *
 * Three call sites (PR 1's `invoice.create_from_chat`, PR 2's
 * `timer.start` and `invoice.from_timer`) duplicated the same
 * exact-then-substring matcher. This helper consolidates the logic so
 * adjustments (e.g. fuzzy matching, alias support) only need to land in
 * one place.
 *
 * Behaviour:
 *   • Empty / whitespace hint    → no exact, no candidates.
 *   • Exact case-insensitive hit → `exact` set, `candidates` is `[exact]`.
 *   • No exact match             → `partial` (case-insensitive substring,
 *                                   capped at 10) returned as candidates;
 *                                   caller decides ambiguous vs unique.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface ClientHit {
  id: string;
  name: string;
  email: string | null;
  defaultTerms: string;
}

export interface ClientResolution {
  exact: ClientHit | null;
  candidates: ClientHit[]; // when 0 → no match; 1 → unambiguous; >1 → picker
}

export async function resolveClientByHint(
  tenantId: string,
  hint: string,
): Promise<ClientResolution> {
  if (!hint?.trim()) return { exact: null, candidates: [] };
  const trimmed = hint.trim();
  const exact = await db.abClient.findFirst({
    where: { tenantId, name: { equals: trimmed, mode: 'insensitive' } },
    select: { id: true, name: true, email: true, defaultTerms: true },
  });
  if (exact) return { exact, candidates: [exact] };
  const partial = await db.abClient.findMany({
    where: { tenantId, name: { contains: trimmed, mode: 'insensitive' } },
    select: { id: true, name: true, email: true, defaultTerms: true },
    take: 10,
  });
  return { exact: null, candidates: partial };
}
