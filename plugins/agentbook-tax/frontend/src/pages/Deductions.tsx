import React from 'react';

export const DeductionsPage: React.FC = () => {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
        Deduction Opportunities
      </h1>
      <p className="text-base" style={{ color: 'var(--text-secondary)' }}>
        Discover and optimize available tax deductions.
      </p>
    </div>
  );
};

export default DeductionsPage;
