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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
      {providers.map((p) => (
        <button
          key={p.slug}
          onClick={() => onSelect(p.slug)}
          className={`p-4 rounded-lg text-foreground cursor-pointer text-left transition-all ${
            selected === p.slug
              ? 'border-2 border-foreground bg-secondary'
              : 'border border-border bg-card hover:border-muted-foreground/30'
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xl">{p.icon}</span>
            <span className="font-medium text-sm text-foreground flex-1">{p.displayName}</span>
          </div>
          <p className="text-xs text-muted-foreground m-0">{p.description}</p>
          <div className="mt-2.5 flex gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded ${
              p.mode === 'serverless'
                ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'
                : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
            }`}>
              {p.mode === 'serverless' ? 'Serverless' : 'SSH Bridge'}
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground">
              {p.authMethod}
            </span>
            {p.mode !== 'ssh-bridge' && <CredentialStatusBadge providerSlug={p.slug} />}
          </div>
        </button>
      ))}
    </div>
  );
};
