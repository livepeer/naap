import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  CheckCircle,
  Clock,
  AlertTriangle,
  DollarSign,
  Loader2,
  RefreshCw,
} from 'lucide-react';

interface Quarter {
  id: string;
  quarter: string;
  deadline: string;
  amount_due: number;
  amount_paid: number;
  status: 'paid' | 'upcoming' | 'overdue';
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_CONFIG: Record<string, { bg: string; border: string; text: string; badge: string; badgeText: string; icon: React.ReactNode }> = {
  paid: {
    bg: 'bg-green-50',
    border: 'border-green-500',
    text: 'text-green-700',
    badge: 'bg-green-100',
    badgeText: 'text-green-700',
    icon: <CheckCircle className="w-3.5 h-3.5" />,
  },
  upcoming: {
    bg: 'bg-amber-50',
    border: 'border-amber-500',
    text: 'text-amber-700',
    badge: 'bg-amber-100',
    badgeText: 'text-amber-700',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  overdue: {
    bg: 'bg-red-50',
    border: 'border-red-500',
    text: 'text-red-700',
    badge: 'bg-red-100',
    badgeText: 'text-red-700',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
};

export const QuarterlyPage: React.FC = () => {
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  const fetchQuarters = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/agentbook-tax/tax/quarterly');
      if (!res.ok) throw new Error('Failed to fetch quarterly data');
      const data = await res.json();
      setQuarters(Array.isArray(data) ? data : data.quarters ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuarters();
  }, [fetchQuarters]);

  const handleRecordPayment = async (quarterId: string) => {
    const amount = parseFloat(paymentAmounts[quarterId] || '0');
    if (amount <= 0) return;
    setSubmitting(quarterId);
    try {
      await fetch(`/api/v1/agentbook-tax/tax/quarterly/${quarterId}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      setPaymentAmounts((prev) => ({ ...prev, [quarterId]: '' }));
      await fetchQuarters();
    } catch {
      // ignore
    } finally {
      setSubmitting(null);
    }
  };

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
          onClick={fetchQuarters}
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
          Quarterly Installments
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Track and manage quarterly tax installment payments
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {quarters.map((q) => {
          const cfg = STATUS_CONFIG[q.status] ?? STATUS_CONFIG.upcoming;
          const remaining = q.amount_due - q.amount_paid;
          return (
            <div
              key={q.id || q.quarter}
              className={`rounded-xl p-5 border-l-4 border ${cfg.border} ${cfg.bg}`}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  {q.quarter}
                </span>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.badge} ${cfg.badgeText}`}>
                  {cfg.icon}
                  {q.status.charAt(0).toUpperCase() + q.status.slice(1)}
                </span>
              </div>

              {/* Details */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                    <Calendar className="w-3.5 h-3.5" /> Deadline
                  </span>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {formatDate(q.deadline)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                    <DollarSign className="w-3.5 h-3.5" /> Amount Due
                  </span>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                    {formatCurrency(q.amount_due)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                    <CheckCircle className="w-3.5 h-3.5" /> Amount Paid
                  </span>
                  <span className="text-sm font-medium text-green-600">
                    {formatCurrency(q.amount_paid)}
                  </span>
                </div>
                {remaining > 0 && (
                  <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: 'var(--border-primary, #e5e7eb)' }}>
                    <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                      Remaining
                    </span>
                    <span className="text-sm font-bold text-amber-600">
                      {formatCurrency(remaining)}
                    </span>
                  </div>
                )}
              </div>

              {/* Record payment */}
              {q.status !== 'paid' && (
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="Amount"
                    value={paymentAmounts[q.id || q.quarter] || ''}
                    onChange={(e) =>
                      setPaymentAmounts((prev) => ({
                        ...prev,
                        [q.id || q.quarter]: e.target.value,
                      }))
                    }
                    className="flex-1 px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    style={{
                      backgroundColor: 'var(--bg-primary, #fff)',
                      borderColor: 'var(--border-primary, #e5e7eb)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <button
                    onClick={() => handleRecordPayment(q.id || q.quarter)}
                    disabled={submitting === (q.id || q.quarter)}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent-emerald, #10b981)' }}
                  >
                    {submitting === (q.id || q.quarter) ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Record'
                    )}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default QuarterlyPage;
