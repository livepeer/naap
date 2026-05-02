import React, { useState } from 'react';
import type { AttentionItem as Item } from './types';

interface Props { item: Item; }

const fmt = (cents?: number) =>
  cents == null ? '' : '$' + Math.abs(Math.round(cents / 100)).toLocaleString('en-US');

const severityClass = (s: Item['severity']) =>
  s === 'critical' ? 'border-red-500/30 bg-red-500/5' :
  s === 'warn'     ? 'border-amber-500/30 bg-amber-500/5' :
                     'border-border bg-muted/30';

export const AttentionItem: React.FC<Props> = ({ item }) => {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onClick = async () => {
    if (!item.action) return;
    if (item.action.href) {
      window.location.href = item.action.href;
      return;
    }
    if (item.action.postEndpoint) {
      setBusy(true);
      try {
        const res = await fetch(item.action.postEndpoint, { method: 'POST' });
        if (res.ok) setDone(true);
      } finally {
        setBusy(false);
      }
    }
  };

  return (
    <div className={`rounded-xl border p-3 flex items-center gap-3 ${severityClass(item.severity)}`}>
      <span className="text-base">⚠</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
        {item.amountCents != null && <p className="text-xs text-muted-foreground">{fmt(item.amountCents)}</p>}
      </div>
      {item.action && !done && (
        <button onClick={onClick} disabled={busy} className="text-xs font-medium text-primary disabled:opacity-50 px-2 py-1 rounded-lg hover:bg-primary/10">
          {busy ? '…' : item.action.label}
        </button>
      )}
      {done && <span className="text-xs text-green-600">Sent ✓</span>}
    </div>
  );
};
