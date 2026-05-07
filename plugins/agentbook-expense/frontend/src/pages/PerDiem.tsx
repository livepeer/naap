import React, { useEffect, useMemo, useState } from 'react';
import { Plane, Plus, X, Hotel } from 'lucide-react';

const API = '/api/v1/agentbook-expense';

interface PerDiemEntry {
  id: string;
  date: string;
  amountCents: number;
  description: string | null;
}

const fmtMoney = (cents: number) =>
  (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });

// Mirror of the backend's bundled GSA table — used only to render a
// "booked-rates preview" before the user submits. The backend is the
// source of truth; this is a UX nicety so Maya sees what she's about
// to commit to without a server round-trip per keystroke.
const PREVIEW_TABLE: Record<string, { mie: number; lodging: number; label: string }> = {
  'new york city': { mie: 7900, lodging: 28400, label: 'New York City' },
  'nyc': { mie: 7900, lodging: 28400, label: 'New York City' },
  'new york': { mie: 7900, lodging: 28400, label: 'New York City' },
  'san francisco': { mie: 7900, lodging: 27000, label: 'San Francisco' },
  'sf': { mie: 7900, lodging: 27000, label: 'San Francisco' },
  'los angeles': { mie: 7400, lodging: 18100, label: 'Los Angeles' },
  'la': { mie: 7400, lodging: 18100, label: 'Los Angeles' },
  'chicago': { mie: 7900, lodging: 18700, label: 'Chicago' },
  'boston': { mie: 7900, lodging: 27400, label: 'Boston' },
  'washington dc': { mie: 7900, lodging: 25700, label: 'Washington DC' },
  'dc': { mie: 7900, lodging: 25700, label: 'Washington DC' },
  'seattle': { mie: 7900, lodging: 21500, label: 'Seattle' },
  'austin': { mie: 6900, lodging: 17500, label: 'Austin' },
  'denver': { mie: 7400, lodging: 19900, label: 'Denver' },
  'miami': { mie: 7400, lodging: 21700, label: 'Miami' },
  'atlanta': { mie: 6900, lodging: 16500, label: 'Atlanta' },
};
const CONUS_FALLBACK = { mie: 5900, lodging: 10700, label: 'CONUS Standard' };

function previewRate(city: string): { mie: number; lodging: number; label: string; isFallback: boolean } {
  const norm = city.trim().toLowerCase();
  if (!norm) return { ...CONUS_FALLBACK, isFallback: true };
  const direct = PREVIEW_TABLE[norm];
  if (direct) return { ...direct, isFallback: false };
  // loose substring match
  for (const [k, v] of Object.entries(PREVIEW_TABLE)) {
    if (norm.includes(k)) return { ...v, isFallback: false };
  }
  return { ...CONUS_FALLBACK, isFallback: true };
}

function diffDays(startISO: string, endISO: string): number {
  if (!startISO || !endISO) return 0;
  const s = new Date(startISO + 'T00:00:00.000Z');
  const e = new Date(endISO + 'T00:00:00.000Z');
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
  if (e < s) return 0;
  return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

export const PerDiemPage: React.FC = () => {
  const [entries, setEntries] = useState<PerDiemEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [city, setCity] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [includeLodging, setIncludeLodging] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`${API}/per-diem`).then((r) => r.json());
      if (res?.success && res.data) setEntries(res.data.entries || []);
    } catch (err) {
      console.warn('[per-diem] load failed:', err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const previewDays = diffDays(startDate, endDate);
  const preview = useMemo(() => previewRate(city), [city]);
  const previewTotal = previewDays > 0
    ? previewDays * (preview.mie + (includeLodging ? preview.lodging : 0))
    : 0;

  const submit = async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      if (!city.trim()) {
        setFormError('Tell me the city.');
        setSubmitting(false);
        return;
      }
      if (previewDays <= 0) {
        setFormError('End date must be on or after start date.');
        setSubmitting(false);
        return;
      }
      const res = await fetch(`${API}/per-diem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: city.trim(),
          startDate,
          endDate,
          includeLodging,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        setFormError(j.error || 'Failed to record per-diem.');
        setSubmitting(false);
        return;
      }
      setCity('');
      setIncludeLodging(false);
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="px-4 py-5 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Plane className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Per-diem</h1>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground inline-flex items-center gap-2"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancel' : 'Book per-diem'}
        </button>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        GSA per-diem rates for federal travel — book a flat M&amp;IE rate
        instead of itemising every meal.{' '}
        <span className="opacity-70">(US tenants only.)</span>
      </p>

      {showForm && (
        <div className="bg-card border border-border rounded-xl p-4 mb-6 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">City</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="NYC, San Francisco, Boston, …"
              className="w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Start date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">End date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeLodging}
              onChange={(e) => setIncludeLodging(e.target.checked)}
            />
            <Hotel className="w-4 h-4 text-muted-foreground" />
            Include lodging rate
          </label>

          {/* Booked-rates preview */}
          {previewDays > 0 && (
            <div className="bg-muted/40 rounded-lg p-3 text-sm">
              <p className="font-medium mb-1">
                {preview.label}
                {preview.isFallback ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    (CONUS standard fallback rate)
                  </span>
                ) : null}
              </p>
              <p className="text-muted-foreground">
                {previewDays} {previewDays === 1 ? 'day' : 'days'} × {fmtMoney(preview.mie)} M&amp;IE
                {includeLodging ? ` + ${fmtMoney(preview.lodging)} lodging` : ''}
                {' = '}
                <b>{fmtMoney(previewTotal)}</b>
              </p>
            </div>
          )}

          {formError && <p className="text-sm text-red-500">{formError}</p>}
          <div className="flex justify-end">
            <button
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50"
            >
              {submitting ? 'Booking…' : 'Book per-diem'}
            </button>
          </div>
        </div>
      )}

      <h2 className="text-sm font-medium text-muted-foreground mb-3">Recent per-diem entries</h2>
      <div className="space-y-2">
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">
            No per-diem entries yet. Tap <b>Book per-diem</b> or message your
            bot {'"per-diem 3 days NYC"'}.
          </p>
        )}
        {entries.map((e) => (
          <div
            key={e.id}
            className="bg-card border border-border rounded-lg p-3 flex items-center justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{e.description || 'Per-diem entry'}</p>
              <p className="text-xs text-muted-foreground">{new Date(e.date).toLocaleDateString()}</p>
            </div>
            <span className="font-mono text-sm font-semibold">{fmtMoney(e.amountCents)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
