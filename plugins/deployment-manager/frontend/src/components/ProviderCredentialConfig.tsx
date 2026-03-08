import React, { useState, useEffect, useRef } from 'react';
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

  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  useEffect(() => {
    if (onStatusChangeRef.current && credentialStatus) {
      onStatusChangeRef.current(credentialStatus.configured);
    }
  }, [credentialStatus?.configured]);

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
      <div className={`${compact ? 'p-3' : 'p-4'} bg-secondary rounded-lg border border-border`}>
        <div className="flex items-center gap-2 mb-2">
          <KeyRound size={14} className="text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            SSH Credentials
          </span>
        </div>
        <p className="text-xs text-muted-foreground m-0">
          SSH credentials are configured per-deployment in the deployment wizard below.
          You'll provide host, port, and username when setting up SSH Bridge deployments.
        </p>
      </div>
    );
  }

  const inputLabel = provider.authMethod === 'token' ? 'Bearer Token' : 'API Key';

  return (
    <div className={`${compact ? 'p-3' : 'p-5'} bg-secondary rounded-lg border border-border`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield size={compact ? 14 : 16} className="text-muted-foreground" />
          <span className={`${compact ? 'text-sm' : 'text-sm'} font-medium text-foreground`}>
            {compact ? 'Credentials' : `${provider.displayName} Credentials`}
          </span>
        </div>

        {/* Status badge */}
        {credentialLoading ? (
          <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-1">
            <Loader size={10} className="dm-spin" /> Checking...
          </span>
        ) : credentialStatus?.configured ? (
          <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <Check size={10} /> Configured
          </span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 flex items-center gap-1">
            <AlertTriangle size={10} /> Not Configured
          </span>
        )}
      </div>

      {/* Configured state */}
      {isConfigured && !editing && (
        <div className="mb-3">
          {credentialStatus!.secrets.map((s) => (
            <div key={s.name} className="flex items-center gap-2 px-3 py-2 mb-1.5 bg-background rounded-md border border-border">
              <KeyRound size={12} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground min-w-[4rem]">
                {secretRefs.length === 1 ? inputLabel : s.name.replace(/-/g, ' ')}
              </span>
              <code className="flex-1 text-xs font-mono text-foreground tracking-wide">
                {s.maskedValue || '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
              </code>
              <Check size={12} className="text-emerald-500" />
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setEditing(true)}
              className="h-8 px-3 bg-transparent text-muted-foreground border border-border rounded-md cursor-pointer text-xs flex items-center gap-1 hover:bg-muted transition-colors"
            >
              <Pencil size={11} /> Update Key
            </button>
            <button
              onClick={handleTest}
              disabled={testing}
              className={`h-8 px-3 bg-transparent text-foreground border border-border rounded-md text-xs flex items-center gap-1 ${
                testing ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-muted'
              } transition-colors`}
            >
              {testing ? (
                <><Loader size={11} className="dm-spin" /> Testing...</>
              ) : (
                <><Wifi size={11} /> Test Connection</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Edit mode */}
      {editing && (
        <>
          {secretRefs.map((ref) => (
            <div key={ref} className="mb-3">
              <label className="block text-xs font-medium mb-1.5 text-muted-foreground">
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
                className="w-full h-9 px-3 border border-border rounded-md font-mono text-sm text-foreground bg-background box-border"
              />
            </div>
          ))}

          <div className="flex gap-2 flex-wrap items-center">
            <button
              onClick={handleSave}
              disabled={!hasValues || saving}
              className={`h-9 px-4 border-none rounded-md text-sm font-medium flex items-center gap-1.5 ${
                hasValues && !saving
                  ? 'bg-foreground text-background cursor-pointer'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              }`}
            >
              {saving ? (
                <><Loader size={12} className="dm-spin" /> Saving...</>
              ) : (
                <><KeyRound size={12} /> Save Credentials</>
              )}
            </button>

            <button
              onClick={handleTest}
              disabled={testing}
              className={`h-9 px-4 bg-secondary text-foreground border border-border rounded-md text-sm font-medium flex items-center gap-1.5 ${
                testing ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-muted'
              } transition-colors`}
            >
              {testing ? (
                <><Loader size={12} className="dm-spin" /> Testing...</>
              ) : (
                <><Wifi size={12} /> Test Connection</>
              )}
            </button>

            {isConfigured && (
              <button
                onClick={() => { setEditing(false); setSecretValues({}); setSaveResult(null); }}
                className="h-9 px-3 bg-transparent text-muted-foreground border border-border rounded-md cursor-pointer text-sm hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </>
      )}

      {/* Results */}
      {saveResult && (
        <div className={`mt-3 px-3 py-2 rounded-md text-sm flex items-center gap-2 ${
          saveResult.success
            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
            : 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400'
        }`}>
          {saveResult.success ? <Check size={14} /> : <X size={14} />}
          {saveResult.message}
        </div>
      )}

      {testResult && (
        <div className={`mt-2 px-3 py-2 rounded-md text-sm flex items-center gap-2 ${
          testResult.success
            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
            : 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400'
        }`}>
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
      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
        ...
      </span>
    );
  }

  if (!credentialStatus) return null;

  return credentialStatus.configured ? (
    <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-0.5">
      <Check size={9} /> Ready
    </span>
  ) : (
    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 inline-flex items-center gap-0.5">
      <AlertTriangle size={9} /> No Key
    </span>
  );
};
