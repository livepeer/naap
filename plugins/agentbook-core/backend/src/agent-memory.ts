/**
 * AgentBook Agent Memory Module
 *
 * Provides relevance-scored memory retrieval, confidence-based learning from
 * vendor→category patterns, and user correction handling.
 */

import { db } from './db/client.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_PREFIXES = [
  'shortcut:',
  'vendor_alias:',
  'vendor_category:',
  'preference:',
  'profile:',
  'correction:',
];

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MS_PER_MONTH = MS_PER_DAY * 30;

// ---------------------------------------------------------------------------
// 1. retrieveRelevantMemories
// ---------------------------------------------------------------------------

/**
 * Load non-expired memories for a tenant, apply lazy monthly decay, score
 * relevance against the provided text, and return the top `limit` results
 * sorted by relevance descending.
 */
export async function retrieveRelevantMemories(
  tenantId: string,
  text: string,
  limit = 50,
): Promise<any[]> {
  const now = new Date();

  // Load all non-expired memories for the tenant
  const memories: any[] = await db.abUserMemory.findMany({
    where: {
      tenantId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });

  const lowerText = text.toLowerCase();
  const decayUpdates: Promise<void>[] = [];

  const scored = memories.map((mem: any) => {
    // --- Lazy monthly decay ---
    const monthsSinceLastUsed =
      (now.getTime() - new Date(mem.lastUsed ?? mem.createdAt).getTime()) /
      MS_PER_MONTH;

    let currentConfidence: number = mem.confidence ?? 0.5;

    if (monthsSinceLastUsed > 1) {
      const months = Math.floor(monthsSinceLastUsed);
      const decayed = currentConfidence - (mem.decayRate ?? 0.1) * months;
      currentConfidence = Math.max(0.1, decayed);

      if (currentConfidence !== mem.confidence) {
        // Fire-and-forget DB update
        const update = db.abUserMemory
          .update({
            where: { tenantId_key: { tenantId, key: mem.key } },
            data: { confidence: currentConfidence },
          })
          .then(() => undefined)
          .catch(() => undefined);
        decayUpdates.push(update);
      }
    }

    // --- Relevance scoring ---
    let relevance = currentConfidence;

    // Strip type prefix for matching
    let matchKey = mem.key as string;
    for (const prefix of TYPE_PREFIXES) {
      if (matchKey.startsWith(prefix)) {
        matchKey = matchKey.slice(prefix.length);
        break;
      }
    }
    const matchValue = String(mem.value ?? '').toLowerCase();

    if (lowerText.includes(matchKey.toLowerCase())) relevance += 0.5;
    if (matchValue && lowerText.includes(matchValue)) relevance += 0.3;

    const keyLower = mem.key as string;
    if (keyLower.startsWith('shortcut:')) relevance += 0.2;
    if (keyLower.startsWith('vendor_alias:')) relevance += 0.1;
    if (keyLower.startsWith('profile:')) relevance += 0.3;

    // Recency bonus: used in last 7 days
    if (mem.lastUsed) {
      const daysSinceLastUsed =
        (now.getTime() - new Date(mem.lastUsed).getTime()) / MS_PER_DAY;
      if (daysSinceLastUsed <= 7) relevance += 0.1;
    }

    return { ...mem, confidence: currentConfidence, _relevance: relevance };
  });

  // Sort by relevance desc, take top limit
  scored.sort((a: any, b: any) => b._relevance - a._relevance);

  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// 2. learnFromInteraction
// ---------------------------------------------------------------------------

/**
 * Learn vendor→category patterns from successful record-expense interactions.
 * Handles new patterns, confirmations (bump confidence), and contradictions
 * (decay old, create competing pattern).
 */
export async function learnFromInteraction(
  tenantId: string,
  skillUsed: string,
  params: any,
  result: any,
  feedback?: string,
): Promise<void> {
  // Only learn from successful interactions
  if (!result?.success) return;

  // 1. record-expense learning: vendor→category patterns
  if (skillUsed === 'record-expense') {
    const vendorId: string | undefined = result?.data?.vendorId;
    const categoryId: string | undefined = result?.data?.categoryId;
    if (vendorId && categoryId) {
      const vendorName: string =
        (result?.data?.vendorName || params?.vendor || vendorId)
          .trim()
          .toLowerCase();

      const primaryKey = `vendor_category:${vendorName}`;

      try {
        const existing: any = await db.abUserMemory.findUnique({
          where: { tenantId_key: { tenantId, key: primaryKey } },
        });

        if (existing) {
          if (existing.value === categoryId) {
            // Same category — reinforce confidence
            const newConfidence = Math.min(0.99, (existing.confidence ?? 0.5) + 0.15);
            await db.abUserMemory.update({
              where: { tenantId_key: { tenantId, key: primaryKey } },
              data: {
                confidence: newConfidence,
                usageCount: { increment: 1 },
                lastUsed: new Date(),
              },
            });
          } else {
            // Different category — contradiction
            const decayedConfidence = Math.max(
              0.1,
              (existing.confidence ?? 0.5) - 0.2,
            );
            await db.abUserMemory.update({
              where: { tenantId_key: { tenantId, key: primaryKey } },
              data: {
                confidence: decayedConfidence,
                contradictions: { increment: 1 },
                lastUsed: new Date(),
              },
            });

            // Create (or update) competing pattern
            const competingKey = `vendor_category:${vendorName}:${categoryId}`;
            await db.abUserMemory.upsert({
              where: { tenantId_key: { tenantId, key: competingKey } },
              create: {
                tenantId,
                key: competingKey,
                value: categoryId,
                type: 'vendor_category',
                confidence: 0.5,
                source: 'interaction',
                usageCount: 1,
                lastUsed: new Date(),
              },
              update: {
                confidence: { increment: 0.15 },
                usageCount: { increment: 1 },
                lastUsed: new Date(),
              },
            });
          }
        } else {
          // No existing memory — create new
          await db.abUserMemory.create({
            data: {
              tenantId,
              key: primaryKey,
              value: categoryId,
              type: 'vendor_category',
              confidence: 0.5,
              source: 'interaction',
              usageCount: 1,
              lastUsed: new Date(),
            },
          });
        }

        // 2. Auto-promote high-usage patterns
        await db.abUserMemory.updateMany({
          where: {
            tenantId,
            type: 'vendor_category',
            usageCount: { gte: 3 },
            confidence: { lt: 0.95 },
          },
          data: { confidence: 0.95 },
        });
      } catch (_err) {
        // Best-effort — never throw
      }
    }
  }

  // 3. Client rate learning (from invoices)
  if (skillUsed === 'create-invoice' && result?.success && result.data?.clientId) {
    try {
      const lines = (result.data.lines as any[]) || [];
      if (lines.length > 0 && lines[0].rateCents) {
        const key = `client_rate:${result.data.clientId}`;
        const existing = await db.abUserMemory.findFirst({ where: { tenantId, key } });
        if (existing) {
          if (existing.value === String(lines[0].rateCents)) {
            await db.abUserMemory.update({
              where: { id: existing.id },
              data: { confidence: Math.min(0.99, existing.confidence + 0.15), usageCount: { increment: 1 }, lastUsed: new Date() },
            });
          }
        } else {
          await db.abUserMemory.create({
            data: { tenantId, key, value: String(lines[0].rateCents), type: 'client_rate', confidence: 0.5, source: 'learned' },
          });
        }
      }
    } catch { /* best-effort */ }
  }
}

// ---------------------------------------------------------------------------
// 3. handleCorrection
// ---------------------------------------------------------------------------

/**
 * Parse a user correction message, look up the target category, patch the
 * expense, and upsert the vendor_category memory with the corrected value.
 */
export async function handleCorrection(
  tenantId: string,
  feedback: string,
  lastResult: any,
  expenseBaseUrl: string,
): Promise<{ applied: boolean; message: string }> {
  // Parse intent from feedback
  const match = feedback.match(
    /(?:no|wrong|not|should be|it'?s|that'?s)\s+(\w[\w\s&]*)/i,
  );
  if (!match) {
    return { applied: false, message: 'Could not parse correction from feedback.' };
  }

  const rawCategory = match[1].trim();

  // Look up expense category by name (case-insensitive contains)
  let account: any = null;
  try {
    account = await db.abAccount.findFirst({
      where: {
        tenantId,
        accountType: 'expense',
        name: { contains: rawCategory, mode: 'insensitive' },
        isActive: true,
      },
    });
  } catch (_err) {
    return { applied: false, message: 'Database error looking up category.' };
  }

  if (!account) {
    return {
      applied: false,
      message: `Could not find an expense category matching "${rawCategory}".`,
    };
  }

  const categoryId: string = account.id;
  const expenseId: string | undefined = lastResult?.data?.id ?? lastResult?.data?.expenseId;

  // Patch expense if we have an ID
  if (expenseId) {
    try {
      const url = `${expenseBaseUrl}/expenses/${expenseId}/categorize`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ categoryId, source: 'user_corrected' }),
      });
    } catch (_err) {
      // Best-effort — still persist the memory correction
    }
  }

  // Upsert vendor_category memory with corrected category
  const vendorName: string = (
    lastResult?.data?.vendorName ||
    lastResult?.data?.vendor ||
    ''
  )
    .trim()
    .toLowerCase();

  if (vendorName) {
    const key = `vendor_category:${vendorName}`;
    try {
      await db.abUserMemory.upsert({
        where: { tenantId_key: { tenantId, key } },
        create: {
          tenantId,
          key,
          value: categoryId,
          type: 'vendor_category',
          confidence: 0.7,
          source: 'user_corrected',
          usageCount: 1,
          lastUsed: new Date(),
          lastVerified: new Date(),
        },
        update: {
          value: categoryId,
          confidence: 0.7,
          source: 'user_corrected',
          lastVerified: new Date(),
          lastUsed: new Date(),
        },
      });
    } catch (_err) {
      // Best-effort
    }
  }

  return {
    applied: true,
    message: `Correction applied: expense categorised as "${account.name}".`,
  };
}
