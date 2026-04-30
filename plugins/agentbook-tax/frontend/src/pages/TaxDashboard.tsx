import React, { useState, useEffect, useCallback } from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Percent,
  Calendar,
  CheckCircle,
  Clock,
  Loader2,
  RefreshCw,
} from 'lucide-react';

interface TaxEstimate {
  total_estimated_tax: number;
  income_tax: number;
  self_employment_tax: number;
  effective_rate: number;
  total_revenue: number;
  total_expenses: number;
  net_income: number;
  quarterly_payments: {
    quarter: string;
    amount_due: number;
    amount_paid: number;
    status: 'paid' | 'due' | 'upcoming' | 'overdue';
    deadline: string;
  }[];
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function formatPercent(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export const TaxDashboardPage: React.FC = () => {
  const [data, setData] = useState<TaxEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/agentbook-tax/tax/estimate');
      if (!res.ok) throw new Error('Failed to fetch tax estimate');
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent-emerald)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20 p-4">
        <p className="text-red-500 mb-3">{error}</p>
        <button
          onClick={fetchData}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const qStatusColor: Record<string, string> = {
    paid: 'border-green-500 bg-green-50',
    due: 'border-amber-500 bg-amber-50',
    upcoming: 'border-blue-500 bg-blue-50',
    overdue: 'border-red-500 bg-red-50',
  };

  const qStatusBadge: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    paid: { bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle className="w-3 h-3" /> },
    due: { bg: 'bg-amber-100', text: 'text-amber-700', icon: <Clock className="w-3 h-3" /> },
    upcoming: { bg: 'bg-blue-100', text: 'text-blue-700', icon: <Calendar className="w-3 h-3" /> },
    overdue: { bg: 'bg-red-100', text: 'text-red-700', icon: <Clock className="w-3 h-3" /> },
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Tax Dashboard
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Real-time tax estimates and quarterly tracking
        </p>
      </div>

      {/* Big number */}
      <div
        className="rounded-xl p-6 mb-6 text-center border"
        style={{ backgroundColor: 'var(--bg-primary, #fff)', borderColor: 'var(--border-primary, #e5e7eb)' }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
          Total Estimated Tax
        </p>
        <p className="text-4xl sm:text-5xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {formatCurrency(data.total_estimated_tax)}
        </p>
      </div>

      {/* Breakdown cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div
          className="rounded-xl p-4 border"
          style={{ backgroundColor: 'var(--bg-primary, #fff)', borderColor: 'var(--border-primary, #e5e7eb)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-blue-100">
              <DollarSign className="w-4 h-4 text-blue-600" />
            </div>
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Income Tax</span>
          </div>
          <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {formatCurrency(data.income_tax)}
          </p>
        </div>

        <div
          className="rounded-xl p-4 border"
          style={{ backgroundColor: 'var(--bg-primary, #fff)', borderColor: 'var(--border-primary, #e5e7eb)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-purple-100">
              <DollarSign className="w-4 h-4 text-purple-600" />
            </div>
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>SE Tax / CPP</span>
          </div>
          <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {formatCurrency(data.self_employment_tax)}
          </p>
        </div>

        <div
          className="rounded-xl p-4 border"
          style={{ backgroundColor: 'var(--bg-primary, #fff)', borderColor: 'var(--border-primary, #e5e7eb)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-amber-100">
              <Percent className="w-4 h-4 text-amber-600" />
            </div>
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Effective Rate</span>
          </div>
          <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {formatPercent(data.effective_rate)}
          </p>
        </div>
      </div>

      {/* Revenue vs Expenses */}
      <div
        className="rounded-xl p-4 sm:p-6 border mb-6"
        style={{ backgroundColor: 'var(--bg-primary, #fff)', borderColor: 'var(--border-primary, #e5e7eb)' }}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--text-secondary)' }}>
          Revenue vs Expenses
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100">
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Revenue</p>
              <p className="text-lg font-bold text-green-600">{formatCurrency(data.total_revenue)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100">
              <TrendingDown className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Expenses</p>
              <p className="text-lg font-bold text-red-600">{formatCurrency(data.total_expenses)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-100">
              <DollarSign className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Net Income</p>
              <p className={`text-lg font-bold ${data.net_income >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatCurrency(data.net_income)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Quarterly tracker */}
      <div
        className="rounded-xl p-4 sm:p-6 border"
        style={{ backgroundColor: 'var(--bg-primary, #fff)', borderColor: 'var(--border-primary, #e5e7eb)' }}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--text-secondary)' }}>
          Quarterly Payments
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {(data.quarterly_payments ?? []).map((q) => {
            const sColor = qStatusColor[q.status] ?? qStatusColor.upcoming;
            const badge = qStatusBadge[q.status] ?? qStatusBadge.upcoming;
            return (
              <div
                key={q.quarter}
                className={`rounded-xl p-4 border-l-4 border ${sColor}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {q.quarter}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                    {badge.icon}
                    {q.status.charAt(0).toUpperCase() + q.status.slice(1)}
                  </span>
                </div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Due: {new Date(q.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
                <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  {formatCurrency(q.amount_due)}
                </p>
                {q.amount_paid > 0 && (
                  <p className="text-xs text-green-600 mt-1">
                    Paid: {formatCurrency(q.amount_paid)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TaxDashboardPage;
