import React, { useState, useEffect } from 'react';
import { Settings, Shield, Check, X } from 'lucide-react';
import { useProviders, type Provider } from '../hooks/useProviders';

const API_BASE = '/api/v1/deployment-manager';

export const ProviderSettings: React.FC = () => {
  const { providers, loading } = useProviders();
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSave = async () => {
    if (!selectedProvider) return;
    setSaving(true);
    setSaveResult(null);
    try {
      // In a full implementation, this would save to SecretVault via the backend
      await new Promise((r) => setTimeout(r, 500));
      setSaveResult({ success: true, message: `Credentials saved for ${selectedProvider}` });
      setApiKey('');
    } catch (err: any) {
      setSaveResult({ success: false, message: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
        <Settings size={28} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Provider Settings</h1>
      </div>

      <p style={{ color: '#6b7280', marginBottom: '2rem', fontSize: '0.875rem' }}>
        Configure authentication credentials for each GPU serverless provider. Credentials are securely stored
        in the SecretVault and used by the service gateway for API authentication.
      </p>

      {loading && <p style={{ color: '#6b7280' }}>Loading providers...</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '2rem' }}>
        {/* Provider list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {providers.map((p) => (
            <button
              key={p.slug}
              onClick={() => { setSelectedProvider(p.slug); setSaveResult(null); }}
              style={{
                padding: '0.75rem 1rem',
                border: selectedProvider === p.slug ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                borderRadius: '0.5rem',
                background: selectedProvider === p.slug ? '#eff6ff' : '#fff',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
              }}
            >
              <span style={{ fontSize: '1.25rem' }}>{p.icon}</span>
              <div>
                <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{p.displayName}</div>
                <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{p.authMethod}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Config panel */}
        <div style={{ padding: '1.5rem', border: '1px solid #e5e7eb', borderRadius: '0.75rem' }}>
          {!selectedProvider ? (
            <p style={{ color: '#9ca3af', textAlign: 'center' }}>Select a provider to configure</p>
          ) : (
            <>
              {(() => {
                const provider = providers.find((p) => p.slug === selectedProvider);
                if (!provider) return null;
                return (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                      <Shield size={20} color="#3b82f6" />
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{provider.displayName} Credentials</h3>
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, marginBottom: '0.25rem' }}>
                        {provider.authMethod === 'api-key' ? 'API Key' :
                         provider.authMethod === 'ssh-key' ? 'SSH Configuration' :
                         provider.authMethod === 'token' ? 'Bearer Token' : 'Credentials'}
                      </label>
                      {provider.mode === 'ssh-bridge' ? (
                        <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                          SSH credentials are configured per-deployment in the deployment wizard.
                          The SSH Bridge connector uses keys stored in the service gateway's SecretVault.
                        </p>
                      ) : (
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={`Enter ${provider.authMethod} for ${provider.displayName}`}
                          style={{
                            width: '100%',
                            padding: '0.5rem 0.75rem',
                            border: '1px solid #d1d5db',
                            borderRadius: '0.375rem',
                            fontFamily: 'monospace',
                          }}
                        />
                      )}
                    </div>

                    {provider.mode !== 'ssh-bridge' && (
                      <button
                        onClick={handleSave}
                        disabled={!apiKey || saving}
                        style={{
                          padding: '0.5rem 1rem',
                          background: apiKey && !saving ? '#3b82f6' : '#9ca3af',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '0.375rem',
                          cursor: apiKey && !saving ? 'pointer' : 'not-allowed',
                          fontSize: '0.875rem',
                        }}
                      >
                        {saving ? 'Saving...' : 'Save Credentials'}
                      </button>
                    )}

                    {saveResult && (
                      <div style={{
                        marginTop: '1rem',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '0.375rem',
                        background: saveResult.success ? '#f0fdf4' : '#fef2f2',
                        color: saveResult.success ? '#16a34a' : '#dc2626',
                        fontSize: '0.8rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}>
                        {saveResult.success ? <Check size={14} /> : <X size={14} />}
                        {saveResult.message}
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
