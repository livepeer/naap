import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Receipt, Search, ChevronDown, Calendar, CreditCard, Tag, FileText, Image,
  ArrowUpDown, TrendingUp, TrendingDown, Minus, Sparkles, X,
} from 'lucide-react';
import { AdvisorInsights } from '../components/AdvisorInsights';
import { AdvisorChart } from '../components/AdvisorChart';
import { AskBar } from '../components/AskBar';
import { AdvisorResponse } from '../components/AdvisorResponse';

interface Expense {
  id: string;
  amountCents: number;
  taxAmountCents: number;
  tipAmountCents: number;
  description: string;
  notes: string | null;
  date: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryCode: string | null;
  vendorId: string | null;
  vendorName: string | null;
  receiptUrl: string | null;
  paymentMethod: string;
  currency: string;
  tags: string | null;
  confidence: number | null;
  isPersonal: boolean;
  isBillable: boolean;
  journalEntryId: string | null;
}

interface CategorySummary {
  categoryId: string | null;
  categoryName: string;
  totalCents: number;
  count: number;
  previousPeriodCents: number;
  changePercent: number | null;
  topVendors: { name: string; totalCents: number }[];
}

const API = '/api/v1/agentbook-expense';

const PAYMENT_LABELS: Record<string, string> = {
  credit_card: 'Credit Card', debit: 'Debit', cash: 'Cash',
  bank_transfer: 'Bank Transfer', unknown: '',
};

// Clean, minimal tag style — works in both light and dark mode
const TAG_STYLE = 'bg-muted/60 text-foreground/80 border border-border/60';
const TAG_ACTIVE = 'bg-primary/15 text-primary border border-primary/30';
const TAG_HIGHLIGHT = 'bg-destructive/10 text-destructive border border-destructive/20';

const CATEGORY_ICONS: Record<string, string> = {
  'Software & Subscriptions': '💻', 'Rent': '🏢', 'Travel': '✈️', 'Meals': '🍽️',
  'Office Expenses': '📎', 'Insurance': '🛡️', 'Utilities': '⚡', 'Supplies': '📦',
  'Advertising': '📢', 'Contract Labor': '👷', 'Commissions & Fees': '💳',
  'Car & Truck': '🚗', 'Legal & Professional': '⚖️', 'Bank Fees': '🏦', 'Uncategorized': '❓',
};

function fmt(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtDateShort(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Date period presets
type Period = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year' | 'all';

function getPeriodDates(period: Period): { start: Date; end: Date; compareStart: Date; compareEnd: Date } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const dow = now.getDay();

  let start: Date, end: Date, compareStart: Date, compareEnd: Date;

  switch (period) {
    case 'this_week':
      start = new Date(y, m, d - dow);
      end = now;
      compareStart = new Date(y, m, d - dow - 7);
      compareEnd = new Date(y, m, d - 7);
      break;
    case 'last_week':
      start = new Date(y, m, d - dow - 7);
      end = new Date(y, m, d - dow - 1);
      compareStart = new Date(y, m, d - dow - 14);
      compareEnd = new Date(y, m, d - dow - 8);
      break;
    case 'this_month':
      start = new Date(y, m, 1);
      end = now;
      compareStart = new Date(y, m - 1, 1);
      compareEnd = new Date(y, m, 0);
      break;
    case 'last_month':
      start = new Date(y, m - 1, 1);
      end = new Date(y, m, 0);
      compareStart = new Date(y, m - 2, 1);
      compareEnd = new Date(y, m - 1, 0);
      break;
    case 'this_quarter': {
      const qStart = Math.floor(m / 3) * 3;
      start = new Date(y, qStart, 1);
      end = now;
      compareStart = new Date(y, qStart - 3, 1);
      compareEnd = new Date(y, qStart, 0);
      break;
    }
    case 'last_quarter': {
      const qStart = Math.floor(m / 3) * 3 - 3;
      start = new Date(y, qStart, 1);
      end = new Date(y, qStart + 3, 0);
      compareStart = new Date(y, qStart - 3, 1);
      compareEnd = new Date(y, qStart, 0);
      break;
    }
    case 'this_year':
      start = new Date(y, 0, 1);
      end = now;
      compareStart = new Date(y - 1, 0, 1);
      compareEnd = new Date(y - 1, m, d);
      break;
    default: // all
      start = new Date(2020, 0, 1);
      end = now;
      compareStart = new Date(2019, 0, 1);
      compareEnd = new Date(2019, 11, 31);
  }
  return { start, end, compareStart, compareEnd };
}

const PERIOD_LABELS: Record<Period, string> = {
  this_week: 'This Week', last_week: 'Last Week', this_month: 'This Month',
  last_month: 'Last Month', this_quarter: 'This Quarter', last_quarter: 'Last Quarter',
  this_year: 'This Year', all: 'All Time',
};

export const ExpenseListPage: React.FC = () => {
  const navigate = useNavigate();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categorySummary, setCategorySummary] = useState<CategorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'business' | 'personal'>('all');
  const [period, setPeriod] = useState<Period>('this_year');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [autoTagging, setAutoTagging] = useState(false);

  // Advisor state
  const [insights, setInsights] = useState<any[]>([]);
  const [chartResult, setChartResult] = useState<any>(null);
  const [chartType, setChartType] = useState<'bar' | 'pie' | 'trend'>('bar');
  const [advisorResponse, setAdvisorResponse] = useState<any>(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [dismissedInsights, setDismissedInsights] = useState<string[]>(
    JSON.parse(localStorage.getItem('ab_dismissed_insights') || '[]')
  );

  // Fetch expenses + category summary
  useEffect(() => {
    setLoading(true);
    const dates = getPeriodDates(period);
    const qs = new URLSearchParams();
    if (period !== 'all') {
      qs.set('startDate', dates.start.toISOString());
      qs.set('endDate', dates.end.toISOString());
    }
    if (filter === 'business') qs.set('isPersonal', 'false');
    if (filter === 'personal') qs.set('isPersonal', 'true');
    qs.set('limit', '200');

    const catQs = new URLSearchParams();
    if (period !== 'all') {
      catQs.set('startDate', dates.start.toISOString());
      catQs.set('endDate', dates.end.toISOString());
      catQs.set('compareStartDate', dates.compareStart.toISOString());
      catQs.set('compareEndDate', dates.compareEnd.toISOString());
    }

    Promise.all([
      fetch(`${API}/expenses?${qs}`).then(r => r.json()),
      fetch(`${API}/category-summary?${catQs}`).then(r => r.json()),
    ]).then(([expData, catData]) => {
      if (expData.success) setExpenses(expData.data);
      if (catData.success) setCategorySummary(catData.data.categories);
    }).catch(console.error).finally(() => setLoading(false));
  }, [filter, period]);

  // Fetch advisor data when period or chart type changes
  useEffect(() => {
    setInsightsLoading(true);
    const dates = getPeriodDates(period);
    const qs = new URLSearchParams();
    if (period !== 'all') {
      qs.set('startDate', dates.start.toISOString());
      qs.set('endDate', dates.end.toISOString());
    }
    const chartQs = new URLSearchParams(qs);
    chartQs.set('chartType', chartType);
    if (period !== 'all') {
      chartQs.set('compareStartDate', dates.compareStart.toISOString());
      chartQs.set('compareEndDate', dates.compareEnd.toISOString());
    }

    Promise.all([
      fetch(`${API}/advisor/insights?${qs}`).then(r => r.json()).catch(() => ({ success: false })),
      fetch(`${API}/advisor/chart?${chartQs}`).then(r => r.json()).catch(() => ({ success: false })),
    ]).then(([insData, chData]) => {
      if (insData.success) setInsights(insData.data?.insights || []);
      if (chData.success) setChartResult(chData.data);
    }).finally(() => setInsightsLoading(false));
  }, [period, chartType]);

  const handleAsk = async (question: string) => {
    setAdvisorLoading(true);
    try {
      const res = await fetch('/api/v1/agentbook-core/agent/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: question, channel: 'web' }),
      });
      const data = await res.json();
      if (data.success) {
        setAdvisorResponse({
          answer: data.data.message,
          chartData: data.data.chartData,
          actions: data.data.actions,
        });
      }
    } catch { /* silent */ }
    setAdvisorLoading(false);
  };

  const handleDismissInsight = (id: string) => {
    const updated = [...dismissedInsights, id];
    setDismissedInsights(updated);
    localStorage.setItem('ab_dismissed_insights', JSON.stringify(updated));
  };

  // Auto-tag all untagged
  const handleAutoTag = async () => {
    setAutoTagging(true);
    try {
      await fetch(`${API}/auto-tag-all`, { method: 'POST' });
      // Reload
      const dates = getPeriodDates(period);
      const qs = new URLSearchParams();
      if (period !== 'all') { qs.set('startDate', dates.start.toISOString()); qs.set('endDate', dates.end.toISOString()); }
      qs.set('limit', '200');
      const res = await fetch(`${API}/expenses?${qs}`);
      const data = await res.json();
      if (data.success) setExpenses(data.data);
    } catch { /* */ }
    setAutoTagging(false);
  };

  // Filter + search + tag filter
  const filtered = useMemo(() => {
    return expenses.filter(e => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const match = (e.description || '').toLowerCase().includes(q)
          || (e.vendorName || '').toLowerCase().includes(q)
          || (e.categoryName || '').toLowerCase().includes(q)
          || (e.tags || '').toLowerCase().includes(q)
          || (e.notes || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      if (selectedTag) {
        if (!e.tags || !e.tags.split(',').map(t => t.trim()).includes(selectedTag)) return false;
      }
      if (selectedCategory) {
        if (e.categoryId !== selectedCategory) return false;
      }
      return true;
    });
  }, [expenses, searchQuery, selectedTag, selectedCategory]);

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortBy === 'amount') return b.amountCents - a.amountCents;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [filtered, sortBy]);

  // Collect all tags
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    expenses.forEach(e => e.tags?.split(',').forEach(t => { if (t.trim()) tagSet.add(t.trim()); }));
    return [...tagSet].sort();
  }, [expenses]);

  const total = filtered.reduce((s, e) => s + e.amountCents, 0);

  // Check if bank is connected
  const [bankConnected, setBankConnected] = useState<boolean | null>(null);
  useEffect(() => {
    fetch(`${API}/bank-accounts`).then(r => r.json()).then(d => {
      setBankConnected(d.data && d.data.length > 0);
    }).catch(() => setBankConnected(false));
  }, []);
  const withReceipts = filtered.filter(e => e.receiptUrl).length;
  const untagged = expenses.filter(e => !e.tags).length;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Receipt className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Expenses</h1>
            <p className="text-sm text-muted-foreground">{filtered.length} expenses &middot; {fmt(total)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {untagged > 0 && (
            <button onClick={handleAutoTag} disabled={autoTagging}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-50">
              <Sparkles className={`w-3.5 h-3.5 ${autoTagging ? 'animate-spin' : ''}`} />
              Auto-tag {untagged}
            </button>
          )}
          <button onClick={() => navigate('/new')} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            + Record
          </button>
        </div>
      </div>

      {/* Bank Connection Prompt */}
      {bankConnected === false && (
        <div className="mb-4 p-4 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏦</span>
            <div>
              <p className="text-sm font-medium text-foreground">Connect your bank for automatic import</p>
              <p className="text-xs text-muted-foreground">Auto-import transactions and reconcile with your expenses</p>
            </div>
          </div>
          <button onClick={() => { window.location.href = '/agentbook/bank'; }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors shrink-0">
            Connect Bank
          </button>
        </div>
      )}

      {/* Date Period Selector */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4 -mx-1 px-1 snap-x">
        {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setPeriod(key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap snap-start transition-colors ${
              period === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* AI Advisor: Insights + Chart */}
      <AdvisorInsights
        insights={insights.filter(i => !dismissedInsights.includes(i.id))}
        loading={insightsLoading}
        onDismiss={handleDismissInsight}
      />

      {chartResult && (
        <AdvisorChart
          chartType={chartResult.chartType || chartType}
          title={chartResult.title || 'Spending Overview'}
          subtitle={chartResult.subtitle || ''}
          data={chartResult.data || []}
          annotation={chartResult.annotation || ''}
          loading={insightsLoading}
          onTypeChange={(t) => setChartType(t)}
        />
      )}

      {/* Category Cards */}
      {categorySummary.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 mb-5">
          {categorySummary.map(cat => {
            const isActive = selectedCategory === cat.categoryId;
            const pct = cat.changePercent;
            return (
              <button
                key={cat.categoryId || 'uncat'}
                onClick={() => setSelectedCategory(isActive ? null : cat.categoryId)}
                className={`relative p-4 rounded-xl text-left transition-all group ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-md scale-[1.02]'
                    : 'bg-card border border-border hover:bg-muted/50 hover:shadow-sm'
                }`}
              >
                {/* Top row: icon + trend badge */}
                <div className="flex items-start justify-between mb-3">
                  <span className="text-2xl leading-none">{CATEGORY_ICONS[cat.categoryName] || '📁'}</span>
                  {pct !== null && (
                    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                      isActive
                        ? 'bg-primary-foreground/20 text-primary-foreground'
                        : pct > 0
                          ? 'bg-red-500/10 text-red-500'
                          : pct < 0
                            ? 'bg-green-500/10 text-green-600'
                            : 'bg-muted text-muted-foreground'
                    }`}>
                      {pct > 0 ? <TrendingUp className="w-3 h-3" /> : pct < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                      {Math.abs(pct)}%
                    </span>
                  )}
                </div>

                {/* Amount — bold, large, the main thing you read */}
                <p className={`text-xl font-bold tracking-tight ${isActive ? '' : 'text-foreground'}`}>
                  {fmt(cat.totalCents)}
                </p>

                {/* Category name + count */}
                <div className={`mt-1.5 flex items-baseline justify-between gap-2 ${isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                  <p className="text-xs font-medium truncate">{cat.categoryName}</p>
                  <p className="text-[11px] tabular-nums shrink-0">{cat.count}</p>
                </div>

                {/* Active indicator dot */}
                {isActive && (
                  <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-primary-foreground/60" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* AI Advisor: Ask Bar + Response */}
      <AskBar onAsk={handleAsk} loading={advisorLoading} />

      {advisorResponse && (
        <AdvisorResponse
          answer={advisorResponse.answer}
          chartData={advisorResponse.chartData}
          actions={advisorResponse.actions}
          onDismiss={() => setAdvisorResponse(null)}
          onAsk={handleAsk}
        />
      )}

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
          <input
            type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search vendor, description, tag..."
            className="w-full pl-9 pr-8 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['all', 'business', 'personal'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
                filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}>{f}</button>
          ))}
          <button onClick={() => setSortBy(sortBy === 'date' ? 'amount' : 'date')}
            className="px-3 py-1.5 rounded-full text-xs bg-muted text-muted-foreground hover:bg-muted/80 flex items-center gap-1">
            <ArrowUpDown className="w-3 h-3" />{sortBy === 'date' ? 'Date' : 'Amount'}
          </button>
        </div>
      </div>

      {/* Tag Chips */}
      {allTags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-4">
          {selectedTag && (
            <button onClick={() => setSelectedTag(null)}
              className="px-2 py-1 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-200 flex items-center gap-1">
              <X className="w-3 h-3" /> Clear
            </button>
          )}
          {allTags.map(tag => (
            <button key={tag} onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedTag === tag
                  ? TAG_ACTIVE
                  : TAG_STYLE
              }`}>
              {tag}
            </button>
          ))}
        </div>
      )}

      {selectedCategory && (
        <div className="flex items-center gap-2 mb-4 p-2 rounded-lg bg-primary/5 border border-primary/20 text-sm">
          <span>Filtered by: <strong>{categorySummary.find(c => c.categoryId === selectedCategory)?.categoryName}</strong></span>
          <button onClick={() => setSelectedCategory(null)} className="text-primary hover:underline text-xs">Clear</button>
        </div>
      )}

      {loading && <p className="text-muted-foreground py-8 text-center">Loading expenses...</p>}

      {sorted.length === 0 && !loading && (
        <div className="text-center py-16 text-muted-foreground">
          <Receipt className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg mb-2">No expenses found</p>
          <p className="text-sm">Try a different time period or clear your filters.</p>
        </div>
      )}

      {/* Desktop Table */}
      <div className="hidden sm:block">
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</th>
                <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Vendor</th>
                <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Tags</th>
                <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Payment</th>
                <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide text-right">Amount</th>
                <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide text-right">Tax</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(expense => (
                <React.Fragment key={expense.id}>
                  <tr
                    className={`border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors ${expense.isPersonal ? 'opacity-50' : ''}`}
                    onClick={() => setExpandedId(expandedId === expense.id ? null : expense.id)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{fmtDateShort(expense.date)}</td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium">{expense.vendorName || '—'}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[180px]">{expense.description}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {expense.categoryName ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary">
                          {CATEGORY_ICONS[expense.categoryName] || '📁'} {expense.categoryName}
                        </span>
                      ) : (
                        <span className="text-xs text-amber-500">Uncategorized</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap max-w-[150px]">
                        {expense.tags?.split(',').filter(Boolean).slice(0, 2).map(t => (
                          <span key={t} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${t.trim() === 'high-value' ? TAG_HIGHLIGHT : TAG_STYLE}`}>
                            {t.trim()}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {PAYMENT_LABELS[expense.paymentMethod] || expense.paymentMethod}
                    </td>
                    <td className="px-4 py-3 text-right font-bold font-mono">
                      {expense.isPersonal && <span className="text-[10px] font-normal text-amber-500 mr-1">Personal</span>}
                      {fmt(expense.amountCents, expense.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                      {expense.taxAmountCents > 0 ? fmt(expense.taxAmountCents, expense.currency) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {expense.receiptUrl && <Image className="w-3.5 h-3.5 text-green-500" />}
                        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expandedId === expense.id ? 'rotate-180' : ''}`} />
                      </div>
                    </td>
                  </tr>
                  {expandedId === expense.id && (
                    <tr><td colSpan={8} className="px-4 py-4 bg-muted/20">
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                        <div><p className="text-xs text-muted-foreground mb-0.5">Date</p><p>{fmtDate(expense.date)}</p></div>
                        <div><p className="text-xs text-muted-foreground mb-0.5">Category</p><p>{expense.categoryCode || 'N/A'} — {expense.categoryName || 'Uncategorized'}</p></div>
                        <div><p className="text-xs text-muted-foreground mb-0.5">Currency</p><p>{expense.currency}</p></div>
                        <div><p className="text-xs text-muted-foreground mb-0.5">Confidence</p><p>{expense.confidence ? `${(expense.confidence * 100).toFixed(0)}%` : 'Manual'}</p></div>
                        {expense.tipAmountCents > 0 && <div><p className="text-xs text-muted-foreground mb-0.5">Tip</p><p>{fmt(expense.tipAmountCents)}</p></div>}
                        {expense.notes && <div className="col-span-2"><p className="text-xs text-muted-foreground mb-0.5">Notes</p><p>{expense.notes}</p></div>}
                        {expense.receiptUrl && <div><p className="text-xs text-muted-foreground mb-0.5">Receipt</p><a href={expense.receiptUrl} target="_blank" rel="noopener" className="text-primary text-xs hover:underline flex items-center gap-1"><Image className="w-3 h-3" /> View</a></div>}
                        <div><p className="text-xs text-muted-foreground mb-0.5">Ledger</p><p className="text-xs">{expense.journalEntryId ? '✓ Posted' : '✗ Not posted'}</p></div>
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Cards */}
      <div className="sm:hidden space-y-2">
        {sorted.map(expense => (
          <div key={expense.id}
            className={`bg-card border border-border rounded-xl p-3.5 ${expense.isPersonal ? 'opacity-50' : ''}`}
            onClick={() => setExpandedId(expandedId === expense.id ? null : expense.id)}>
            <div className="flex items-start justify-between mb-1.5">
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                {expense.receiptUrl ? (
                  <img src={expense.receiptUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0 text-sm">
                    {CATEGORY_ICONS[expense.categoryName || ''] || '📁'}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{expense.vendorName || expense.description}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(expense.date)}</p>
                </div>
              </div>
              <div className="text-right shrink-0 ml-2">
                <p className="font-bold font-mono text-sm">{fmt(expense.amountCents, expense.currency)}</p>
                {expense.taxAmountCents > 0 && <p className="text-[10px] text-muted-foreground">+{fmt(expense.taxAmountCents)} tax</p>}
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {expense.categoryName && (
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary font-medium">{expense.categoryName}</span>
              )}
              {expense.isPersonal && <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-700 font-medium">Personal</span>}
              {expense.tags?.split(',').filter(Boolean).slice(0, 2).map(t => (
                <span key={t} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${t.trim() === 'high-value' ? TAG_HIGHLIGHT : TAG_STYLE}`}>{t.trim()}</span>
              ))}
              {expense.paymentMethod !== 'unknown' && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><CreditCard className="w-3 h-3" />{PAYMENT_LABELS[expense.paymentMethod]}</span>
              )}
            </div>
            {expandedId === expense.id && (
              <div className="mt-3 pt-3 border-t border-border space-y-1.5 text-xs">
                {expense.description !== expense.vendorName && <p><span className="text-muted-foreground">Description:</span> {expense.description}</p>}
                {expense.notes && <p><span className="text-muted-foreground">Notes:</span> {expense.notes}</p>}
                <p><span className="text-muted-foreground">Ledger:</span> {expense.journalEntryId ? '✓ Posted' : '✗ Not posted'}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ExpenseListPage;
