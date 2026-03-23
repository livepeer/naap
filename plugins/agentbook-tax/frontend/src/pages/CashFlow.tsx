import React from 'react';

export const CashFlowPage: React.FC = () => {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
        Cash Flow Projection
      </h1>
      <p className="text-base" style={{ color: 'var(--text-secondary)' }}>
        Forecast and analyze cash flow with scenario modeling.
      </p>
    </div>
  );
};

export default CashFlowPage;
