import React from 'react';

export const ExpenseListPage: React.FC = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
        Expenses
      </h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Track and manage your expenses. Auto-categorization, vendor patterns, and recurring expense detection coming soon.
      </p>
    </div>
  );
};
