import React from 'react';

export const QuarterlyPage: React.FC = () => {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
        Quarterly Installments
      </h1>
      <p className="text-base" style={{ color: 'var(--text-secondary)' }}>
        Track and manage quarterly tax installment payments.
      </p>
    </div>
  );
};

export default QuarterlyPage;
