import React from 'react';

export const InvoiceListPage: React.FC = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
        Invoices
      </h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Invoice list coming soon. Create, view, and manage invoices.
      </p>
    </div>
  );
};

export default InvoiceListPage;
