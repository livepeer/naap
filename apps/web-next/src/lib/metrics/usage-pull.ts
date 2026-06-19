/**
 * Spend dashboard live PULL (NAAP-2, `usage_pull` flag).
 *
 * Pulls provider usage live through the provider-agnostic `BillingProviderAdapter`
 * (`adapter.getSpend`) instead of reading pushed `ProviderUsageRecord` rows. Adds
 * a short-TTL in-memory cache (so a dashboard load does not hammer the provider
 * usage API) and degrades gracefully: a pull failure for a scope is logged and
 * left for the caller to backfill from `ProviderUsageRecord` (never throws per
 * scope, never 500s the dashboard).
 *
 * This module stays provider-agnostic: it never imports a provider client. The
 * provider-internal → neutral mapping lives behind each adapter's `getSpend`.
 * Tenant scoping is the caller's responsibility — `pullSpend` only pulls the
 * exact scopes it is handed (each carrying the authorized `accountId`), and a
 * scoped pull asks the provider for that one account only.
 */

import 'server-only';

import { getBillingProviderAdapter } from '@/lib/billing/registry';
import type { ProviderSpendScope } from '@/lib/billing/adapter';
import { listBillingProviderSlugs } from '@/lib/billing/registry';
import type { UsageRecordLike } from './aggregate';
import { usagePullCacheTtlMs } from './flags';

/** A provider account to pull. `accountId` omitted ⇒ app-wide (admin only). */
export interface SpendScopeRef {
  providerSlug: string;
  accountId?: string;
}

interface CacheEntry {
  expiresAt: number;
  records: UsageRecordLike[];
  source?: string;
}

// Module-level cache. Keyed by provider + account scope + window, so a scoped
// pull can never serve another tenant's cached rows.
const cache = new Map<string, CacheEntry>();

/** Stable key for a scope (account-level or app-wide). */
export function spendScopeKey(scope: SpendScopeRef): string {
  return `${scope.providerSlug}\u0000${scope.accountId ?? '*app*'}`;
}

function cacheKey(scope: SpendScopeRef, startDate: string, endDate: string): string {
  return `${spendScopeKey(scope)}\u0000${startDate}\u0000${endDate}`;
}

function log(level: 'info' | 'warn', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'warn') console.warn(line);
  else console.info(line);
}

/** Short, secret-free description of a thrown value for structured logs. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.name || 'Error';
  return typeof err;
}

/**
 * Resolve the pull window to ISO bounds. Defaults to the current UTC calendar
 * month-to-now when the caller did not supply explicit `from`/`to`, matching the
 * existing per-user usage endpoint's default windowing.
 */
export function resolveSpendWindow(
  from: Date | null,
  to: Date | null,
): { startDate: string; endDate: string } {
  const end = to ?? new Date();
  const start = from ?? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

/** Provider slugs whose adapter can be pulled right now (implements + configured). */
export function listPullCapableProviderSlugs(): string[] {
  return listBillingProviderSlugs().filter((slug) => {
    const adapter = getBillingProviderAdapter(slug);
    return Boolean(adapter && typeof adapter.getSpend === 'function' && adapter.isConfigured());
  });
}

export interface PullSpendResult {
  /** Neutral usage rows pulled live (ready for `aggregateSpendByProvider`). */
  records: UsageRecordLike[];
  /** `spendScopeKey`s that were successfully pulled (caller excludes from DB). */
  pulled: Set<string>;
}

/**
 * Pull spend for the given scopes through their provider adapters, with caching
 * and graceful per-scope degradation. Never throws: a scope that has no
 * pull-capable adapter, or whose pull fails, is simply absent from `pulled`, so
 * the caller backfills it from `ProviderUsageRecord`.
 */
export async function pullSpend(
  scopes: SpendScopeRef[],
  window: { from: Date | null; to: Date | null },
  opts: { correlationId: string },
): Promise<PullSpendResult> {
  const { startDate, endDate } = resolveSpendWindow(window.from, window.to);
  const ttl = usagePullCacheTtlMs();
  const now = Date.now();
  const records: UsageRecordLike[] = [];
  const pulled = new Set<string>();

  for (const scope of scopes) {
    const adapter = getBillingProviderAdapter(scope.providerSlug);
    if (!adapter || typeof adapter.getSpend !== 'function' || !adapter.isConfigured()) {
      // Not pull-capable → leave for the DB backfill (push-only provider).
      continue;
    }

    const key = spendScopeKey(scope);
    const ck = cacheKey(scope, startDate, endDate);
    const cached = ttl > 0 ? cache.get(ck) : undefined;
    if (cached && cached.expiresAt > now) {
      records.push(...cached.records);
      pulled.add(key);
      log('info', 'metrics.usage.pull.cache_hit', {
        correlationId: opts.correlationId,
        providerSlug: scope.providerSlug,
        appWide: !scope.accountId,
      });
      continue;
    }

    try {
      const result = await adapter.getSpend({
        ...(scope.accountId ? { accountId: scope.accountId } : {}),
        startDate,
        endDate,
      } as ProviderSpendScope);
      records.push(...result.records);
      pulled.add(key);
      if (ttl > 0) {
        cache.set(ck, { expiresAt: now + ttl, records: result.records, source: result.source });
      }
      log('info', 'metrics.usage.pull.ok', {
        correlationId: opts.correlationId,
        providerSlug: scope.providerSlug,
        appWide: !scope.accountId,
        source: result.source,
        rows: result.records.length,
      });
    } catch (err) {
      // Graceful degradation: this scope falls back to ProviderUsageRecord.
      // Never log the opaque accountId — slug + appWide only.
      log('warn', 'metrics.usage.pull.failed', {
        correlationId: opts.correlationId,
        providerSlug: scope.providerSlug,
        appWide: !scope.accountId,
        error: describeError(err),
      });
    }
  }

  return { records, pulled };
}

/** Test isolation: clear the module-level cache. */
export function resetUsagePullCacheForTests(): void {
  cache.clear();
}
