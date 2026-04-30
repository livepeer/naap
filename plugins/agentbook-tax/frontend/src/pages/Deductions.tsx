import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  CheckCircle,
  X,
  DollarSign,
  Loader2,
  RefreshCw,
  Tag,
} from 'lucide-react';

interface Deduction {
  id: string;
  category: string;
  description: string;
  estimated_savings: number;
  status: 'suggested' | 'applied' | 'dismissed';
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  suggested: { label: 'Suggested', bg: 'bg-purple-100', text: 'text-purple-700', icon: <Sparkles className="w-3 h-3" /> },
  applied: { label: 'Applied', bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle className="w-3 h-3" /> },
  dismissed: { label: 'Dismissed', bg: 'bg-gray-100', text: 'text-gray-500', icon: <X className="w-3 h-3" /> },
};

export const DeductionsPage: React.FC = () => {
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchDeductions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/agentbook-tax/tax/deductions');
      if (!res.ok) throw new Error('Failed to fetch deductions');
      const data = await res.json();
      setDeductions(Array.isArray(data) ? data : data.deductions ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDeductions();
  }, [fetchDeductions]);

  const updateStatus = async (id: string, status: 'applied' | 'dismissed') => {
    setUpdating(id);
    try {
      await fetch(`/api/v1/agentbook-tax/tax/deductions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await fetchDeductions();
    } catch {
      // ignore
    } finally {
      setUpdating(null);
    }
  };

  const totalPotentialSavings = deductions
    .filter((d) => d.status !== 'dismissed')
    .reduce((sum, d) => sum + d.estimated_savings, 0);

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
          onClick={fetchDeductions}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Deduction Opportunities
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Discover and optimize available tax deductions
        </p>
      </div>

      {/* Total savings banner */}
      <div
        className="rounded-xl p-4 mb-6 flex items-center gap-3 border"
        style={{ backgroundColor: 'var(--bg-primary, #fff)', borderColor: 'var(--border-primary, #e5e7eb)' }}
      >
        <div className="p-2 rounded-lg bg-emerald-100">
          <DollarSign className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
            Total Potential Savings
          </p>
          <p className="text-xl font-bold text-emerald-600">
            {formatCurrency(totalPotentialSavings)}
          </p>
        </div>
      </div>

      {deductions.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>
          <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No deductions found</p>
          <p className="text-sm mt-1">Deduction suggestions will appear as we analyze your data.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {deductions.map((d) => {
            const cfg = STATUS_CONFIG[d.status] ?? STATUS_CONFIG.suggested;
            return (
              <div
                key={d.id}
                className="rounded-xl p-4 border transition-shadow hover:shadow-md"
                style={{ backgroundColor: 'var(--bg-primary, #fff)', borderColor: 'var(--border-primary, #e5e7eb)' }}
              >
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <Tag className="w-3 h-3" />
                        {d.category}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                        {cfg.icon}
                        {cfg.label}
                      </span>
                    </div>
                    <p className="text-sm mt-2" style={{ color: 'var(--text-primary)' }}>
                      {d.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                    <div className="text-right">
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Est. Savings</p>
                      <p className="text-lg font-bold text-emerald-600">
                        {formatCurrency(d.estimated_savings)}
                      </p>
                    </div>
                    {d.status === 'suggested' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => updateStatus(d.id, 'applied')}
                          disabled={updating === d.id}
                          className="p-2 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition-colors disabled:opacity-50"
                          title="Apply"
                        >
                          {updating === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => updateStatus(d.id, 'dismissed')}
                          disabled={updating === d.id}
                          className="p-2 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors disabled:opacity-50"
                          title="Dismiss"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DeductionsPage;
