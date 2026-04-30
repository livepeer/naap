import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  ArrowRightCircle,
  Loader2,
  RefreshCw,
  Plus,
} from 'lucide-react';

interface Estimate {
  id: string;
  estimate_number: string;
  client_name: string;
  amount: number;
  status: 'pending' | 'approved' | 'declined' | 'expired' | 'converted';
  created_at: string;
  valid_until: string;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  pending: { label: 'Pending', bg: 'bg-amber-100', text: 'text-amber-700', icon: <Clock className="w-3 h-3" /> },
  approved: { label: 'Approved', bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle className="w-3 h-3" /> },
  declined: { label: 'Declined', bg: 'bg-red-100', text: 'text-red-700', icon: <XCircle className="w-3 h-3" /> },
  expired: { label: 'Expired', bg: 'bg-gray-100', text: 'text-gray-500', icon: <Clock className="w-3 h-3" /> },
  converted: { label: 'Converted', bg: 'bg-blue-100', text: 'text-blue-700', icon: <ArrowRightCircle className="w-3 h-3" /> },
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const EstimatesPage: React.FC = () => {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState<string | null>(null);

  const fetchEstimates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/agentbook-invoice/estimates');
      if (!res.ok) throw new Error('Failed to fetch estimates');
      const data = await res.json();
      setEstimates(Array.isArray(data) ? data : data.estimates ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEstimates();
  }, [fetchEstimates]);

  const handleConvert = async (id: string) => {
    setConverting(id);
    try {
      await fetch(`/api/v1/agentbook-invoice/estimates/${id}/convert`, { method: 'POST' });
      await fetchEstimates();
    } catch {
      // ignore
    } finally {
      setConverting(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Estimates
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Create estimates and convert them to invoices
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors"
          style={{ backgroundColor: 'var(--accent-emerald, #10b981)' }}
        >
          <Plus className="w-4 h-4" />
          New Estimate
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent-emerald)' }} />
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-red-500 mb-3">{error}</p>
          <button
            onClick={fetchEstimates}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : estimates.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No estimates yet</p>
          <p className="text-sm mt-1">Create your first estimate to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {estimates.map((est) => {
            const cfg = STATUS_CONFIG[est.status] ?? STATUS_CONFIG.pending;
            return (
              <div
                key={est.id}
                className="rounded-xl p-4 border border-border bg-card transition-shadow hover:shadow-md"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm text-foreground">
                        {est.estimate_number}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                        {cfg.icon}
                        {cfg.label}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {est.client_name}
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                      Created {formatDate(est.created_at)} &middot; Valid until {formatDate(est.valid_until)}
                    </p>
                  </div>

                  {/* Amount + action */}
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
                      {formatCurrency(est.amount)}
                    </span>
                    {est.status === 'approved' && (
                      <button
                        onClick={() => handleConvert(est.id)}
                        disabled={converting === est.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-colors disabled:opacity-50"
                        style={{ backgroundColor: 'var(--accent-emerald, #10b981)' }}
                      >
                        {converting === est.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <ArrowRightCircle className="w-3 h-3" />
                        )}
                        Convert to Invoice
                      </button>
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

export default EstimatesPage;
