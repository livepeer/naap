/**
 * Daily auto-categorizer.
 *
 * Picks up every uncategorized AbExpense for a tenant, asks Gemini what
 * category it should be (against the tenant's actual chart of accounts),
 * and:
 *
 *   • confidence ≥ 0.85 → applies silently and learns the vendor pattern
 *   • 0.55 ≤ confidence < 0.85 → batched into the morning digest as a
 *     single "X need a quick check" prompt
 *   • confidence < 0.55 → left untouched (user has to handle it)
 *
 * The bot agent's ethos: be useful when sure, ask once when unsure.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface AutoCategoryResult {
  appliedCount: number;
  pending: PendingSuggestion[];
  skippedCount: number;
}

export interface PendingSuggestion {
  expenseId: string;
  vendorName: string | null;
  amountCents: number;
  date: Date;
  description: string | null;
  suggestedCategoryId: string;
  suggestedCategoryName: string;
  confidence: number;
  reason: string;
}

interface CategoryRow {
  id: string;
  name: string;
  code: string;
  taxCategory: string | null;
}

interface UncategorizedExpense {
  id: string;
  amountCents: number;
  date: Date;
  description: string | null;
  vendorName: string | null;
  vendorId: string | null;
}

interface LlmCategoryResponse {
  categoryName: string | null;
  confidence: number;
  reason: string;
}

const HIGH_CONF = 0.85;
const MEDIUM_CONF = 0.55;
const PENDING_KEY = 'telegram:ai_categorize_pending';
const LAST_RUN_KEY = 'telegram:last_auto_categorize';

async function classifyExpenseWithGemini(
  expense: UncategorizedExpense,
  categories: CategoryRow[],
): Promise<LlmCategoryResponse | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL_FAST || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const catList = categories
    .map((c) => `   • ${c.name}${c.taxCategory ? ` (${c.taxCategory})` : ''}`)
    .join('\n');

  const systemPrompt = `You are a senior freelance bookkeeper. Classify
the expense below into ONE of the available categories. Be conservative
with confidence — if the vendor or description is ambiguous, return a
lower confidence and a brief reason; if it's clearly e.g. a gas station
receipt that should be Fuel, go high.

Available categories:
${catList}

Output rules:
   • categoryName MUST be exactly one of the names above (case-sensitive).
   • If genuinely ambiguous (e.g. "Amazon \$45" with no item info), set
     categoryName=null with a low confidence — don't guess.
   • confidence is your honest 0.0-1.0 self-rating.
   • reason: one short sentence in plain English.

Return ONLY a JSON object:
{"categoryName": "Meals", "confidence": 0.92, "reason": "Restaurant name + small amount."}`;

  const userMsg = `Expense:
   Vendor: ${expense.vendorName || '(no vendor)'}
   Amount: $${(expense.amountCents / 100).toFixed(2)}
   Date: ${expense.date.toISOString().slice(0, 10)}
   Description: ${expense.description || '(no description)'}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMsg }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.1 },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const json = cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned;
    const parsed = JSON.parse(json) as LlmCategoryResponse;
    if (typeof parsed.confidence !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeVendorName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

async function applyCategoryAndLearn(
  tenantId: string,
  expense: UncategorizedExpense,
  category: CategoryRow,
  confidence: number,
): Promise<void> {
  await db.abExpense.update({
    where: { id: expense.id },
    data: { categoryId: category.id, confidence },
  });
  // Persist the vendor → category pattern at moderate confidence so future
  // receipts auto-categorize without going back through Gemini.
  if (expense.vendorId) {
    const vendor = await db.abVendor.findUnique({ where: { id: expense.vendorId } });
    if (vendor) {
      await db.abPattern.upsert({
        where: { tenantId_vendorPattern: { tenantId, vendorPattern: vendor.normalizedName } },
        update: {
          categoryId: category.id,
          confidence: Math.min(0.92, confidence),
          source: 'auto_categorize',
          usageCount: { increment: 1 },
          lastUsed: new Date(),
        },
        create: {
          tenantId,
          vendorPattern: vendor.normalizedName,
          categoryId: category.id,
          confidence: Math.min(0.9, confidence),
          source: 'auto_categorize',
        },
      });
    }
  } else if (expense.vendorName) {
    const normalized = normalizeVendorName(expense.vendorName);
    if (normalized) {
      await db.abPattern.upsert({
        where: { tenantId_vendorPattern: { tenantId, vendorPattern: normalized } },
        update: {
          categoryId: category.id,
          confidence: Math.min(0.92, confidence),
          source: 'auto_categorize',
          usageCount: { increment: 1 },
          lastUsed: new Date(),
        },
        create: {
          tenantId,
          vendorPattern: normalized,
          categoryId: category.id,
          confidence: Math.min(0.9, confidence),
          source: 'auto_categorize',
        },
      });
    }
  }
  await db.abEvent.create({
    data: {
      tenantId,
      eventType: 'expense.auto_categorized',
      actor: 'agent',
      action: {
        expenseId: expense.id,
        categoryId: category.id,
        categoryName: category.name,
        confidence,
      },
    },
  });
}

/**
 * Run the auto-categorizer once for a tenant. Idempotent within a day —
 * the LAST_RUN memory key short-circuits if we already swept today.
 * Returns the auto-applied count and the medium-confidence batch that
 * needs the user's review.
 */
export async function autoCategorizeForTenant(
  tenantId: string,
  options: { force?: boolean } = {},
): Promise<AutoCategoryResult> {
  // Skip if we already ran today.
  if (!options.force) {
    const last = await db.abUserMemory.findUnique({
      where: { tenantId_key: { tenantId, key: LAST_RUN_KEY } },
    });
    if (last) {
      try {
        const ts = new Date(JSON.parse(last.value).at as string);
        if (Date.now() - ts.getTime() < 20 * 60 * 60 * 1000) {
          return { appliedCount: 0, pending: [], skippedCount: 0 };
        }
      } catch {
        // bad JSON, treat as never run
      }
    }
  }

  const expenses = await db.abExpense.findMany({
    where: {
      tenantId,
      categoryId: null,
      isPersonal: false,
      status: { in: ['pending_review', 'confirmed'] },
    },
    include: { vendor: { select: { id: true, name: true } } },
    orderBy: { date: 'desc' },
    take: 50,
  });

  if (expenses.length === 0) {
    await markRun(tenantId);
    return { appliedCount: 0, pending: [], skippedCount: 0 };
  }

  const categories = await db.abAccount.findMany({
    where: { tenantId, accountType: 'expense', isActive: true },
    select: { id: true, name: true, code: true, taxCategory: true },
  });
  if (categories.length === 0) {
    await markRun(tenantId);
    return { appliedCount: 0, pending: [], skippedCount: expenses.length };
  }

  let applied = 0;
  let skipped = 0;
  const pending: PendingSuggestion[] = [];

  for (const exp of expenses) {
    const llm = await classifyExpenseWithGemini(
      {
        id: exp.id,
        amountCents: exp.amountCents,
        date: exp.date,
        description: exp.description,
        vendorName: exp.vendor?.name ?? null,
        vendorId: exp.vendor?.id ?? null,
      },
      categories,
    );
    if (!llm || !llm.categoryName) {
      skipped++;
      continue;
    }
    const matched = categories.find(
      (c) => c.name.toLowerCase() === llm.categoryName!.toLowerCase(),
    );
    if (!matched) {
      skipped++;
      continue;
    }

    if (llm.confidence >= HIGH_CONF) {
      await applyCategoryAndLearn(
        tenantId,
        {
          id: exp.id,
          amountCents: exp.amountCents,
          date: exp.date,
          description: exp.description,
          vendorName: exp.vendor?.name ?? null,
          vendorId: exp.vendor?.id ?? null,
        },
        matched,
        llm.confidence,
      );
      applied++;
    } else if (llm.confidence >= MEDIUM_CONF) {
      pending.push({
        expenseId: exp.id,
        vendorName: exp.vendor?.name ?? null,
        amountCents: exp.amountCents,
        date: exp.date,
        description: exp.description,
        suggestedCategoryId: matched.id,
        suggestedCategoryName: matched.name,
        confidence: llm.confidence,
        reason: llm.reason,
      });
    } else {
      skipped++;
    }
  }

  // Stash the pending list in AbUserMemory so the user can act on the
  // batch via the digest's "Review" button (callback handler reads from
  // here when they tap to review).
  if (pending.length > 0) {
    await db.abUserMemory.upsert({
      where: { tenantId_key: { tenantId, key: PENDING_KEY } },
      update: {
        value: JSON.stringify({ items: pending, builtAt: Date.now() }, replacer),
        lastUsed: new Date(),
      },
      create: {
        tenantId,
        key: PENDING_KEY,
        value: JSON.stringify({ items: pending, builtAt: Date.now() }, replacer),
        type: 'pending_action',
        confidence: 1,
      },
    });
  } else {
    await db.abUserMemory.deleteMany({
      where: { tenantId, key: PENDING_KEY },
    });
  }

  await markRun(tenantId);
  return { appliedCount: applied, pending, skippedCount: skipped };
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

async function markRun(tenantId: string): Promise<void> {
  const value = JSON.stringify({ at: new Date().toISOString() });
  await db.abUserMemory.upsert({
    where: { tenantId_key: { tenantId, key: LAST_RUN_KEY } },
    update: { value, lastUsed: new Date() },
    create: { tenantId, key: LAST_RUN_KEY, value, type: 'audit', confidence: 1 },
  });
}

/** Pull the pending review batch back out for the Telegram review flow. */
export async function getPendingSuggestions(tenantId: string): Promise<PendingSuggestion[]> {
  const memory = await db.abUserMemory.findUnique({
    where: { tenantId_key: { tenantId, key: PENDING_KEY } },
  });
  if (!memory) return [];
  try {
    const parsed = JSON.parse(memory.value) as { items: PendingSuggestion[] };
    return parsed.items.map((p) => ({ ...p, date: new Date(p.date) }));
  } catch {
    return [];
  }
}

/** Remove a single suggestion (after the user accepts / overrides it). */
export async function dropPendingSuggestion(tenantId: string, expenseId: string): Promise<number> {
  const remaining = (await getPendingSuggestions(tenantId)).filter(
    (p) => p.expenseId !== expenseId,
  );
  if (remaining.length === 0) {
    await db.abUserMemory.deleteMany({ where: { tenantId, key: PENDING_KEY } });
  } else {
    await db.abUserMemory.upsert({
      where: { tenantId_key: { tenantId, key: PENDING_KEY } },
      update: {
        value: JSON.stringify({ items: remaining, builtAt: Date.now() }, replacer),
        lastUsed: new Date(),
      },
      create: {
        tenantId,
        key: PENDING_KEY,
        value: JSON.stringify({ items: remaining, builtAt: Date.now() }, replacer),
        type: 'pending_action',
        confidence: 1,
      },
    });
  }
  return remaining.length;
}
