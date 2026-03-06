import React from 'react';
import type { Provider } from '../hooks/useProviders';

interface ProviderSelectorProps {
  providers: Provider[];
  selected: string | null;
  onSelect: (slug: string) => void;
}

export const ProviderSelector: React.FC<ProviderSelectorProps> = ({ providers, selected, onSelect }) => {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
      {providers.map((p) => (
        <button
          key={p.slug}
          onClick={() => onSelect(p.slug)}
          style={{
            padding: '1.25rem',
            border: selected === p.slug ? '2px solid #3b82f6' : '1px solid #e5e7eb',
            borderRadius: '0.75rem',
            background: selected === p.slug ? '#eff6ff' : '#fff',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '1.5rem' }}>{p.icon}</span>
            <span style={{ fontWeight: 600, fontSize: '1rem' }}>{p.displayName}</span>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>{p.description}</p>
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
            <span style={{
              fontSize: '0.7rem',
              padding: '0.15rem 0.5rem',
              borderRadius: '1rem',
              background: p.mode === 'serverless' ? '#dbeafe' : '#fef3c7',
              color: p.mode === 'serverless' ? '#1d4ed8' : '#92400e',
            }}>
              {p.mode === 'serverless' ? 'Serverless' : 'SSH Bridge'}
            </span>
            <span style={{
              fontSize: '0.7rem',
              padding: '0.15rem 0.5rem',
              borderRadius: '1rem',
              background: '#f3f4f6',
              color: '#374151',
            }}>
              {p.authMethod}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
};
