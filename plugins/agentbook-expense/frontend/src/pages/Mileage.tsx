import React, { useEffect, useState } from 'react';
import { Car, Download, Plus, X } from 'lucide-react';

const API = '/api/v1/agentbook-expense';

interface MileageEntry {
  id: string;
  date: string;
  miles: number;
  unit: 'mi' | 'km';
  purpose: string;
  clientId: string | null;
  jurisdiction: 'us' | 'ca';
  ratePerUnitCents: number;
  deductibleAmountCents: number;
  journalEntryId: string | null;
}

interface MonthlyTotal {
  month: string;
  miles: number;
  deductibleCents: number;
  unit: 'mi' | 'km';
}

interface ByClientTotal {
  clientId: string;
  clientName: string;
  miles: number;
  deductibleCents: number;
  unit: 'mi' | 'km';
}

interface ByPurposeTotal {
  purpose: string;
  miles: number;
  deductibleCents: number;
  unit: 'mi' | 'km';
  entryCount: number;
}

interface MileageSummary {
  ytd: { miles: number; deductibleCents: number; entryCount: number };
  monthly: MonthlyTotal[];
  byClient: ByClientTotal[];
  byPurpose: ByPurposeTotal[];
}

interface Client {
  id: string;
  name: string;
}

const fmtMoney = (cents: number, ccy = 'USD') =>
  (cents / 100).toLocaleString(ccy === 'CAD' ? 'en-CA' : 'en-US', {
    style: 'currency',
    currency: ccy,
  });

export const MileagePage: React.FC = () => {
  const [entries, setEntries] = useState<MileageEntry[]>([]);
  const [summary, setSummary] = useState<MileageSummary | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form state
  const [miles, setMiles] = useState('');
  const [unit, setUnit] = useState<'mi' | 'km'>('mi');
  const [purpose, setPurpose] = useState('');
  const [clientId, setClientId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = async () => {
    try {
      const [sumRes, cliRes] = await Promise.all([
        fetch(`${API}/mileage?summary=true`).then((r) => r.json()),
        fetch(`/api/v1/agentbook-invoice/clients?limit=200`).then((r) => r.json()).catch(() => ({ data: [] })),
      ]);
      if (sumRes.success && sumRes.data) {
        setEntries(sumRes.data.entries || []);
        setSummary(sumRes.data.summary || null);
      }
      if (cliRes?.data) setClients(cliRes.data);
    } catch (err) {
      console.warn('[mileage] load failed:', err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      const m = parseFloat(miles);
      if (!isFinite(m) || m <= 0) {
        setFormError('Distance has to be a positive number.');
        setSubmitting(false);
        return;
      }
      if (!purpose.trim()) {
        setFormError('Tell me why you drove (e.g. "TechCorp meeting").');
        setSubmitting(false);
        return;
      }
      const res = await fetch(`${API}/mileage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          miles: m,
          unit,
          purpose: purpose.trim(),
          clientId: clientId || undefined,
          date,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        setFormError(j.error || 'Failed to record trip.');
        setSubmitting(false);
        return;
      }
      // Reset form + reload
      setMiles('');
      setPurpose('');
      setClientId('');
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const exportCsv = () => {
    const year = new Date().getFullYear();
    window.open(`${API}/mileage/export?year=${year}&format=csv`, '_blank');
  };

  const ytd = summary?.ytd;
  const ytdUnit: 'mi' | 'km' = entries[0]?.unit || 'mi';
  const currency = entries.find((e) => e.jurisdiction === 'ca') ? 'CAD' : 'USD';

  return (
    <div className="px-4 py-5 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Car className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Mileage</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted/50 inline-flex items-center gap-2"
            title="Export YTD as CSV (Schedule C / T2125 format)"
          >
            <Download className="w-4 h-4" /> Export YTD
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground inline-flex items-center gap-2"
          >
            {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showForm ? 'Cancel' : 'Log trip'}
          </button>
        </div>
      </div>

      {/* YTD + monthly totals */}
      {ytd && (
        <div className="bg-card border border-border rounded-xl p-4 mb-6 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">YTD Distance</p>
            <p className="text-2xl font-bold">{ytd.miles.toLocaleString()} {ytdUnit}</p>
            <p className="text-xs text-muted-foreground">{ytd.entryCount} {ytd.entryCount === 1 ? 'trip' : 'trips'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">YTD Deductible</p>
            <p className="text-2xl font-bold">{fmtMoney(ytd.deductibleCents, currency)}</p>
            {summary?.monthly.length ? (
              <p className="text-xs text-muted-foreground">
                This month: {fmtMoney(
                  summary.monthly[summary.monthly.length - 1]?.deductibleCents || 0,
                  currency,
                )}
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* Inline form */}
      {showForm && (
        <div className="bg-card border border-border rounded-xl p-4 mb-6 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground">Distance</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                value={miles}
                onChange={(e) => setMiles(e.target.value)}
                placeholder="47"
                className="w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Unit</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as 'mi' | 'km')}
                className="w-full p-2 border border-border rounded-lg bg-background"
              >
                <option value="mi">miles</option>
                <option value="km">km</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Purpose</label>
            <input
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="TechCorp meeting"
              className="w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Client (optional)</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full p-2 border border-border rounded-lg bg-background"
              >
                <option value="">— none —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
          </div>
          {formError && <p className="text-sm text-red-500">{formError}</p>}
          <div className="flex justify-end">
            <button
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save trip'}
            </button>
          </div>
        </div>
      )}

      {/* Entry list */}
      <h2 className="text-sm font-medium text-muted-foreground mb-3">Recent trips</h2>
      <div className="space-y-2">
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">
            No trips yet. Tap <b>Log trip</b> or message your bot
            {' "drove 47 miles to TechCorp"'}.
          </p>
        )}
        {entries.map((e) => {
          const cli = e.clientId ? clients.find((c) => c.id === e.clientId) : null;
          const ccy = e.jurisdiction === 'ca' ? 'CAD' : 'USD';
          return (
            <div key={e.id} className="bg-card border border-border rounded-lg p-3 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {e.miles.toLocaleString()} {e.unit} — {e.purpose}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(e.date).toLocaleDateString()}
                  {cli ? ` · ${cli.name}` : ''}
                  {' · '}{e.ratePerUnitCents}¢/{e.unit}
                </p>
              </div>
              <span className="font-mono text-sm font-semibold">
                {fmtMoney(e.deductibleAmountCents, ccy)}
              </span>
            </div>
          );
        })}
      </div>

      {/* YTD breakdowns — by-client and by-purpose, side-by-side on
          wider viewports so the user can see "who I drove for" and
          "what I drove for" at a glance. */}
      {summary && (summary.byClient.length > 0 || (summary.byPurpose && summary.byPurpose.length > 0)) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          {summary.byClient.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">YTD by client</h2>
              <div className="space-y-2">
                {summary.byClient.map((c) => (
                  <div key={c.clientId} className="bg-card border border-border rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{c.clientName}</p>
                      <p className="text-xs text-muted-foreground">{c.miles.toLocaleString()} {c.unit}</p>
                    </div>
                    <span className="font-mono text-sm">{fmtMoney(c.deductibleCents, currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {summary.byPurpose && summary.byPurpose.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">YTD by purpose</h2>
              <div className="space-y-2">
                {summary.byPurpose.map((p) => (
                  <div key={p.purpose} className="bg-card border border-border rounded-lg p-3 flex items-center justify-between">
                    <div className="min-w-0 pr-2">
                      <p className="text-sm font-medium truncate">{p.purpose}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.miles.toLocaleString()} {p.unit} · {p.entryCount} {p.entryCount === 1 ? 'trip' : 'trips'}
                      </p>
                    </div>
                    <span className="font-mono text-sm">{fmtMoney(p.deductibleCents, currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
