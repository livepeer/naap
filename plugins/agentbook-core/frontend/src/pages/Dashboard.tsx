import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  BookOpen, TrendingUp, TrendingDown, DollarSign, AlertCircle,
  Calendar, Camera, Receipt, FileText, Calculator, Send,
  Bell, ChevronRight, Clock, Sparkles, Share2,
} from 'lucide-react';

// === Types ===

interface TrialBalanceData {
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
  accounts: { code: string; name: string; accountType: string; balance: number }[];
}

interface RecentExpense {
  id: string;
  amountCents: number;
  description: string;
  date: string;
  isPersonal: boolean;
  receiptUrl: string | null;
}

interface UpcomingDeadline {
  id: string;
  titleKey: string;
  date: string;
  urgency: string;
  actionUrl?: string;
}

interface AgentInsight {
  id: string;
  category: string;
  message: string;
  urgency: 'critical' | 'important' | 'informational';
  actionLabel?: string;
  actionUrl?: string;
}

const CORE_API = '/api/v1/agentbook-core';
const EXPENSE_API = '/api/v1/agentbook-expense';

// === Main Dashboard ===

export const DashboardPage: React.FC = () => {
  const [trialBalance, setTrialBalance] = useState<TrialBalanceData | null>(null);
  const [recentExpenses, setRecentExpenses] = useState<RecentExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshotting, setSnapshotting] = useState(false);
  const dashboardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${CORE_API}/trial-balance`).then(r => r.json()),
      fetch(`${EXPENSE_API}/expenses?limit=5`).then(r => r.json()),
    ])
      .then(([tb, exp]) => {
        if (tb.success) setTrialBalance(tb.data);
        if (exp.success) setRecentExpenses(exp.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const fmt = useCallback((cents: number) => {
    const amount = Math.abs(cents) / 100;
    const sign = cents < 0 ? '-' : '';
    return `${sign}$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);

  // Compute summary
  const revenue = trialBalance?.accounts.filter(a => a.accountType === 'revenue').reduce((s, a) => s + Math.abs(a.balance), 0) || 0;
  const expenses = trialBalance?.accounts.filter(a => a.accountType === 'expense').reduce((s, a) => s + a.balance, 0) || 0;
  const assets = trialBalance?.accounts.filter(a => a.accountType === 'asset').reduce((s, a) => s + a.balance, 0) || 0;
  const netIncome = revenue - expenses;

  // Snapshot: capture dashboard as image and send to Telegram
  const handleSnapshot = async () => {
    setSnapshotting(true);
    try {
      // Request server-side snapshot generation (rendered by Puppeteer/Playwright on server)
      const res = await fetch(`${CORE_API}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'dashboard_highlight',
          data: { revenue, expenses, assets, netIncome, balanced: trialBalance?.balanced },
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Snapshot sent to Telegram
      }
    } catch (err) {
      console.error('Snapshot failed:', err);
    } finally {
      setSnapshotting(false);
    }
  };

  // Proactive insights (simulated for Phase 0, real in Phase 2+)
  const insights: AgentInsight[] = [
    trialBalance && !trialBalance.balanced
      ? { id: 'balance', category: 'alert', message: 'Books are out of balance. Review journal entries.', urgency: 'critical' as const }
      : null,
    recentExpenses.some(e => !e.receiptUrl)
      ? { id: 'receipts', category: 'reminder', message: `${recentExpenses.filter(e => !e.receiptUrl).length} expenses missing receipts.`, urgency: 'important' as const, actionLabel: 'Upload', actionUrl: '/agentbook/receipts' }
      : null,
  ].filter(Boolean) as AgentInsight[];

  return (
    <div ref={dashboardRef} className="px-4 py-5 sm:p-6 max-w-7xl mx-auto">

      {/* === Header (mobile-friendly) === */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">AgentBook</h1>
          <p className="text-sm text-muted-foreground">Your 24/7 accounting agent</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSnapshot}
            disabled={snapshotting}
            className="p-2.5 rounded-xl bg-muted hover:bg-muted/80 transition-colors"
            title="Share dashboard snapshot to Telegram"
          >
            <Share2 className={`w-5 h-5 ${snapshotting ? 'animate-pulse text-primary' : 'text-muted-foreground'}`} />
          </button>
          <button className="p-2.5 rounded-xl bg-muted hover:bg-muted/80 transition-colors relative">
            <Bell className="w-5 h-5 text-muted-foreground" />
            {insights.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center">{insights.length}</span>
            )}
          </button>
        </div>
      </div>

      {/* === Agent Insights (proactive, top of dashboard) === */}
      {insights.length > 0 && (
        <div className="mb-6 space-y-2">
          {insights.map(insight => (
            <div key={insight.id} className={`p-3.5 rounded-xl flex items-start gap-3 ${
              insight.urgency === 'critical' ? 'bg-red-500/10 border border-red-500/20' :
              insight.urgency === 'important' ? 'bg-amber-500/10 border border-amber-500/20' :
              'bg-blue-500/10 border border-blue-500/20'
            }`}>
              <Sparkles className={`w-4 h-4 mt-0.5 shrink-0 ${
                insight.urgency === 'critical' ? 'text-red-500' :
                insight.urgency === 'important' ? 'text-amber-500' : 'text-blue-500'
              }`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm">{insight.message}</p>
              </div>
              {insight.actionLabel && (
                <a href={insight.actionUrl} className="text-xs font-medium text-primary whitespace-nowrap">{insight.actionLabel}</a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* === Financial Summary (2x2 grid on mobile, 4-col on desktop) === */}
      <div id="snapshot-target" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <MetricCard icon={<DollarSign className="w-4 h-4" />} label="Cash" value={fmt(assets)} trend="neutral" color="blue" />
        <MetricCard icon={<TrendingUp className="w-4 h-4" />} label="Revenue" value={fmt(revenue)} trend="up" color="green" />
        <MetricCard icon={<TrendingDown className="w-4 h-4" />} label="Expenses" value={fmt(expenses)} trend="down" color="red" />
        <MetricCard icon={<BookOpen className="w-4 h-4" />} label="Net Income" value={fmt(netIncome)} trend={netIncome >= 0 ? 'up' : 'down'} color={netIncome >= 0 ? 'green' : 'red'} />
      </div>

      {/* === Quick Actions (horizontal scroll on mobile) === */}
      <div className="mb-6">
        <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">Quick Actions</h2>
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
          <QuickActionPill icon={<Camera className="w-4 h-4" />} label="Snap Receipt" href="/agentbook/expenses/new" color="bg-primary text-primary-foreground" />
          <QuickActionPill icon={<FileText className="w-4 h-4" />} label="New Invoice" href="/agentbook/invoices/new" color="bg-accent-purple text-white" />
          <QuickActionPill icon={<Calculator className="w-4 h-4" />} label="Tax Estimate" href="/agentbook/tax" color="bg-accent-amber text-white" />
          <QuickActionPill icon={<BookOpen className="w-4 h-4" />} label="Reports" href="/agentbook/reports" color="bg-accent-green text-white" />
          <QuickActionPill icon={<Send className="w-4 h-4" />} label="Ask Agent" href="#" color="bg-muted text-foreground border border-border" />
        </div>
      </div>

      {/* === Recent Activity (mobile card list) === */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-sm font-medium text-muted-foreground">Recent Expenses</h2>
          <a href="/agentbook/expenses" className="text-xs text-primary flex items-center gap-1">
            View all <ChevronRight className="w-3 h-3" />
          </a>
        </div>

        {recentExpenses.length === 0 && !loading && (
          <div className="bg-card border border-border rounded-xl p-6 text-center">
            <Receipt className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No expenses yet. Send a receipt photo via Telegram!</p>
          </div>
        )}

        <div className="space-y-2">
          {recentExpenses.map(expense => (
            <div key={expense.id} className="bg-card border border-border rounded-xl p-3.5 flex items-center gap-3 active:scale-[0.98] transition-transform">
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                {expense.receiptUrl ? (
                  <img src={expense.receiptUrl} alt="" className="w-9 h-9 rounded-lg object-cover" />
                ) : (
                  <Receipt className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{expense.description}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(expense.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {expense.isPersonal && ' · Personal'}
                </p>
              </div>
              <span className={`text-sm font-bold font-mono ${expense.isPersonal ? 'text-muted-foreground' : 'text-foreground'}`}>
                {fmt(expense.amountCents)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* === Balance Status Bar === */}
      {trialBalance && (
        <div className={`p-3 rounded-xl flex items-center gap-2 text-sm ${
          trialBalance.balanced ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'
        }`}>
          {trialBalance.balanced ? (
            <><BookOpen className="w-4 h-4 shrink-0" /><span>Books balanced: {fmt(trialBalance.totalDebits)} debits = {fmt(trialBalance.totalCredits)} credits</span></>
          ) : (
            <><AlertCircle className="w-4 h-4 shrink-0" /><span>Out of balance! Review journal entries.</span></>
          )}
        </div>
      )}

      {loading && <div className="text-center py-8"><p className="text-sm text-muted-foreground">Loading...</p></div>}
    </div>
  );
};

// === Components ===

const MetricCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  trend: 'up' | 'down' | 'neutral';
  color: 'blue' | 'green' | 'red';
}> = ({ icon, label, value, color }) => {
  const colors = {
    blue: 'text-accent-blue bg-accent-blue/10',
    green: 'text-accent-green bg-accent-green/10',
    red: 'text-accent-rose bg-accent-rose/10',
  };

  return (
    <div className="bg-card border border-border rounded-xl p-3.5 sm:p-5">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
        <div className={`p-1 rounded-md ${colors[color]}`}>{icon}</div>
        <span className="text-xs sm:text-sm">{label}</span>
      </div>
      <p className={`text-lg sm:text-2xl font-bold ${colors[color].split(' ')[0]}`}>{value}</p>
    </div>
  );
};

const QuickActionPill: React.FC<{
  icon: React.ReactNode;
  label: string;
  href: string;
  color: string;
}> = ({ icon, label, href, color }) => (
  <button
    onClick={() => { window.location.href = href; }}
    className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium whitespace-nowrap snap-start shrink-0 active:scale-95 transition-transform ${color}`}
  >
    {icon}
    {label}
  </button>
);
