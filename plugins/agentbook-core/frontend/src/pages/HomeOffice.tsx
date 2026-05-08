/**
 * Home-office quarterly entry page (PR 15).
 *
 * Three sections:
 *   • Config — total + office sqft (or US-simplified toggle), saved
 *     via PUT /agentbook-core/home-office/config.
 *   • Quarterly entry — pick year/quarter and enter the four
 *     component totals (utilities, internet, rent/mortgage interest,
 *     insurance) plus an "other" line. Submitting POSTs to
 *     /agentbook-core/home-office/post-quarter and the deductible
 *     portion is computed server-side.
 *   • History — past entries pulled via GET /post-quarter. Sorted
 *     by date desc.
 *
 * The page is intentionally self-contained — no shared layout — so
 * the plugin loader can mount it without dragging in the rest of the
 * core dashboard chrome. Mirrors the per-diem page's UX (PR 14).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Home, Save, Plus } from 'lucide-react';

const API = '/api/v1/agentbook-core';

interface HomeOfficeConfig {
  id: string;
  tenantId: string;
  totalSqft: number | null;
  officeSqft: number | null;
  ratio: number | null;
  useUsSimplified: boolean;
}

interface HomeOfficeEntry {
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

// Mirror of the backend computation — used purely for the live
// preview before submit. The server is authoritative.
const US_SIMPLIFIED_RATE = 500;
const US_SIMPLIFIED_MAX = 300;

function previewDeductibleCents(args: {
  useSimplified: boolean;
  ratio: number;
  officeSqft: number;
  utilitiesCents: number;
  internetCents: number;
  rentInterestCents: number;
  insuranceCents: number;
  otherCents: number;
}): { totalCents: number; deductibleCents: number } {
  const totalCents =
    args.utilitiesCents +
    args.internetCents +
    args.rentInterestCents +
    args.insuranceCents +
    args.otherCents;

  if (args.useSimplified) {
    const sqft = Math.min(args.officeSqft, US_SIMPLIFIED_MAX);
    if (sqft <= 0) return { totalCents, deductibleCents: 0 };
    const annual = sqft * US_SIMPLIFIED_RATE;
    return { totalCents, deductibleCents: Math.round(annual / 4) };
  }
  const safe = Math.min(Math.max(args.ratio, 0), 1);
  return { totalCents, deductibleCents: Math.round(totalCents * safe) };
}

function dollarsToCents(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  if (!isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export const HomeOfficePage: React.FC = () => {
  const [cfg, setCfg] = useState<HomeOfficeConfig | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);
  const [cfgMessage, setCfgMessage] = useState<string | null>(null);

  const [totalSqft, setTotalSqft] = useState<string>('');
  const [officeSqft, setOfficeSqft] = useState<string>('');
  const [useSimplified, setUseSimplified] = useState(false);

  const today = new Date();
  const currentYear = today.getUTCFullYear();
  const currentQuarter = Math.floor(today.getUTCMonth() / 3) + 1;
  const [year, setYear] = useState<number>(currentYear);
  const [quarter, setQuarter] = useState<number>(currentQuarter);
  const [utilities, setUtilities] = useState('');
  const [internet, setInternet] = useState('');
  const [rentInterest, setRentInterest] = useState('');
  const [insurance, setInsurance] = useState('');
  const [other, setOther] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [entries, setEntries] = useState<HomeOfficeEntry[]>([]);

  const loadConfig = async () => {
    try {
      const r = await fetch(`${API}/home-office/config`).then((res) => res.json());
      if (r?.success && r.data) {
        const c = r.data as HomeOfficeConfig;
        setCfg(c);
        setTotalSqft(c.totalSqft != null ? String(c.totalSqft) : '');
        setOfficeSqft(c.officeSqft != null ? String(c.officeSqft) : '');
        setUseSimplified(!!c.useUsSimplified);
      }
    } catch (err) {
      console.warn('[home-office] loadConfig failed:', err);
    }
  };

  const loadHistory = async () => {
    try {
      const r = await fetch(`${API}/home-office/post-quarter`).then((res) => res.json());
      if (r?.success && r.data) setEntries(r.data.entries || []);
    } catch (err) {
      console.warn('[home-office] loadHistory failed:', err);
    }
  };

  useEffect(() => {
    loadConfig();
    loadHistory();
  }, []);

  const saveConfig = async () => {
    setSavingCfg(true);
    setCfgMessage(null);
    try {
      const t = totalSqft ? parseInt(totalSqft, 10) : null;
      const o = officeSqft ? parseInt(officeSqft, 10) : null;
      if (t != null && (!isFinite(t) || t < 0)) {
        setCfgMessage('Total sqft must be a non-negative integer.');
        return;
      }
      if (o != null && (!isFinite(o) || o < 0)) {
        setCfgMessage('Office sqft must be a non-negative integer.');
        return;
      }
      if (t != null && o != null && o > t) {
        setCfgMessage('Office sqft cannot exceed total sqft.');
        return;
      }
      const res = await fetch(`${API}/home-office/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totalSqft: t,
          officeSqft: o,
          useUsSimplified: useSimplified,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        setCfgMessage(j.error || 'Failed to save.');
        return;
      }
      setCfg(j.data);
      setCfgMessage('Saved.');
    } catch (err) {
      setCfgMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingCfg(false);
    }
  };

  const submitQuarter = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body = {
        year,
        quarter,
        utilities: dollarsToCents(utilities),
        internet: dollarsToCents(internet),
        rentInterest: dollarsToCents(rentInterest),
        insurance: dollarsToCents(insurance),
        otherCents: dollarsToCents(other),
      };
      const res = await fetch(`${API}/home-office/post-quarter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        setSubmitError(j.error || 'Failed to post quarter.');
        return;
      }
      setUtilities('');
      setInternet('');
      setRentInterest('');
      setInsurance('');
      setOther('');
      await loadHistory();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const ratio = useMemo(() => {
    const t = parseFloat(totalSqft || '0');
    const o = parseFloat(officeSqft || '0');
    if (!isFinite(t) || !isFinite(o) || t <= 0 || o <= 0) return 0;
    return Math.min(o / t, 1);
  }, [totalSqft, officeSqft]);

  const preview = useMemo(() => {
    return previewDeductibleCents({
      useSimplified,
      ratio,
      officeSqft: parseInt(officeSqft || '0', 10),
      utilitiesCents: dollarsToCents(utilities),
      internetCents: dollarsToCents(internet),
      rentInterestCents: dollarsToCents(rentInterest),
      insuranceCents: dollarsToCents(insurance),
      otherCents: dollarsToCents(other),
    });
  }, [useSimplified, ratio, officeSqft, utilities, internet, rentInterest, insurance, other]);

  return (
    <div className="px-4 py-5 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Home className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Home office</h1>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        Quarterly home-office deduction. Configure your square footage
        once, then post each quarter's totals — we&rsquo;ll compute the
        deductible portion (US simplified $5/sqft up to 300 sqft, or
        actual-expense via your office:total ratio).
      </p>

      {/* ─── Config ─────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-xl p-4 mb-6 space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Configuration
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Total sqft</label>
            <input
              type="number"
              min={0}
              value={totalSqft}
              onChange={(e) => setTotalSqft(e.target.value)}
              placeholder="2000"
              className="w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Office sqft</label>
            <input
              type="number"
              min={0}
              value={officeSqft}
              onChange={(e) => setOfficeSqft(e.target.value)}
              placeholder="200"
              className="w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useSimplified}
            onChange={(e) => setUseSimplified(e.target.checked)}
          />
          Use US simplified method ($5/sqft, max 300 sqft, $1,500/yr cap)
        </label>
        {!useSimplified && ratio > 0 && (
          <p className="text-xs text-muted-foreground">
            Computed ratio: <b>{(ratio * 100).toFixed(1)}%</b>
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={saveConfig}
            disabled={savingCfg}
            className="px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {savingCfg ? 'Saving…' : 'Save config'}
          </button>
          {cfgMessage && (
            <span className="text-xs text-muted-foreground">{cfgMessage}</span>
          )}
        </div>
      </section>

      {/* ─── Quarterly entry ────────────────────────────── */}
      <section className="bg-card border border-border rounded-xl p-4 mb-6 space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Post a quarter
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Year</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10) || currentYear)}
              className="w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Quarter</label>
            <select
              value={quarter}
              onChange={(e) => setQuarter(parseInt(e.target.value, 10))}
              className="w-full p-2 border border-border rounded-lg bg-background"
            >
              <option value={1}>Q1 (Jan–Mar)</option>
              <option value={2}>Q2 (Apr–Jun)</option>
              <option value={3}>Q3 (Jul–Sep)</option>
              <option value={4}>Q4 (Oct–Dec)</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Utilities ($)</label>
            <input
              type="text"
              inputMode="decimal"
              value={utilities}
              onChange={(e) => setUtilities(e.target.value)}
              placeholder="400"
              className="w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Internet ($)</label>
            <input
              type="text"
              inputMode="decimal"
              value={internet}
              onChange={(e) => setInternet(e.target.value)}
              placeholder="90"
              className="w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              Rent / mortgage interest ($)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={rentInterest}
              onChange={(e) => setRentInterest(e.target.value)}
              placeholder="3000"
              className="w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Insurance ($)</label>
            <input
              type="text"
              inputMode="decimal"
              value={insurance}
              onChange={(e) => setInsurance(e.target.value)}
              placeholder="90"
              className="w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Other ($)</label>
            <input
              type="text"
              inputMode="decimal"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="0"
              className="w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>
        </div>

        {/* Live preview */}
        <div className="bg-muted/40 rounded-lg p-3 text-sm">
          <p className="text-muted-foreground">
            Total quarter overhead: <b>{fmtMoney(preview.totalCents)}</b>
          </p>
          <p className="text-muted-foreground">
            Deductible portion ({useSimplified ? 'US simplified' : 'actual'}): {' '}
            <b>{fmtMoney(preview.deductibleCents)}</b>
          </p>
        </div>

        {submitError && <p className="text-sm text-red-500">{submitError}</p>}
        <div className="flex justify-end">
          <button
            onClick={submitQuarter}
            disabled={submitting}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {submitting ? 'Posting…' : 'Post quarter'}
          </button>
        </div>
      </section>

      {/* ─── History ────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          Past home-office entries
        </h2>
        <div className="space-y-2">
          {entries.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No home-office entries yet. Post a quarter above, or message
              your bot {'"Q2 home office: utilities $400, internet $90, rent $3000"'}.
            </p>
          )}
          {entries.map((e) => (
            <div
              key={e.id}
              className="bg-card border border-border rounded-lg p-3 flex items-center justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {e.description || 'Home-office entry'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(e.date).toLocaleDateString()}
                </p>
              </div>
              <span className="font-mono text-sm font-semibold">
                {fmtMoney(e.amountCents)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
