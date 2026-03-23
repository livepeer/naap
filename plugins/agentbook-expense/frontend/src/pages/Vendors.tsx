import React from 'react';

export const VendorsPage: React.FC = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
        Vendors
      </h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Manage vendor profiles, patterns, and recurring expense rules.
      </p>
    </div>
  );
};
