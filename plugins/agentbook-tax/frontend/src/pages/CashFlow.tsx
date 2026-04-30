import React, { useState, useEffect, useCallback } from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Wallet,
  Loader2,
  RefreshCw,
} from 'lucide-react';

interface Projection {
  period: string;
  projected_balance: number;
  expected_income: number;
  expected_expenses: number;
}

interface CashFlowData {
  current_balance: number;
  projections: Projection[];
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export const CashFlowPage: React.FC = () => {
  const [data, setData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/agentbook-tax/cashflow/projection');
      if (!res.ok) throw new Error('Failed to fetch cash flow data');
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

  const periodLabels: Record<string, string> = {
    '30-day': '30 Day',
    '60-day': '60 Day',
    '90-day': '90 Day',
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Cash Flow Projection
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Forecast and analyze cash flow with scenario modeling
        </p>
      </div>

      {/* Current balance */}
      <div
        className="rounded-xl p-6 mb-6 text-center border"
        style={{ backgroundColor: 'var(--bg-primary, #fff)', borderColor: 'var(--border-primary, #e5e7eb)' }}
      >
        <div className="inline-flex items-center gap-2 mb-2">
          <div className="p-2 rounded-lg bg-emerald-100">
            <Wallet className="w-5 h-5 text-emerald-600" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
            Current Cash Balance
          </span>
        </div>
        <p
          className={`text-4xl sm:text-5xl font-bold ${
            data.current_balance >= 0 ? 'text-emerald-600' : 'text-red-600'
          }`}
        >
          {formatCurrency(data.current_balance)}
        </p>
      </div>

      {/* Projection cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(data.projections ?? []).map((p) => {
          const isPositive = p.projected_balance >= 0;
          return (
            <div
              key={p.period}
              className={`rounded-xl p-5 border-t-4 border ${
                isPositive ? 'border-t-green-500' : 'border-t-red-500'
              }`}
              style={{ backgroundColor: 'var(--bg-primary, #fff)', borderColor: 'var(--border-primary, #e5e7eb)' }}
            >
              <h3 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-secondary)' }}>
                {periodLabels[p.period] ?? p.period} Projection
              </h3>

              <p
                className={`text-2xl font-bold mb-4 ${isPositive ? 'text-green-600' : 'text-red-600'}`}
              >
                {formatCurrency(p.projected_balance)}
              </p>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-green-100">
                    <TrendingUp className="w-4 h-4 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Expected Income</p>
                    <p className="text-sm font-semibold text-green-600">
                      {formatCurrency(p.expected_income)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-red-100">
                    <TrendingDown className="w-4 h-4 text-red-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Expected Expenses</p>
                    <p className="text-sm font-semibold text-red-600">
                      {formatCurrency(p.expected_expenses)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CashFlowPage;
