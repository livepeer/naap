import React from 'react';

export const EstimatesPage: React.FC = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
        Estimates
      </h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Estimates management coming soon. Create estimates and convert them to invoices.
      </p>
    </div>
  );
};

export default EstimatesPage;
