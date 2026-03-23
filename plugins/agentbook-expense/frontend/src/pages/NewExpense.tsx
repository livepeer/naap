import React from 'react';

export const NewExpensePage: React.FC = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
        Record Expense
      </h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Record a new expense with auto-categorization and business/personal separation.
      </p>
    </div>
  );
};
