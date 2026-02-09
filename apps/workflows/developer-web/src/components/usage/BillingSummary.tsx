import React from 'react';
import { Activity, Clock, DollarSign, Calendar, CreditCard, FileText } from 'lucide-react';
import { Badge } from '@naap/ui';
import type { Invoice } from '@naap/types';

interface BillingSummaryProps {
  totalSessions: number;
  totalOutputMinutes: number;
  estimatedCost: number;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  invoices: Invoice[];
}

export const BillingSummary: React.FC<BillingSummaryProps> = ({
  totalSessions,
  totalOutputMinutes,
  estimatedCost,
  billingPeriodStart,
  billingPeriodEnd,
  invoices,
}) => {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Calculate billing period progress (mock)
  const periodStart = new Date(billingPeriodStart);
  const periodEnd = new Date(billingPeriodEnd);
  const now = new Date();
  const totalDays = (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24);
  const daysElapsed = (now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24);
  const progressPercent = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-accent-blue/10 flex items-center justify-center">
              <Activity size={20} className="text-accent-blue" />
            </div>
            <div>
              <p className="text-xs text-text-secondary">Total Sessions</p>
              <p className="text-2xl font-mono font-bold text-text-primary">{totalSessions.toLocaleString()}</p>
            </div>
          </div>
          <p className="text-xs text-text-secondary">This billing period</p>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-accent-emerald/10 flex items-center justify-center">
              <Clock size={20} className="text-accent-emerald" />
            </div>
            <div>
              <p className="text-xs text-text-secondary">Total Output</p>
              <p className="text-2xl font-mono font-bold text-text-primary">{totalOutputMinutes.toFixed(1)} min</p>
            </div>
          </div>
          <p className="text-xs text-text-secondary">Generated video length</p>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-accent-amber/10 flex items-center justify-center">
              <DollarSign size={20} className="text-accent-amber" />
            </div>
            <div>
              <p className="text-xs text-text-secondary">Estimated Cost</p>
              <p className="text-2xl font-mono font-bold text-accent-emerald">${estimatedCost.toFixed(2)}</p>
            </div>
          </div>
          <p className="text-xs text-text-secondary">Current period estimate</p>
        </div>
      </div>

      {/* Billing Period Progress */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-text-secondary" />
            <h3 className="font-medium text-text-primary">Current Billing Period</h3>
          </div>
          <span className="text-sm text-text-secondary">
            {formatDate(billingPeriodStart)} - {formatDate(billingPeriodEnd)}
          </span>
        </div>
        <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-gradient-to-r from-accent-blue to-accent-emerald rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>{Math.round(daysElapsed)} days elapsed</span>
          <span>{Math.round(totalDays - daysElapsed)} days remaining</span>
        </div>
      </div>

      {/* Payment Method Placeholder */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CreditCard size={18} className="text-text-secondary" />
            <h3 className="font-medium text-text-primary">Payment Method</h3>
          </div>
          <button className="text-sm text-accent-blue hover:text-accent-blue/80 transition-colors">
            Update
          </button>
        </div>
        <div className="flex items-center gap-4 p-4 bg-bg-tertiary/50 rounded-xl">
          <div className="w-12 h-8 bg-gradient-to-r from-accent-blue to-accent-emerald rounded flex items-center justify-center">
            <span className="text-white text-xs font-bold">VISA</span>
          </div>
          <div>
            <p className="text-text-primary text-sm font-medium">•••• •••• •••• 4242</p>
            <p className="text-text-secondary text-xs">Expires 12/28</p>
          </div>
        </div>
      </div>

      {/* Invoice History */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-text-secondary" />
            <h3 className="font-medium text-text-primary">Invoice History</h3>
          </div>
          <button className="text-sm text-accent-blue hover:text-accent-blue/80 transition-colors">
            View all
          </button>
        </div>
        {invoices.length > 0 ? (
          <div className="space-y-3">
            {invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-center justify-between p-4 bg-bg-tertiary/50 rounded-xl hover:bg-bg-tertiary transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-bg-tertiary flex items-center justify-center">
                    <FileText size={18} className="text-text-secondary" />
                  </div>
                  <div>
                    <p className="text-text-primary text-sm font-medium">
                      Invoice #{invoice.id.slice(-4).toUpperCase()}
                    </p>
                    <p className="text-text-secondary text-xs">{formatDate(invoice.date)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Badge
                    variant={
                      invoice.status === 'paid'
                        ? 'emerald'
                        : invoice.status === 'pending'
                        ? 'amber'
                        : 'rose'
                    }
                  >
                    {invoice.status}
                  </Badge>
                  <span className="font-mono font-bold text-text-primary">
                    ${invoice.amount.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-text-secondary">
            <FileText size={32} className="mx-auto mb-3 opacity-30" />
            <p>No invoices yet</p>
          </div>
        )}
      </div>
    </div>
  );
};
