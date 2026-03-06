import React, { useState } from 'react';
import { Settings } from 'lucide-react';
import { useProviders } from '../hooks/useProviders';
import { ProviderCredentialConfig, CredentialStatusBadge } from '../components/ProviderCredentialConfig';

export const ProviderSettings: React.FC = () => {
  const { providers, loading } = useProviders();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const selectedProvider = providers.find((p) => p.slug === selectedSlug);

  return (
    <div style={{ padding: '2rem', maxWidth: '960px', margin: '0 auto' }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <Settings size={28} color="var(--dm-text-primary)" />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0, color: 'var(--dm-text-primary)' }}>Provider Settings</h1>
      </div>

      <p style={{ color: 'var(--dm-text-secondary)', marginBottom: '2rem', fontSize: '0.875rem', lineHeight: 1.6 }}>
        Configure API keys and credentials for each GPU provider. Credentials are stored securely
        per user. Use <strong style={{ color: 'var(--dm-text-primary)' }}>Test Connection</strong> to
        verify your credentials work before deploying.
      </p>

      {loading && <p style={{ color: 'var(--dm-text-secondary)' }}>Loading providers...</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.5rem' }}>
        {/* Provider list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {providers.map((p) => (
            <button
              key={p.slug}
              onClick={() => setSelectedSlug(p.slug)}
              style={{
                padding: '0.75rem 1rem',
                border: selectedSlug === p.slug ? '2px solid var(--dm-accent-blue)' : '1px solid var(--dm-border)',
                borderRadius: '0.5rem',
                background: selectedSlug === p.slug ? 'var(--dm-bg-selected)' : 'var(--dm-bg-primary)',
                color: 'var(--dm-text-primary)',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: '1.25rem' }}>{p.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{p.displayName}</div>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--dm-text-tertiary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginTop: '0.15rem',
                }}>
                  <span>{p.authMethod}</span>
                  <CredentialStatusBadge providerSlug={p.slug} />
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Config panel */}
        <div>
          {!selectedProvider ? (
            <div style={{
              padding: '3rem',
              textAlign: 'center',
              color: 'var(--dm-text-tertiary)',
              border: '1px dashed var(--dm-border)',
              borderRadius: '0.75rem',
            }}>
              <Settings size={40} style={{ marginBottom: '0.75rem', opacity: 0.3 }} />
              <p style={{ fontSize: '0.9rem' }}>Select a provider to configure credentials</p>
            </div>
          ) : (
            <ProviderCredentialConfig provider={selectedProvider} />
          )}
        </div>
      </div>
    </div>
  );
};
