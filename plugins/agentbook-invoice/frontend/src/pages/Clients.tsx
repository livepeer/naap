import React from 'react';

export const ClientsPage: React.FC = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
        Clients
      </h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Client management coming soon. Add and manage billing contacts.
      </p>
    </div>
  );
};

export default ClientsPage;
