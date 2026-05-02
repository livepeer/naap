import React from 'react';

export function computeDelta(current: number, prior: number): { pct: number; sign: 'up' | 'down' } | null {
  if (prior === 0) return null;
  const pct = Math.round(((current - prior) / Math.abs(prior)) * 100);
  return { pct, sign: pct >= 0 ? 'up' : 'down' };
}

const fmt = (cents: number) => '$' + Math.round(cents / 100).toLocaleString('en-US');

const Cell: React.FC<{ label: string; cents: number; prior: number }> = ({ label, cents, prior }) => {
  const delta = computeDelta(cents, prior);
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-bold text-foreground">{fmt(cents)}</span>
      {delta ? (
        <span className={`text-xs ${delta.sign === 'up' ? 'text-green-600' : 'text-red-500'}`}>
          {delta.sign === 'up' ? '↑' : '↓'}{Math.abs(delta.pct)}%
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </div>
  );
};

interface Props {
  mtd: { revenueCents: number; expenseCents: number; netCents: number } | null;
  prev: { revenueCents: number; expenseCents: number; netCents: number } | null;
}

export const ThisMonthStrip: React.FC<Props> = ({ mtd, prev }) => {
  if (!mtd) return null;
  const p = prev || { revenueCents: 0, expenseCents: 0, netCents: 0 };
  return (
    <section className="bg-card border border-border rounded-2xl p-4 flex items-center gap-4 flex-wrap">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">This month</span>
      <Cell label="Rev" cents={mtd.revenueCents} prior={p.revenueCents} />
      <Cell label="Exp" cents={mtd.expenseCents} prior={p.expenseCents} />
      <Cell label="Net" cents={mtd.netCents} prior={p.netCents} />
    </section>
  );
};
