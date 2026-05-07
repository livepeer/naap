import React, { useEffect, useState, useRef } from 'react';
import { Play, Square, Clock, Receipt } from 'lucide-react';

const API = '/api/v1/agentbook-invoice';

interface TimeEntry {
  id: string;
  description: string;
  startedAt: string;
  durationMinutes: number;
  clientId?: string | null;
  hourlyRateCents?: number | null;
  billed?: boolean;
  project?: { name: string } | null;
}

interface UnbilledClientGroup {
  clientId: string;
  clientName: string;
  entries: TimeEntry[];
  totalMinutes: number;
}

export const TimerPage: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [entry, setEntry] = useState<TimeEntry | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [description, setDescription] = useState('');
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Unbilled-by-client view (PR 2).
  const [unbilledGroups, setUnbilledGroups] = useState<UnbilledClientGroup[]>([]);
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/timer/status`).then(r => r.json()).then(d => {
      if (d.data?.running) { setRunning(true); setEntry(d.data.entry); setElapsed(d.data.elapsedMinutes); }
    });
    fetch(`${API}/time-entries?limit=10`).then(r => r.json()).then(d => { if (d.data) setEntries(d.data); });
    loadUnbilled();
  }, []);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => setElapsed(e => e + 1), 60000);
      return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }
  }, [running]);

  /**
   * Pull unbilled entries (any client) and group them in-memory so the user
   * can pick across clients in one place. We do client name resolution
   * client-side via a small `/clients` fetch — keeps the entries endpoint
   * unchanged and avoids a new join just for this view.
   */
  const loadUnbilled = async () => {
    try {
      const [entriesRes, clientsRes] = await Promise.all([
        fetch(`${API}/time-entries?billed=false&limit=200`).then(r => r.json()),
        fetch(`${API}/clients?limit=200`).then(r => r.json()).catch(() => ({ data: [] })),
      ]);
      const rows: TimeEntry[] = entriesRes?.data || [];
      const clients: Array<{ id: string; name: string }> = clientsRes?.data || [];
      const nameById = new Map(clients.map((c) => [c.id, c.name]));

      const groups = new Map<string, UnbilledClientGroup>();
      for (const r of rows) {
        if (!r.clientId) continue; // skip entries with no client — can't invoice yet
        const g = groups.get(r.clientId);
        if (g) {
          g.entries.push(r);
          g.totalMinutes += r.durationMinutes || 0;
        } else {
          groups.set(r.clientId, {
            clientId: r.clientId,
            clientName: nameById.get(r.clientId) || r.clientId,
            entries: [r],
            totalMinutes: r.durationMinutes || 0,
          });
        }
      }
      setUnbilledGroups(Array.from(groups.values()));
    } catch (err) {
      console.warn('[timer] loadUnbilled failed:', err);
    }
  };

  const startTimer = async () => {
    const res = await fetch(`${API}/timer/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: description || 'Working' }),
    });
    const d = await res.json();
    if (d.success) { setRunning(true); setEntry(d.data); setElapsed(0); setDescription(''); }
  };

  const stopTimer = async () => {
    const res = await fetch(`${API}/timer/stop`, { method: 'POST' });
    const d = await res.json();
    if (d.success) {
      setRunning(false); setEntry(null); setElapsed(0);
      setEntries(prev => [d.data, ...prev]);
      loadUnbilled();
    }
  };

  const toggleEntry = (id: string) => {
    setSelectedEntries(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Generate a draft invoice from every selected entry. We invoke the
   * dedicated route once per client so each invoice stays single-client
   * (the underlying schema requires `invoice.clientId`). The route
   * already groups by day and handles atomic billed-flagging.
   */
  const generateInvoice = async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      // Group selected entries by their client.
      const byClient = new Map<string, { entries: TimeEntry[]; minStart: number; maxStart: number }>();
      for (const g of unbilledGroups) {
        for (const e of g.entries) {
          if (!selectedEntries.has(e.id)) continue;
          const startedMs = new Date(e.startedAt).getTime();
          const slot = byClient.get(g.clientId);
          if (slot) {
            slot.entries.push(e);
            slot.minStart = Math.min(slot.minStart, startedMs);
            slot.maxStart = Math.max(slot.maxStart, startedMs);
          } else {
            byClient.set(g.clientId, { entries: [e], minStart: startedMs, maxStart: startedMs });
          }
        }
      }
      if (byClient.size === 0) {
        setGenerateError('Pick at least one entry first.');
        return;
      }
      // Local helpers — kept inline to avoid a new file for two
      // one-liners. `endOfDay` returns 23:59:59.999, then we bump by 1ms
      // so the half-open `[start, end)` API filter includes that final
      // millisecond's worth of entries without the brittle `+ 1ms`-on-an-
      // arbitrary-instant trick we used previously.
      const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

      let lastInvoiceId: string | null = null;
      for (const [clientId, group] of byClient.entries()) {
        // Span the full local-calendar days that contain the selected
        // entries — picks land cleanly inside even if the user toggles
        // an entry that started seconds before midnight.
        const minStart = new Date(group.minStart);
        const maxStart = new Date(group.maxStart);
        const start = startOfDay(minStart);
        const end = new Date(endOfDay(maxStart).getTime() + 1);
        const res = await fetch(`${API}/invoices/from-time-entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            dateRange: { startDate: start.toISOString(), endDate: end.toISOString() },
            source: 'web',
          }),
        });
        const d = await res.json();
        if (!d.success || !d.data) {
          throw new Error(d.error || 'Generate failed');
        }
        lastInvoiceId = d.data.invoiceId;
      }
      setSelectedEntries(new Set());
      await loadUnbilled();
      if (lastInvoiceId) {
        // Hop to the new invoice — keeps the flow snappy. If the user
        // generated several at once, the most recent wins.
        window.location.href = `/agentbook/invoices/${lastInvoiceId}`;
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const fmtDuration = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`;

  const totalSelectedMinutes = (() => {
    let total = 0;
    for (const g of unbilledGroups) {
      for (const e of g.entries) {
        if (selectedEntries.has(e.id)) total += e.durationMinutes || 0;
      }
    }
    return total;
  })();

  return (
    <div className="px-4 py-5 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Clock className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Time Tracker</h1>
      </div>

      {/* Timer */}
      <div className="bg-card border border-border rounded-xl p-6 mb-6 text-center">
        <p className="text-5xl font-bold font-mono mb-4">{fmtDuration(elapsed)}</p>
        {running ? (
          <div>
            <p className="text-sm text-muted-foreground mb-4">{entry?.description || 'Working...'}</p>
            <button onClick={stopTimer} className="px-8 py-3 bg-red-500 text-white rounded-full font-medium flex items-center gap-2 mx-auto active:scale-95">
              <Square className="w-5 h-5" /> Stop
            </button>
          </div>
        ) : (
          <div>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="What are you working on?" className="w-full p-3 border border-border rounded-lg bg-background mb-4 text-center" />
            <button onClick={startTimer} className="px-8 py-3 bg-primary text-primary-foreground rounded-full font-medium flex items-center gap-2 mx-auto active:scale-95">
              <Play className="w-5 h-5" /> Start Timer
            </button>
          </div>
        )}
      </div>

      {/* Recent entries */}
      <h2 className="text-sm font-medium text-muted-foreground mb-3">Recent Time Entries</h2>
      <div className="space-y-2 mb-8">
        {entries.map((e) => (
          <div key={e.id} className="bg-card border border-border rounded-lg p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{e.description}</p>
              <p className="text-xs text-muted-foreground">{new Date(e.startedAt).toLocaleDateString()}{e.project ? ` · ${e.project.name}` : ''}</p>
            </div>
            <span className="font-mono text-sm font-bold">{fmtDuration(e.durationMinutes)}</span>
          </div>
        ))}
        {entries.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No time entries yet. Start the timer above!</p>}
      </div>

      {/* Unbilled time → invoice (PR 2) */}
      <div className="flex items-center gap-2 mb-3">
        <Receipt className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-medium text-muted-foreground">Unbilled time</h2>
      </div>
      {unbilledGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No unbilled time tied to a client yet.</p>
      ) : (
        <div className="space-y-4">
          {unbilledGroups.map((g) => (
            <div key={g.clientId} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium">{g.clientName}</p>
                <span className="text-xs text-muted-foreground font-mono">{fmtDuration(g.totalMinutes)} total</span>
              </div>
              <div className="space-y-1">
                {g.entries.map((e) => (
                  <label key={e.id} className="flex items-center justify-between gap-3 text-sm cursor-pointer hover:bg-muted/30 p-2 rounded">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedEntries.has(e.id)}
                        onChange={() => toggleEntry(e.id)}
                      />
                      <span className="truncate">{e.description}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-muted-foreground">{new Date(e.startedAt).toLocaleDateString()}</span>
                      <span className="font-mono text-xs font-semibold">{fmtDuration(e.durationMinutes)}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 pt-2">
            <span className="text-sm text-muted-foreground">
              {selectedEntries.size === 0
                ? 'Pick entries to invoice'
                : `${selectedEntries.size} selected · ${fmtDuration(totalSelectedMinutes)}`}
            </span>
            <button
              onClick={generateInvoice}
              disabled={selectedEntries.size === 0 || generating}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 text-sm"
            >
              {generating ? 'Generating…' : 'Generate invoice from selected'}
            </button>
          </div>
          {generateError && (
            <p className="text-sm text-red-500 text-right">{generateError}</p>
          )}
        </div>
      )}
    </div>
  );
};
