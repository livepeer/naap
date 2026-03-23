import React from 'react';

export const NewInvoicePage: React.FC = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
        New Invoice
      </h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Invoice creation form coming soon. Add line items, set due dates, and assign clients.
      </p>
    </div>
  );
};

export default NewInvoicePage;
