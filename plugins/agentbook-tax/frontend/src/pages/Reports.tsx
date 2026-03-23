import React from 'react';

export const ReportsPage: React.FC = () => {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
        Financial Reports
      </h1>
      <p className="text-base mb-6" style={{ color: 'var(--text-secondary)' }}>
        Generate and view financial reports for your business.
      </p>
      <ul className="space-y-3">
        <li>
          <a href="#pnl" className="text-base font-medium hover:underline" style={{ color: 'var(--accent-emerald)' }}>
            Profit &amp; Loss (P&amp;L)
          </a>
        </li>
        <li>
          <a href="#balance-sheet" className="text-base font-medium hover:underline" style={{ color: 'var(--accent-emerald)' }}>
            Balance Sheet
          </a>
        </li>
        <li>
          <a href="#cashflow" className="text-base font-medium hover:underline" style={{ color: 'var(--accent-emerald)' }}>
            Cash Flow
          </a>
        </li>
      </ul>
    </div>
  );
};

export default ReportsPage;
