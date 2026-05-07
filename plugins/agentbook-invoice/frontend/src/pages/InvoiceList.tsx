import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  FileText,
  Clock,
  CheckCircle,
  AlertTriangle,
  Send,
  DollarSign,
  Loader2,
  RefreshCw,
} from 'lucide-react';

interface Invoice {
  id: string;
  invoice_number: string;
  client_name: string;
  amount: number;
  due_date: string;
  status: 'draft' | 'sent' | 'overdue' | 'paid' | 'void';
  // Origin of the invoice — set on drafts created via the Telegram bot.
  source?: 'web' | 'telegram' | 'api' | null;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  draft: { label: 'Draft', bg: 'bg-gray-100', text: 'text-gray-700', icon: <FileText className="w-3 h-3" /> },
  sent: { label: 'Sent', bg: 'bg-blue-100', text: 'text-blue-700', icon: <Send className="w-3 h-3" /> },
  overdue: { label: 'Overdue', bg: 'bg-red-100', text: 'text-red-700', icon: <AlertTriangle className="w-3 h-3" /> },
  paid: { label: 'Paid', bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle className="w-3 h-3" /> },
  void: { label: 'Void', bg: 'bg-slate-100', text: 'text-slate-500', icon: <FileText className="w-3 h-3" /> },
};

const TABS = ['all', 'draft', 'sent', 'overdue', 'paid'] as const;

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const InvoiceListPage: React.FC = () => {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('all');

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/agentbook-invoice/invoices');
      if (!res.ok) throw new Error('Failed to fetch invoices');
      const data = await res.json();
      setInvoices(Array.isArray(data) ? data : data.invoices ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const filtered = activeTab === 'all' ? invoices : invoices.filter((i) => i.status === activeTab);

  const outstanding = invoices
    .filter((i) => i.status === 'sent' || i.status === 'overdue')
    .reduce((sum, i) => sum + i.amount, 0);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Invoices
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Manage and track all your invoices
          </p>
        </div>
        <button
          onClick={() => navigate('/new')}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors"
          style={{ backgroundColor: 'var(--accent-emerald, #10b981)' }}
        >
          <Plus className="w-4 h-4" />
          New Invoice
        </button>
      </div>

      {/* Outstanding banner */}
      <div
        className="rounded-xl p-4 mb-6 flex items-center gap-3"
        style={{ backgroundColor: 'var(--bg-secondary, #f9fafb)' }}
      >
        <div className="p-2 rounded-lg bg-amber-100">
          <DollarSign className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
            Total Outstanding
          </p>
          <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {formatCurrency(outstanding)}
          </p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {TABS.map((tab) => {
          const count = tab === 'all' ? invoices.length : invoices.filter((i) => i.status === tab).length;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab
                  ? 'text-white'
                  : 'hover:bg-gray-100'
              }`}
              style={
                activeTab === tab
                  ? { backgroundColor: 'var(--accent-emerald, #10b981)' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)} ({count})
            </button>
          );
        })}
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
            onClick={fetchInvoices}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No invoices found</p>
          <p className="text-sm mt-1">Create your first invoice to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((inv) => {
            const cfg = STATUS_CONFIG[inv.status] ?? STATUS_CONFIG.draft;
            return (
              <div
                key={inv.id}
                className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 border border-border bg-card transition-shadow hover:shadow-md cursor-pointer"
              >
                {/* Left: invoice info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-sm text-foreground">
                      {inv.invoice_number}
                    </span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                      {cfg.icon}
                      {cfg.label}
                    </span>
                    {inv.source === 'telegram' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-700">
                        via Telegram
                      </span>
                    )}
                  </div>
                  <p className="text-sm truncate text-muted-foreground">
                    {inv.client_name}
                  </p>
                </div>

                {/* Right: amount + due date */}
                <div className="flex items-center justify-between sm:flex-col sm:items-end gap-1">
                  <span className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
                    {formatCurrency(inv.amount)}
                  </span>
                  <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                    <Clock className="w-3 h-3" />
                    {formatDate(inv.due_date)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default InvoiceListPage;
