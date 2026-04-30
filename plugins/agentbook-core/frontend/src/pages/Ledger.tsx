import React, { useEffect, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';

interface JournalLine {
  id: string;
  accountId: string;
  debitCents: number;
  creditCents: number;
  description: string | null;
  account: { code: string; name: string };
}

interface JournalEntry {
  id: string;
  date: string;
  memo: string;
  sourceType: string;
  verified: boolean;
  createdAt: string;
  lines: JournalLine[];
}

const API_BASE = '/api/v1/agentbook-core';

export const LedgerPage: React.FC = () => {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/journal-entries?limit=50`)
      .then(r => r.json())
      .then(data => { if (data.success) setEntries(data.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const fmt = (cents: number) => cents > 0 ? `$${(cents / 100).toFixed(2)}` : '';
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <BookOpen className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">General Ledger</h1>
      </div>

      {loading && <p className="text-muted-foreground">Loading journal entries...</p>}

      {entries.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No journal entries yet. Record an expense to get started!</p>
        </div>
      )}

      <div className="space-y-2">
        {entries.map(entry => (
          <div key={entry.id} className="bg-card border border-border rounded-lg">
            <button
              onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/50 transition-colors rounded-lg"
            >
              <div className="flex items-center gap-4">
                {expandedId === entry.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <span className="text-sm text-muted-foreground w-24">{fmtDate(entry.date)}</span>
                <span className="font-medium">{entry.memo}</span>
                <span className="text-xs px-2 py-0.5 bg-muted rounded-full">{entry.sourceType}</span>
              </div>
              <span className="text-sm font-mono">
                {fmt(entry.lines.reduce((s, l) => s + l.debitCents, 0))}
              </span>
            </button>

            {expandedId === entry.id && (
              <div className="px-4 pb-4 pt-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left py-2">Account</th>
                      <th className="text-right py-2">Debit</th>
                      <th className="text-right py-2">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.lines.map(line => (
                      <tr key={line.id} className="border-b border-border/50">
                        <td className="py-2">{line.account.code} — {line.account.name}</td>
                        <td className="text-right font-mono">{fmt(line.debitCents)}</td>
                        <td className="text-right font-mono">{fmt(line.creditCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
