import React, { useEffect, useState } from 'react';
import { PieChart, BarChart3, TrendingUp, TrendingDown, Zap } from 'lucide-react';

interface CategoryBreakdown {
  categoryName: string;
  totalCents: number;
  count: number;
  percentOfTotal: number;
}

interface SpendingTrend {
  month: string;
  totalCents: number;
  changePercent: number | null;
}

interface VendorItem {
  vendorName: string;
  totalCents: number;
  transactionCount: number;
  avgAmountCents: number;
}

const TAX_API = '/api/v1/agentbook-tax';
const EXPENSE_API = '/api/v1/agentbook-expense';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export const AnalyticsPage: React.FC = () => {
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [trends, setTrends] = useState<SpendingTrend[]>([]);
  const [vendors, setVendors] = useState<VendorItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const now = new Date().toISOString().split('T')[0];

    Promise.all([
      fetch(`${TAX_API}/reports/category-breakdown?startDate=${yearStart}&endDate=${now}`).then(r => r.json()).catch(() => ({ data: [] })),
      fetch(`${TAX_API}/reports/spending-trend?months=6`).then(r => r.json()).catch(() => ({ data: [] })),
      fetch(`${EXPENSE_API}/vendors`).then(r => r.json()).catch(() => ({ data: [] })),
    ]).then(([cat, trend, vend]) => {
      if (cat.data) setCategories(cat.data);
      if (trend.data) setTrends(trend.data);
      if (vend.data) setVendors(vend.data.slice(0, 10));
    }).finally(() => setLoading(false));
  }, []);

  const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const totalExpenses = categories.reduce((s, c) => s + c.totalCents, 0);

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Expense Analytics</h1>
      </div>

      {loading && <p className="text-muted-foreground">Loading analytics...</p>}

      {/* Category Breakdown — Visual Bar Chart */}
      <div className="bg-card border border-border rounded-xl p-5 mb-6">
        <h2 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
          <PieChart className="w-4 h-4" /> Category Breakdown (YTD)
        </h2>
        <div className="space-y-3">
          {categories.map((cat, i) => (
            <div key={cat.categoryName} className="flex items-center gap-3">
              <div className="w-28 text-sm truncate">{cat.categoryName}</div>
              <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max(2, cat.percentOfTotal * 100)}%`,
                    backgroundColor: COLORS[i % COLORS.length],
                  }}
                />
              </div>
              <div className="w-20 text-right text-sm font-mono">{fmt(cat.totalCents)}</div>
              <div className="w-12 text-right text-xs text-muted-foreground">{(cat.percentOfTotal * 100).toFixed(0)}%</div>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t border-border flex justify-between text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="font-bold">{fmt(totalExpenses)}</span>
        </div>
      </div>

      {/* Monthly Spending Trend */}
      <div className="bg-card border border-border rounded-xl p-5 mb-6">
        <h2 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> Monthly Spending Trend
        </h2>
        <div className="flex items-end gap-2 h-40">
          {trends.map((t, i) => {
            const maxAmount = Math.max(...trends.map(tr => tr.totalCents), 1);
            const height = (t.totalCents / maxAmount) * 100;
            return (
              <div key={t.month} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs font-mono">{fmt(t.totalCents)}</span>
                <div
                  className="w-full bg-primary/80 rounded-t-md transition-all duration-500"
                  style={{ height: `${Math.max(4, height)}%` }}
                />
                <span className="text-xs text-muted-foreground">{t.month.slice(5)}</span>
                {t.changePercent !== null && (
                  <span className={`text-xs ${t.changePercent > 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {t.changePercent > 0 ? '+' : ''}{t.changePercent.toFixed(0)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Top Vendors */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4" /> Top Vendors
        </h2>
        <div className="space-y-2">
          {vendors.map((v, i) => (
            <div key={v.vendorName} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-muted text-xs flex items-center justify-center font-medium">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium">{v.vendorName}</p>
                  <p className="text-xs text-muted-foreground">{v.transactionCount} transactions · avg {fmt(v.avgAmountCents)}</p>
                </div>
              </div>
              <span className="font-mono font-bold text-sm">{fmt(v.totalCents)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
