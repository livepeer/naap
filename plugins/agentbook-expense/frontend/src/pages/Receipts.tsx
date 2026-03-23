import React from 'react';

export const ReceiptsPage: React.FC = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
        Receipts
      </h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Drag and drop upload your receipts for OCR processing and automatic expense creation.
      </p>
    </div>
  );
};
