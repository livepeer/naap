import React, { useState, useEffect } from 'react';
import { Shield, Check, X, Wifi, Loader, AlertTriangle, KeyRound, Pencil } from 'lucide-react';
import {
  useCredentialStatus,
  saveCredentials,
  testProviderConnection,
  type Provider,
} from '../hooks/useProviders';

interface ProviderCredentialConfigProps {
  provider: Provider;
  compact?: boolean;
  onStatusChange?: (configured: boolean) => void;
}

export const ProviderCredentialConfig: React.FC<ProviderCredentialConfigProps> = ({
  provider,
  compact = false,
  onStatusChange,
}) => {
  const { credentialStatus, credentialLoading, refreshCredentials } = useCredentialStatus(provider.slug);
  const secretRefs = provider.secretNames || ['api-key'];

  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; latencyMs?: number; error?: string } | null>(null);

  const isConfigured = credentialStatus?.configured ?? false;

  useEffect(() => {
    if (onStatusChange && credentialStatus) {
      onStatusChange(credentialStatus.configured);
    }
  }, [credentialStatus?.configured, onStatusChange]);

  // Auto-show edit form when no credentials exist
  useEffect(() => {
    if (!credentialLoading && !isConfigured) {
      setEditing(true);
    }
  }, [credentialLoading, isConfigured]);

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    setTestResult(null);
    const result = await saveCredentials(provider.slug, secretValues);
    setSaveResult(result);
    if (result.success) {
      setSecretValues({});
      setEditing(false);
      await refreshCredentials();
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await testProviderConnection(provider.slug);
    setTestResult(result);
    setTesting(false);
  };

  const hasValues = Object.values(secretValues).some((v) => v.trim());

  if (provider.mode === 'ssh-bridge') {
    return (
      <div style={{
        padding: compact ? '0.75rem' : '1rem',
        background: 'var(--dm-bg-secondary)',
        borderRadius: '0.5rem',
        border: '1px solid var(--dm-border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <KeyRound size={16} color="var(--dm-accent-blue)" />
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--dm-text-primary)' }}>
            SSH Credentials
          </span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--dm-text-secondary)', margin: 0 }}>
          SSH credentials are configured per-deployment in the deployment wizard below.
          You'll provide host, port, and username when setting up SSH Bridge deployments.
        </p>
      </div>
    );
  }

  const inputLabel = provider.authMethod === 'token' ? 'Bearer Token' : 'API Key';

  return (
    <div style={{
      padding: compact ? '0.75rem' : '1.25rem',
      background: 'var(--dm-bg-secondary)',
      borderRadius: '0.75rem',
      border: '1px solid var(--dm-border)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Shield size={compact ? 16 : 18} color="var(--dm-accent-blue)" />
          <span style={{
            fontSize: compact ? '0.875rem' : '1rem',
            fontWeight: 600,
            color: 'var(--dm-text-primary)',
          }}>
            {compact ? 'Credentials' : `${provider.displayName} Credentials`}
          </span>
        </div>

        {/* Status badge */}
        {credentialLoading ? (
          <span style={{
            fontSize: '0.7rem',
            padding: '0.2rem 0.5rem',
            borderRadius: '1rem',
            background: 'var(--dm-bg-tertiary)',
            color: 'var(--dm-text-tertiary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}>
            <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} /> Checking...
          </span>
        ) : credentialStatus?.configured ? (
          <span style={{
            fontSize: '0.7rem',
            padding: '0.2rem 0.5rem',
            borderRadius: '1rem',
            background: '#dcfce7',
            color: '#166534',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}>
            <Check size={10} /> Configured
          </span>
        ) : (
          <span style={{
            fontSize: '0.7rem',
            padding: '0.2rem 0.5rem',
            borderRadius: '1rem',
            background: '#fef3c7',
            color: '#92400e',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}>
            <AlertTriangle size={10} /> Not Configured
          </span>
        )}
      </div>

      {/* Configured state — show masked keys */}
      {isConfigured && !editing && (
        <div style={{ marginBottom: '0.75rem' }}>
          {credentialStatus!.secrets.map((s) => (
            <div key={s.name} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.5rem 0.75rem', marginBottom: '0.35rem',
              background: 'var(--dm-bg-tertiary)', borderRadius: '0.375rem',
              border: '1px solid var(--dm-border)',
            }}>
              <KeyRound size={14} color="var(--dm-accent-blue)" />
              <span style={{ fontSize: '0.8rem', color: 'var(--dm-text-secondary)', minWidth: '4rem' }}>
                {secretRefs.length === 1 ? inputLabel : s.name.replace(/-/g, ' ')}
              </span>
              <code style={{
                flex: 1, fontSize: '0.82rem', fontFamily: 'monospace',
                color: 'var(--dm-text-primary)', letterSpacing: '0.02em',
              }}>
                {s.maskedValue || '••••••••'}
              </code>
              <Check size={14} color="#16a34a" />
            </div>
          ))}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              onClick={() => setEditing(true)}
              style={{
                padding: '0.35rem 0.75rem', background: 'transparent',
                color: 'var(--dm-text-secondary)', border: '1px solid var(--dm-border)',
                borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.78rem',
                display: 'flex', alignItems: 'center', gap: '0.3rem',
              }}
            >
              <Pencil size={11} /> Update Key
            </button>
            <button
              onClick={handleTest}
              disabled={testing}
              style={{
                padding: '0.35rem 0.75rem', background: 'transparent',
                color: 'var(--dm-accent-blue-text)', border: '1px solid var(--dm-accent-blue)',
                borderRadius: '0.375rem', cursor: testing ? 'not-allowed' : 'pointer',
                fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.3rem',
              }}
            >
              {testing ? (
                <><Loader size={11} style={{ animation: 'spin 1s linear infinite' }} /> Testing...</>
              ) : (
                <><Wifi size={11} /> Test Connection</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Edit mode — input fields */}
      {editing && (
        <>
          {secretRefs.map((ref) => (
            <div key={ref} style={{ marginBottom: '0.75rem' }}>
              <label style={{
                display: 'block', fontSize: '0.8rem', fontWeight: 500,
                marginBottom: '0.25rem', color: 'var(--dm-text-secondary)',
              }}>
                {secretRefs.length === 1
                  ? inputLabel
                  : `${ref.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`}
              </label>
              <input
                type="password"
                value={secretValues[ref] || ''}
                onChange={(e) => setSecretValues((prev) => ({ ...prev, [ref]: e.target.value }))}
                placeholder={
                  isConfigured
                    ? `Enter new ${inputLabel} to update`
                    : `Enter ${inputLabel} for ${provider.displayName}`
                }
                style={{
                  width: '100%', padding: '0.5rem 0.75rem',
                  border: '1px solid var(--dm-border-input)', borderRadius: '0.375rem',
                  fontFamily: 'monospace', fontSize: '0.85rem',
                  color: 'var(--dm-text-primary)', backgroundColor: 'var(--dm-bg-input)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          ))}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={handleSave}
              disabled={!hasValues || saving}
              style={{
                padding: '0.45rem 1rem',
                background: hasValues && !saving ? 'var(--dm-accent-blue)' : 'var(--dm-bg-tertiary)',
                color: hasValues && !saving ? '#fff' : 'var(--dm-text-tertiary)',
                border: 'none', borderRadius: '0.375rem',
                cursor: hasValues && !saving ? 'pointer' : 'not-allowed',
                fontSize: '0.8rem', fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: '0.35rem',
              }}
            >
              {saving ? (
                <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</>
              ) : (
                <><KeyRound size={12} /> Save Credentials</>
              )}
            </button>

            <button
              onClick={handleTest}
              disabled={testing}
              style={{
                padding: '0.45rem 1rem', background: 'transparent',
                color: 'var(--dm-accent-blue-text)', border: '1px solid var(--dm-accent-blue)',
                borderRadius: '0.375rem', cursor: testing ? 'not-allowed' : 'pointer',
                fontSize: '0.8rem', fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: '0.35rem',
              }}
            >
              {testing ? (
                <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> Testing...</>
              ) : (
                <><Wifi size={12} /> Test Connection</>
              )}
            </button>

            {isConfigured && (
              <button
                onClick={() => { setEditing(false); setSecretValues({}); setSaveResult(null); }}
                style={{
                  padding: '0.45rem 0.75rem', background: 'transparent',
                  color: 'var(--dm-text-secondary)', border: '1px solid var(--dm-border)',
                  borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.8rem',
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </>
      )}

      {/* Results */}
      {saveResult && (
        <div style={{
          marginTop: '0.75rem',
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

      {testResult && (
        <div style={{
          marginTop: '0.5rem',
          padding: '0.5rem 0.75rem',
          borderRadius: '0.375rem',
          background: testResult.success ? '#f0fdf4' : '#fef2f2',
          color: testResult.success ? '#16a34a' : '#dc2626',
          fontSize: '0.8rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}>
          {testResult.success ? <Wifi size={14} /> : <X size={14} />}
          {testResult.success
            ? `Connection successful${testResult.latencyMs ? ` (${testResult.latencyMs}ms)` : ''}`
            : `Connection failed: ${testResult.error || 'Unknown error'}`}
        </div>
      )}
    </div>
  );
};

export const CredentialStatusBadge: React.FC<{ providerSlug: string }> = ({ providerSlug }) => {
  const { credentialStatus, credentialLoading } = useCredentialStatus(providerSlug);

  if (credentialLoading) {
    return (
      <span style={{
        fontSize: '0.65rem',
        padding: '0.1rem 0.4rem',
        borderRadius: '1rem',
        background: 'var(--dm-bg-tertiary)',
        color: 'var(--dm-text-tertiary)',
      }}>
        ...
      </span>
    );
  }

  if (!credentialStatus) return null;

  return credentialStatus.configured ? (
    <span style={{
      fontSize: '0.65rem',
      padding: '0.1rem 0.4rem',
      borderRadius: '1rem',
      background: '#dcfce7',
      color: '#166534',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.2rem',
    }}>
      <Check size={8} /> Ready
    </span>
  ) : (
    <span style={{
      fontSize: '0.65rem',
      padding: '0.1rem 0.4rem',
      borderRadius: '1rem',
      background: '#fef3c7',
      color: '#92400e',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.2rem',
    }}>
      <AlertTriangle size={8} /> No Key
    </span>
  );
};
