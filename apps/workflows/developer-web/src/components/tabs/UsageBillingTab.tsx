import React, { useState, useMemo } from 'react';
import { ChevronDown, Calendar } from 'lucide-react';
import { mockApiKeys, mockUsageRecords, mockInvoices } from '../../data/mockData';
import { UsageCharts } from '../usage/UsageCharts';
import { BillingSummary } from '../usage/BillingSummary';

type DateRange = '7d' | '30d' | 'period';

export const UsageBillingTab: React.FC = () => {
  const [selectedKeyId, setSelectedKeyId] = useState<string>('all');
  const [dateRange, setDateRange] = useState<DateRange>('7d');
  const [showKeyDropdown, setShowKeyDropdown] = useState(false);

  // Filter usage records
  const filteredRecords = useMemo(() => {
    let records = [...mockUsageRecords];

    // Filter by key
    if (selectedKeyId !== 'all') {
      records = records.filter((r) => r.keyId === selectedKeyId);
    }

    // Filter by date range
    const now = new Date();
    let cutoffDate: Date;

    switch (dateRange) {
      case '7d':
        cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'period':
        cutoffDate = new Date('2026-01-01'); // Mock billing period start
        break;
    }

    records = records.filter((r) => new Date(r.date) >= cutoffDate);

    // Aggregate by date
    const byDate: Record<string, { sessions: number; outputMinutes: number; estimatedCost: number }> = {};

    records.forEach((r) => {
      if (!byDate[r.date]) {
        byDate[r.date] = { sessions: 0, outputMinutes: 0, estimatedCost: 0 };
      }
      byDate[r.date].sessions += r.sessions;
      byDate[r.date].outputMinutes += r.outputMinutes;
      byDate[r.date].estimatedCost += r.estimatedCost;
    });

    return Object.entries(byDate)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [selectedKeyId, dateRange]);

  // Calculate totals
  const totals = useMemo(() => {
    return filteredRecords.reduce(
      (acc, r) => ({
        sessions: acc.sessions + r.sessions,
        outputMinutes: acc.outputMinutes + r.outputMinutes,
        estimatedCost: acc.estimatedCost + r.estimatedCost,
      }),
      { sessions: 0, outputMinutes: 0, estimatedCost: 0 }
    );
  }, [filteredRecords]);

  const selectedKey = mockApiKeys.find((k) => k.id === selectedKeyId);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-4">
        {/* Key Selector */}
        <div className="relative">
          <button
            onClick={() => setShowKeyDropdown(!showKeyDropdown)}
            className="flex items-center gap-2 px-4 py-2.5 bg-bg-secondary border border-white/10 rounded-xl text-sm hover:border-white/20 transition-all min-w-[200px]"
          >
            <span className="text-text-primary">
              {selectedKeyId === 'all' ? 'All API Keys' : selectedKey?.projectName}
            </span>
            <ChevronDown size={16} className="text-text-secondary ml-auto" />
          </button>
          {showKeyDropdown && (
            <div className="absolute z-10 mt-2 w-full bg-bg-tertiary border border-white/10 rounded-xl overflow-hidden shadow-xl">
              <button
                onClick={() => {
                  setSelectedKeyId('all');
                  setShowKeyDropdown(false);
                }}
                className={`w-full px-4 py-3 text-left text-sm hover:bg-white/5 transition-colors ${
                  selectedKeyId === 'all' ? 'text-accent-emerald' : 'text-text-primary'
                }`}
              >
                All API Keys
              </button>
              {mockApiKeys
                .filter((k) => k.status === 'active')
                .map((key) => (
                  <button
                    key={key.id}
                    onClick={() => {
                      setSelectedKeyId(key.id);
                      setShowKeyDropdown(false);
                    }}
                    className={`w-full px-4 py-3 text-left text-sm hover:bg-white/5 transition-colors ${
                      selectedKeyId === key.id ? 'text-accent-emerald' : 'text-text-primary'
                    }`}
                  >
                    {key.projectName}
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Date Range */}
        <div className="flex items-center gap-1 bg-bg-secondary border border-white/10 rounded-xl p-1">
          {[
            { id: '7d', label: '7 days' },
            { id: '30d', label: '30 days' },
            { id: 'period', label: 'Billing Period' },
          ].map((option) => (
            <button
              key={option.id}
              onClick={() => setDateRange(option.id as DateRange)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                dateRange === option.id
                  ? 'bg-accent-emerald text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {option.id === 'period' && <Calendar size={14} />}
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Charts */}
      <UsageCharts data={filteredRecords} />

      {/* Billing Summary */}
      <BillingSummary
        totalSessions={totals.sessions}
        totalOutputMinutes={totals.outputMinutes}
        estimatedCost={totals.estimatedCost}
        billingPeriodStart="2026-01-01"
        billingPeriodEnd="2026-02-01"
        invoices={mockInvoices}
      />
    </div>
  );
};
