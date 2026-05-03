/**
 * Shared helpers for the AgentBook dashboard endpoints.
 *
 * The new dashboard makes one round-trip to the overview aggregator.
 * This module hosts pure helpers (rankAttention, buildNextMoments,
 * deriveMoodLabel, recurring-outflow detector) that the route handlers
 * import — same logic as the legacy plugin Express server, just hosted
 * inside Next.js.
 */

import 'server-only';

// ─── Types ────────────────────────────────────────────────────────────────

export interface NextMoment {
  kind: 'income' | 'tax' | 'rent' | 'recurring';
  label: string;
  amountCents: number;
  daysOut: number;
  sourceId?: string;
}

export interface AttentionItem {
  id: string;
  severity: 'critical' | 'warn' | 'info';
  title: string;
  subtitle?: string;
  amountCents?: number;
  action?: { label: string; href?: string; postEndpoint?: string };
}

export interface RecurringOutflow {
  vendor: string;
  amountCents: number;
  nextExpectedDate: string;
}

// ─── Tenant resolution ───────────────────────────────────────────────────

import type { NextRequest } from 'next/server';

export async function resolveTenantId(req: NextRequest): Promise<string> {
  const headerTenant = req.headers.get('x-tenant-id');
  if (headerTenant) return headerTenant;
  const cookieTenant = req.cookies.get('ab-tenant')?.value;
  if (cookieTenant) return cookieTenant;
  const authToken = req.cookies.get('naap_auth_token')?.value;
  if (authToken) {
    try {
      const { validateSession } = await import('@/lib/api/auth');
      const user = await validateSession(authToken);
      if (user?.id) return user.id;
    } catch { /* fall through */ }
  }
  return 'default';
}

// ─── Attention ranking (pure) ────────────────────────────────────────────

interface AttentionInput {
  overdue: { id: string; client: string; daysOverdue: number; amountCents: number }[];
  taxQuarterly: { dueDate: string; amountCents: number; daysOut: number } | null;
  unbilled: { hours: number; amountCents: number } | null;
  booksOutOfBalance: boolean;
  missingReceiptsCount: number;
}

export function rankAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  // Cap overdue at 4 so a single-item type can't starve the rest.
  for (const ov of input.overdue.slice(0, 4)) {
    items.push({
      id: `overdue:${ov.id}`,
      severity: 'critical',
      title: `${ov.client} · ${ov.daysOverdue} days overdue`,
      amountCents: ov.amountCents,
      action: { label: 'Send reminder', postEndpoint: `/api/v1/agentbook-invoice/invoices/${ov.id}/remind` },
    });
  }

  if (input.taxQuarterly && input.taxQuarterly.daysOut <= 14) {
    items.push({
      id: 'tax',
      severity: 'warn',
      title: `Tax payment due ${input.taxQuarterly.dueDate}`,
      amountCents: input.taxQuarterly.amountCents,
      action: { label: 'View', href: '/agentbook/tax' },
    });
  }

  if (input.unbilled && input.unbilled.hours > 0) {
    items.push({
      id: 'unbilled',
      severity: 'info',
      title: `${input.unbilled.hours.toFixed(1)} unbilled hours`,
      amountCents: input.unbilled.amountCents,
      action: { label: 'Invoice now', href: '/agentbook/invoices/new' },
    });
  }

  if (input.booksOutOfBalance) {
    items.push({
      id: 'balance',
      severity: 'critical',
      title: 'Books are out of balance',
      action: { label: 'Review', href: '/agentbook/ledger' },
    });
  }

  if (input.missingReceiptsCount >= 3) {
    items.push({
      id: 'receipts',
      severity: 'info',
      title: `${input.missingReceiptsCount} expenses missing receipts`,
      action: { label: 'Upload', href: '/agentbook/expenses' },
    });
  }

  return items.slice(0, 5);
}

// ─── Next moments (pure) ─────────────────────────────────────────────────

interface NextMomentsInput {
  upcomingInvoices: { client: string; amountCents: number; daysOut: number; sourceId?: string }[];
  tax: { amountCents: number; daysOut: number } | null;
  recurring: { vendor: string; amountCents: number; daysOut: number }[];
}

export function buildNextMoments(input: NextMomentsInput): NextMoment[] {
  const moments: NextMoment[] = [];

  for (const inv of input.upcomingInvoices) {
    moments.push({
      kind: 'income',
      label: `💰 ${inv.client} $${(inv.amountCents / 100).toFixed(0)} in ${inv.daysOut}d`,
      amountCents: inv.amountCents,
      daysOut: inv.daysOut,
      sourceId: inv.sourceId,
    });
  }

  if (input.tax) {
    moments.push({
      kind: 'tax',
      label: `📋 Tax $${(input.tax.amountCents / 100).toFixed(0)} in ${input.tax.daysOut}d`,
      amountCents: input.tax.amountCents,
      daysOut: input.tax.daysOut,
    });
  }

  for (const r of input.recurring) {
    const isRent = /rent|lease/i.test(r.vendor);
    moments.push({
      kind: isRent ? 'rent' : 'recurring',
      label: `${isRent ? '🏠' : '🔁'} ${r.vendor} $${(r.amountCents / 100).toFixed(0)} in ${r.daysOut}d`,
      amountCents: r.amountCents,
      daysOut: r.daysOut,
    });
  }

  moments.sort((a, b) => {
    if (a.daysOut !== b.daysOut) return a.daysOut - b.daysOut;
    return Math.abs(b.amountCents) - Math.abs(a.amountCents);
  });

  return moments.slice(0, 4);
}

// ─── Mood label ──────────────────────────────────────────────────────────

export function deriveMoodLabel(
  days: { cents: number }[],
  monthlyExpenseRunRateCents: number
): 'healthy' | 'tight' | 'critical' {
  if (days.length === 0) return 'healthy';
  const minCents = Math.min(...days.map(d => d.cents));
  if (minCents <= 0) return 'critical';
  if (monthlyExpenseRunRateCents > 0 && minCents < 0.5 * monthlyExpenseRunRateCents) return 'tight';
  return 'healthy';
}

// ─── Recurring-outflow detection (pure) ──────────────────────────────────

interface ExpenseRow {
  id: string;
  vendor: string;
  amountCents: number;
  date: Date;
}

const MIN_OCCURRENCES = 3;
const MIN_CADENCE_DAYS = 25;
const MAX_CADENCE_DAYS = 35;
const AMOUNT_TOLERANCE = 0.10;

function normalizeVendor(v: string): string {
  return v.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / 86_400_000);
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function detectRecurringFromHistory(
  rows: ExpenseRow[],
  today: Date
): RecurringOutflow[] {
  const byVendor = new Map<string, ExpenseRow[]>();
  for (const r of rows) {
    const key = normalizeVendor(r.vendor);
    if (!key) continue;
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key)!.push(r);
  }

  const out: RecurringOutflow[] = [];

  for (const cluster of byVendor.values()) {
    if (cluster.length < MIN_OCCURRENCES) continue;
    cluster.sort((a, b) => a.date.getTime() - b.date.getTime());

    const meanAmount = avg(cluster.map(c => c.amountCents));
    const tolerance = meanAmount * AMOUNT_TOLERANCE;
    if (cluster.some(c => Math.abs(c.amountCents - meanAmount) > tolerance)) continue;

    const gaps: number[] = [];
    for (let i = 1; i < cluster.length; i++) {
      gaps.push(daysBetween(cluster[i].date, cluster[i - 1].date));
    }
    if (gaps.some(g => g < MIN_CADENCE_DAYS || g > MAX_CADENCE_DAYS)) continue;

    const lastDate = cluster[cluster.length - 1].date;
    const avgCadence = Math.round(avg(gaps));
    const next = new Date(lastDate);
    next.setDate(next.getDate() + avgCadence);
    if (next < today) continue;

    out.push({
      vendor: cluster[0].vendor,
      amountCents: Math.round(meanAmount),
      nextExpectedDate: next.toISOString().slice(0, 10),
    });
  }

  return out.sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate));
}
