import React, { useState } from 'react';
import { Settings } from 'lucide-react';
import { useProviders } from '../hooks/useProviders';
import { ProviderCredentialConfig, CredentialStatusBadge } from '../components/ProviderCredentialConfig';

export const ProviderSettings: React.FC = () => {
  const { providers, loading } = useProviders();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const selectedProvider = providers.find((p) => p.slug === selectedSlug);

  return (
    <div className="px-6 py-5 max-w-[960px] mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <Settings size={20} className="text-foreground" />
        <h1 className="text-xl font-semibold text-foreground m-0 tracking-tight">Provider Settings</h1>
      </div>

      <p className="text-muted-foreground mb-6 text-sm">
        Configure API keys and credentials for each GPU provider. Use <strong className="text-foreground">Test Connection</strong> to verify before deploying.
      </p>

      {loading && <p className="text-muted-foreground text-sm">Loading providers...</p>}

      <div className="grid grid-cols-[260px_1fr] gap-5">
        {/* Provider list */}
        <div className="flex flex-col gap-1.5">
          {providers.map((p) => (
            <button
              key={p.slug}
              onClick={() => setSelectedSlug(p.slug)}
              className={`px-3 py-2.5 rounded-md cursor-pointer text-left flex items-center gap-3 transition-all ${
                selectedSlug === p.slug
                  ? 'bg-secondary border-l-2 border-foreground text-foreground'
                  : 'bg-transparent border-l-2 border-transparent text-foreground hover:bg-muted/50'
              }`}
            >
              <span className="text-lg">{p.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{p.displayName}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
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
            <div className="py-12 text-center text-muted-foreground border border-dashed border-border rounded-lg">
              <Settings size={32} className="mb-3 opacity-20 mx-auto" />
              <p className="text-sm m-0">Select a provider to configure credentials</p>
            </div>
          ) : (
            <ProviderCredentialConfig provider={selectedProvider} />
          )}
        </div>
      </div>
    </div>
  );
};
