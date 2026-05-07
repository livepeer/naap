/**
 * PR 12 — Smart deduction discovery rules engine.
 *
 * Each rule scans recent activity for a tenant and emits zero or more
 * `SuggestionDraft` rows. The orchestrator (`runDeductionDiscovery`)
 * filters by confidence (≥0.7), de-duplicates against suggestions
 * already open/dismissed in the last 90 days, and writes the survivors
 * to `AbDeductionSuggestion` with status='open'.
 *
 * Rules are intentionally narrow and explainable — every draft includes
 * a `message` that explains *why* the bot thinks this is a deduction,
 * which the user sees in the daily digest and the `dd_explain` Telegram
 * callback. We do NOT auto-apply; the user always confirms.
 *
 * Jurisdiction-awareness: rules pull the tenant's `AbAccount.taxCategory`
 * snapshot for the matching account so US tenants see Schedule C lines
 * and CA tenants see T2125 categories without the rule code branching.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface RuleContext {
  tenantId: string;
  jurisdiction: 'us' | 'ca';
  /** Pipeline run-time. Lets tests pin "today" for stable windows. */
  asOf: Date;
}

export interface SuggestionDraft {
  ruleId: string;
  expenseId?: string;
  message: string;
  suggestedTaxCategory?: string;
  suggestedDeductible: boolean;
  /** 0 – 1. The orchestrator drops anything below 0.7. */
  confidence: number;
}

export type Rule = (ctx: RuleContext) => Promise<SuggestionDraft[]>;

const ONE_DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 35;       // ≈ 5 weeks of recent activity
const DEDUPE_DAYS = 90;         // matches dismiss window
const CONFIDENCE_THRESHOLD = 0.7;

/** Monday-anchored ISO week key: yyyy-Www. Used to bucket meals + invoices. */
function weekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // 0 = Mon
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thu of this week
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((date.getTime() - firstThu.getTime()) / ONE_DAY_MS - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** YYYY-MM-DD UTC day key. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Find the AbAccount whose name matches `needle` (case-insensitive
 * substring) and return its taxCategory. Used by every rule so the
 * suggestion records the jurisdiction-correct line label.
 */
async function findAccountTaxCategory(
  tenantId: string,
  needle: string,
): Promise<{ id: string | null; taxCategory: string | null }> {
  const accounts = await db.abAccount.findMany({
    where: { tenantId },
    select: { id: true, name: true, taxCategory: true },
  });
  const lower = needle.toLowerCase();
  const match = accounts.find((a) => a.name.toLowerCase().includes(lower));
  return { id: match?.id ?? null, taxCategory: match?.taxCategory ?? null };
}

// ─── Rule 1: meal_with_client_invoice ─────────────────────────────────────
/**
 * If a tenant booked a meal expense in the same ISO week as a client
 * invoice, the meal is plausibly a client meeting and therefore a 50%
 * (US) / variable (CA) deductible meal. We surface a single suggestion
 * per meal, not per invoice, so the user can apply once.
 */
const meal_with_client_invoice: Rule = async (ctx) => {
  const since = new Date(ctx.asOf.getTime() - LOOKBACK_DAYS * ONE_DAY_MS);
  const mealAccount = await findAccountTaxCategory(ctx.tenantId, 'meal');

  const expenses = await db.abExpense.findMany({
    where: {
      tenantId: ctx.tenantId,
      date: { gte: since, lte: ctx.asOf },
      isPersonal: false,
      isDeductible: false,
      ...(mealAccount.id ? { categoryId: mealAccount.id } : {}),
    },
  });
  if (expenses.length === 0) return [];

  const invoices = await db.abInvoice.findMany({
    where: {
      tenantId: ctx.tenantId,
      issuedDate: { gte: since, lte: ctx.asOf },
    },
    include: { client: { select: { name: true } } },
  });
  if (invoices.length === 0) return [];

  // Bucket invoices by ISO week so each meal can quickly look up "any
  // client invoice this week?".
  const weeks = new Map<string, Array<{ clientName: string }>>();
  for (const inv of invoices) {
    const k = weekKey(inv.issuedDate);
    if (!weeks.has(k)) weeks.set(k, []);
    const clientName = (inv as unknown as { client?: { name?: string } }).client?.name || 'a client';
    weeks.get(k)!.push({ clientName });
  }

  const drafts: SuggestionDraft[] = [];
  for (const exp of expenses) {
    const k = weekKey(exp.date);
    const matches = weeks.get(k);
    if (!matches || matches.length === 0) continue;
    const clientName = matches[0].clientName;
    // Confidence: 0.75 base + small bump per additional same-week invoice
    // (multiple invoices same week = stronger signal we were doing client
    // work). Capped at 0.95.
    const confidence = Math.min(0.95, 0.75 + 0.05 * (matches.length - 1));
    drafts.push({
      ruleId: 'meal_with_client_invoice',
      expenseId: exp.id,
      message:
        `Meal on ${dayKey(exp.date)} fell in the same week as your invoice to ${clientName}. ` +
        `Looks like a client meeting — these are typically deductible (50% in the US).`,
      suggestedTaxCategory: mealAccount.taxCategory ?? undefined,
      suggestedDeductible: true,
      confidence,
    });
  }
  return drafts;
};

// ─── Rule 2: software_marked_personal ─────────────────────────────────────
/**
 * Software/subscription expenses tagged isPersonal=true that recur from
 * the same vendor are usually misclassified business tools (Adobe,
 * GitHub, Notion, etc.). Two or more same-vendor charges in the
 * lookback window → high confidence.
 */
const software_marked_personal: Rule = async (ctx) => {
  const since = new Date(ctx.asOf.getTime() - LOOKBACK_DAYS * 2 * ONE_DAY_MS); // 70d to capture monthly recurrences
  const swAccount = await findAccountTaxCategory(ctx.tenantId, 'software');

  const expenses = await db.abExpense.findMany({
    where: {
      tenantId: ctx.tenantId,
      date: { gte: since, lte: ctx.asOf },
      isPersonal: true,
      ...(swAccount.id ? { categoryId: swAccount.id } : {}),
    },
    include: { vendor: { select: { name: true } } },
  });
  if (expenses.length === 0) return [];

  // Group by vendorId (or normalized description if no vendor). Need
  // ≥2 same-vendor charges to avoid one-off personal software.
  const groups = new Map<string, typeof expenses>();
  for (const e of expenses) {
    const key = e.vendorId || (e.description || 'unknown').toLowerCase().slice(0, 40);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const drafts: SuggestionDraft[] = [];
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    // We only need to suggest one (the most recent) — applying it teaches
    // the user the pattern; the per-expense apply doesn't try to mass-flip.
    const recent = group.sort((a, b) => b.date.getTime() - a.date.getTime())[0];
    const vendorName = (recent as unknown as { vendor?: { name?: string } }).vendor?.name
      || recent.description
      || 'this vendor';
    const confidence = Math.min(0.92, 0.75 + 0.05 * (group.length - 1));
    drafts.push({
      ruleId: 'software_marked_personal',
      expenseId: recent.id,
      message:
        `${group.length} ${vendorName} charges are tagged personal in the last ~10 weeks. ` +
        `Recurring software subscriptions are usually deductible business expenses — want to switch this one?`,
      suggestedTaxCategory: swAccount.taxCategory ?? undefined,
      suggestedDeductible: true,
      confidence,
    });
  }
  return drafts;
};

// ─── Rule 3: home_wifi_business_share ─────────────────────────────────────
/**
 * Utilities/internet expenses with a home/internet vendor signal but no
 * business-use share are often partially deductible for home-office
 * users. We surface the suggestion with a moderate-high confidence and
 * leave the actual % split to the user (apply just flips isDeductible).
 */
const home_wifi_business_share: Rule = async (ctx) => {
  const since = new Date(ctx.asOf.getTime() - LOOKBACK_DAYS * ONE_DAY_MS);
  const utilAccount = await findAccountTaxCategory(ctx.tenantId, 'utilit');

  const expenses = await db.abExpense.findMany({
    where: {
      tenantId: ctx.tenantId,
      date: { gte: since, lte: ctx.asOf },
      isPersonal: false,
      isDeductible: false,
      ...(utilAccount.id ? { categoryId: utilAccount.id } : {}),
    },
    include: { vendor: { select: { name: true } } },
  });
  if (expenses.length === 0) return [];

  const drafts: SuggestionDraft[] = [];
  const ISP_PATTERN = /comcast|xfinity|verizon|at&t|spectrum|cox|rogers|bell|telus|shaw|wifi|internet/i;

  for (const exp of expenses) {
    const blob = `${(exp as unknown as { vendor?: { name?: string } }).vendor?.name || ''} ${exp.description || ''}`;
    if (!ISP_PATTERN.test(blob)) continue;
    drafts.push({
      ruleId: 'home_wifi_business_share',
      expenseId: exp.id,
      message:
        `${blob.trim() || 'Home internet'} on ${dayKey(exp.date)} has no business-use ratio. ` +
        `If you work from home, a portion (often 30–60%) is deductible. Apply to mark it deductible.`,
      suggestedTaxCategory: utilAccount.taxCategory ?? undefined,
      suggestedDeductible: true,
      confidence: 0.72,
    });
  }
  return drafts;
};

// ─── Rule 4: mileage_near_client_invoice ─────────────────────────────────
/**
 * Mileage entries dated the same UTC day as a client invoice are very
 * likely the trip TO that meeting. We surface the entry as a confirmed
 * client trip (suggestedDeductible=true; mileage is already tracked as
 * deductible at booking, but flipping the flag locks it in for the
 * apply audit trail).
 */
const mileage_near_client_invoice: Rule = async (ctx) => {
  const since = new Date(ctx.asOf.getTime() - LOOKBACK_DAYS * ONE_DAY_MS);

  const entries = await db.abMileageEntry.findMany({
    where: { tenantId: ctx.tenantId, date: { gte: since, lte: ctx.asOf } },
  });
  if (entries.length === 0) return [];

  const invoices = await db.abInvoice.findMany({
    where: { tenantId: ctx.tenantId, issuedDate: { gte: since, lte: ctx.asOf } },
    include: { client: { select: { name: true } } },
  });
  if (invoices.length === 0) return [];

  const days = new Map<string, Array<{ clientName: string }>>();
  for (const inv of invoices) {
    const k = dayKey(inv.issuedDate);
    if (!days.has(k)) days.set(k, []);
    const clientName = (inv as unknown as { client?: { name?: string } }).client?.name || 'a client';
    days.get(k)!.push({ clientName });
  }

  const drafts: SuggestionDraft[] = [];
  const carAccount = await findAccountTaxCategory(ctx.tenantId, 'car');
  for (const entry of entries) {
    const k = dayKey(entry.date);
    const matches = days.get(k);
    if (!matches || matches.length === 0) continue;
    const clientName = matches[0].clientName;
    drafts.push({
      ruleId: 'mileage_near_client_invoice',
      // mileage entries aren't AbExpense rows; expenseId is intentionally
      // omitted so apply() reads the rule's hint and updates the entry's
      // purpose instead. The dedupe key uses ruleId+message hash.
      message:
        `${entry.miles} ${entry.unit} on ${k} matches your invoice to ${clientName} the same day. ` +
        `Looks like a confirmed client trip — already counted as deductible mileage.`,
      suggestedTaxCategory: carAccount.taxCategory ?? undefined,
      suggestedDeductible: true,
      confidence: 0.85,
    });
  }
  return drafts;
};

export const RULES: Record<string, Rule> = {
  meal_with_client_invoice,
  software_marked_personal,
  home_wifi_business_share,
  // mileage_near_client_invoice — deferred: apply path needs a per-mileage-entry
  // hook, and the dedupe key collapses to one row per run. Re-enable once both
  // are addressed in a follow-up PR.
};

/**
 * Run every rule for a tenant, threshold by confidence, dedupe against
 * recent suggestions, and persist the survivors with status='open'.
 */
export async function runDeductionDiscovery(tenantId: string): Promise<{
  created: number;
  suggestions: SuggestionDraft[];
}> {
  // Resolve jurisdiction once. Default to 'us' so a tenant without an
  // AbTenantConfig row still gets useful suggestions. Tenants are keyed
  // by `userId` on the config table (the AgentBook tenant == user.id).
  const cfg = await db.abTenantConfig
    .findUnique({ where: { userId: tenantId }, select: { jurisdiction: true } })
    .catch(() => null);
  const jurisdiction: 'us' | 'ca' =
    (cfg && (cfg as unknown as { jurisdiction?: string }).jurisdiction === 'ca') ? 'ca' : 'us';

  const ctx: RuleContext = { tenantId, jurisdiction, asOf: new Date() };

  const allDrafts: SuggestionDraft[] = [];
  for (const ruleId of Object.keys(RULES)) {
    try {
      const drafts = await RULES[ruleId](ctx);
      for (const d of drafts) {
        // Defensive: trust but verify the rule honored its own ruleId.
        if (!d.ruleId) d.ruleId = ruleId;
        allDrafts.push(d);
      }
    } catch (err) {
      console.error(`[deduction-rules] rule ${ruleId} failed for tenant ${tenantId}:`, err);
    }
  }

  // Confidence gate.
  const eligible = allDrafts.filter((d) => d.confidence >= CONFIDENCE_THRESHOLD);
  if (eligible.length === 0) return { created: 0, suggestions: [] };

  // Dedupe: load recent suggestions matching any (ruleId, expenseId) we
  // would write. Anything still 'open' or 'dismissed' (with non-expired
  // expiresAt) suppresses the new write.
  const since = new Date(Date.now() - DEDUPE_DAYS * ONE_DAY_MS);
  const recent = await db.abDeductionSuggestion.findMany({
    where: {
      tenantId,
      createdAt: { gte: since },
      ruleId: { in: Array.from(new Set(eligible.map((d) => d.ruleId))) },
    },
    select: { ruleId: true, expenseId: true, status: true, expiresAt: true },
  });

  const now = new Date();
  const blocked = new Set<string>();
  for (const r of recent) {
    if (r.status === 'applied') continue; // applied is fine to re-suggest after window
    if (r.status === 'dismissed' && r.expiresAt && r.expiresAt < now) continue;
    blocked.add(`${r.ruleId}|${r.expenseId ?? ''}`);
  }

  const persisted: SuggestionDraft[] = [];
  for (const d of eligible) {
    const key = `${d.ruleId}|${d.expenseId ?? ''}`;
    if (blocked.has(key)) continue;
    blocked.add(key); // also dedupe within this run (e.g. two rules both target same expense)

    await db.abDeductionSuggestion.create({
      data: {
        tenantId,
        ruleId: d.ruleId,
        expenseId: d.expenseId ?? null,
        message: d.message,
        suggestedTaxCategory: d.suggestedTaxCategory ?? null,
        suggestedDeductible: d.suggestedDeductible,
        confidence: d.confidence,
        status: 'open',
        jurisdiction,
        category: d.suggestedTaxCategory || d.ruleId,
        description: d.message,
        estimatedSavingsCents: 0,
      },
    });
    persisted.push(d);
  }

  return { created: persisted.length, suggestions: persisted };
}
