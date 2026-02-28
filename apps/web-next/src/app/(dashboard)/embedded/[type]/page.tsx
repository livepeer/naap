'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { Coins, Vote, ExternalLink, Loader2 } from 'lucide-react';

const EMBEDDED_CONFIGS: Record<string, { title: string; description: string; icon: React.ComponentType<{ className?: string; size?: number }>; urls: { mainnet: string; testnet: string } }> = {
  treasury: {
    title: 'Treasury',
    description: 'View and manage the Livepeer protocol treasury',
    icon: Coins,
    urls: {
      mainnet: 'https://explorer.livepeer.org/treasury',
      testnet: 'https://arbiscan.io/address/0x...',
    },
  },
  governance: {
    title: 'Governance',
    description: 'Participate in protocol governance proposals and voting',
    icon: Vote,
    urls: {
      mainnet: 'https://vote.livepeer.org',
      testnet: 'https://snapshot.org/#/livepeer',
    },
  },
};

export default function EmbeddedPage() {
  const params = useParams();
  const type = params.type as string;

  const config = EMBEDDED_CONFIGS[type];

  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center mb-4">
          <ExternalLink size={24} className="text-muted-foreground" />
        </div>
        <h1 className="text-base font-semibold mb-1">Page Not Found</h1>
        <p className="text-sm text-muted-foreground">
          The embedded view &quot;{type}&quot; does not exist.
        </p>
      </div>
    );
  }

  const Icon = config.icon;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
            <Icon size={20} className="text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{config.title}</h1>
            <p className="text-[13px] text-muted-foreground">{config.description}</p>
          </div>
        </div>
        <a
          href={config.urls.mainnet}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md hover:bg-muted/80 transition-all text-xs font-medium"
        >
          Open in New Tab
          <ExternalLink size={12} />
        </a>
      </div>

      {/* Embedded Content */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="relative w-full" style={{ height: 'calc(100vh - 240px)', minHeight: '500px' }}>
          {/* Loading state */}
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10 pointer-events-none opacity-0 transition-opacity" id="embed-loading">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>

          {/* Placeholder for actual embed */}
          <div className="w-full h-full flex flex-col items-center justify-center text-center p-6 bg-muted/30">
            <Icon size={40} className="text-muted-foreground/50 mb-4" />
            <h2 className="text-sm font-semibold mb-1">{config.title} View</h2>
            <p className="text-xs text-muted-foreground mb-4 max-w-md">
              This is a placeholder for the embedded {config.title.toLowerCase()} view.
              In production, this would display the actual content from:
            </p>
            <div className="space-y-2 w-full max-w-md">
              <a
                href={config.urls.mainnet}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between w-full p-3 bg-card border border-border rounded-lg hover:border-border/80 transition-all"
              >
                <div>
                  <p className="text-sm font-medium">Mainnet</p>
                  <p className="text-xs text-muted-foreground truncate">{config.urls.mainnet}</p>
                </div>
                <ExternalLink size={14} className="text-muted-foreground" />
              </a>
              <a
                href={config.urls.testnet}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between w-full p-3 bg-card border border-border rounded-lg hover:border-border/80 transition-all"
              >
                <div>
                  <p className="text-sm font-medium">Testnet / Alternative</p>
                  <p className="text-xs text-muted-foreground truncate">{config.urls.testnet}</p>
                </div>
                <ExternalLink size={14} className="text-muted-foreground" />
              </a>
            </div>
          </div>

          {/* Uncomment below to use actual iframe embed */}
          {/* <iframe
            src={config.urls.mainnet}
            className="w-full h-full border-0"
            title={config.title}
            onLoad={() => {
              const loading = document.getElementById('embed-loading');
              if (loading) loading.style.opacity = '0';
            }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          /> */}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        <a
          href={config.urls.mainnet}
          target="_blank"
          rel="noopener noreferrer"
          className="p-3 bg-card border border-border rounded-lg hover:border-border/80 transition-all flex items-center gap-3"
        >
          <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center">
            <Icon size={16} className="text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">View on Explorer</p>
            <p className="text-xs text-muted-foreground">Open in a new tab</p>
          </div>
        </a>
        <a
          href="https://docs.livepeer.org"
          target="_blank"
          rel="noopener noreferrer"
          className="p-3 bg-card border border-border rounded-lg hover:border-border/80 transition-all flex items-center gap-3"
        >
          <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center">
            <ExternalLink size={16} className="text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">Documentation</p>
            <p className="text-xs text-muted-foreground">Learn more</p>
          </div>
        </a>
      </div>
    </div>
  );
}
