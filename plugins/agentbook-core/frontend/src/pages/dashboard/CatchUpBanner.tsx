import React, { useEffect, useState } from 'react';

/**
 * Inline banner shown at the top of the dashboard when the URL carries
 * `?catchup=1`. Pulls the same `CatchUpSummary` payload the Telegram
 * bot uses (`GET /api/v1/agentbook-core/catch-up`) and renders it as
 * a tight ≤8-bullet list. PR 20.
 *
 * Behaviour:
 *   • Only mounts when `?catchup=1` is on the URL — invisible otherwise.
 *   • Fires one fetch on mount; no LLM, no polling.
 *   • Empty/quiet day → renders "All quiet" line instead of an empty box.
 *   • Failure → quiet inline error; never throws.
 */

interface CatchUpSummary {
  sinceAt: string;
  cashChangeCents: number;
  invoicesPaid: { count: number; totalCents: number };
  invoicesSent: { count: number; totalCents: number };
  expensesAutoCategorized: number;
  expensesNeedReview: number;
  bankTransactionsSynced: number;
  newRecurring: number;
  cpaRequestsOpen: number;
}

function fmtUsd(cents: number): string {
  const sign = cents < 0 ? '−' : '+';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function lines(s: CatchUpSummary): string[] {
  const out: string[] = [];
  if (s.cashChangeCents !== 0) out.push(`Cash ${fmtUsd(s.cashChangeCents)}`);
  if (s.invoicesPaid.count > 0) {
    out.push(`${s.invoicesPaid.count} invoice${s.invoicesPaid.count === 1 ? '' : 's'} paid ($${(s.invoicesPaid.totalCents / 100).toFixed(2)})`);
  }
  if (s.invoicesSent.count > 0) {
    out.push(`${s.invoicesSent.count} invoice${s.invoicesSent.count === 1 ? '' : 's'} sent ($${(s.invoicesSent.totalCents / 100).toFixed(2)})`);
  }
  if (s.expensesAutoCategorized > 0) {
    out.push(`${s.expensesAutoCategorized} expense${s.expensesAutoCategorized === 1 ? '' : 's'} auto-categorised`);
  }
  if (s.expensesNeedReview > 0) {
    out.push(`${s.expensesNeedReview} expense${s.expensesNeedReview === 1 ? '' : 's'} need${s.expensesNeedReview === 1 ? 's' : ''} review`);
  }
  if (s.bankTransactionsSynced > 0) {
    out.push(`${s.bankTransactionsSynced} bank transaction${s.bankTransactionsSynced === 1 ? '' : 's'} synced`);
  }
  if (s.newRecurring > 0) {
    out.push(`${s.newRecurring} new recurring rule${s.newRecurring === 1 ? '' : 's'} detected`);
  }
  if (s.cpaRequestsOpen > 0) {
    out.push(`${s.cpaRequestsOpen} CPA request${s.cpaRequestsOpen === 1 ? '' : 's'} open`);
  }
  if (out.length === 0) out.push('All quiet — nothing to catch up on.');
  return out.slice(0, 8);
}

export const CatchUpBanner: React.FC = () => {
  const [active, setActive] = useState(false);
  const [data, setData] = useState<CatchUpSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('catchup') !== '1') return;
    setActive(true);

    fetch('/api/v1/agentbook-core/catch-up')
      .then((r) => r.json())
      .then((j: { success?: boolean; data?: CatchUpSummary; error?: string }) => {
        if (j?.success && j.data) {
          setData(j.data);
        } else {
          setError(j?.error || 'Failed to load catch-up.');
        }
      })
      .catch(() => setError('Failed to load catch-up.'));
  }, []);

  if (!active || dismissed) return null;

  return (
    <section
      role="status"
      aria-label="Catch-up summary"
      className="mb-4 bg-primary/5 border border-primary/20 rounded-2xl p-4"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h2 className="text-sm font-semibold text-foreground">📰 Catch-up since you were last here</h2>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss catch-up"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : !data ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <ul className="space-y-1 text-sm text-foreground">
          {lines(data).map((line, idx) => (
            <li key={idx} className="flex gap-2">
              <span className="text-muted-foreground">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
