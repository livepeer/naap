import React from 'react';
import type { Provider } from '../hooks/useProviders';
import { CredentialStatusBadge } from './ProviderCredentialConfig';

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
            border: selected === p.slug ? '2px solid var(--dm-accent-blue)' : '1px solid var(--dm-border)',
            borderRadius: '0.75rem',
            background: selected === p.slug ? 'var(--dm-bg-selected)' : 'var(--dm-bg-primary)',
            color: 'var(--dm-text-primary)',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '1.5rem' }}>{p.icon}</span>
            <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--dm-text-primary)', flex: 1 }}>{p.displayName}</span>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--dm-text-secondary)', margin: 0 }}>{p.description}</p>
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '0.7rem',
              padding: '0.15rem 0.5rem',
              borderRadius: '1rem',
              background: p.mode === 'serverless' ? '#dbeafe' : '#fef3c7',
              color: p.mode === 'serverless' ? 'var(--dm-accent-blue-text)' : '#92400e',
            }}>
              {p.mode === 'serverless' ? 'Serverless' : 'SSH Bridge'}
            </span>
            <span style={{
              fontSize: '0.7rem',
              padding: '0.15rem 0.5rem',
              borderRadius: '1rem',
              background: 'var(--dm-bg-tertiary)',
              color: 'var(--dm-text-secondary)',
            }}>
              {p.authMethod}
            </span>
            {p.mode !== 'ssh-bridge' && <CredentialStatusBadge providerSlug={p.slug} />}
          </div>
        </button>
      ))}
    </div>
  );
};
