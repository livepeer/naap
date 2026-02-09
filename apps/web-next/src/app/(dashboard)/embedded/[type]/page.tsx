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
        <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center mb-6">
          <ExternalLink size={40} className="text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Page Not Found</h1>
        <p className="text-muted-foreground">
          The embedded view &quot;{type}&quot; does not exist.
        </p>
      </div>
    );
  }

  const Icon = config.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Icon size={24} className="text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{config.title}</h1>
            <p className="text-muted-foreground">{config.description}</p>
          </div>
        </div>
        <a
          href={config.urls.mainnet}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 bg-muted rounded-lg hover:bg-muted/80 transition-all text-sm"
        >
          Open in New Tab
          <ExternalLink size={14} />
        </a>
      </div>

      {/* Embedded Content */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="relative w-full" style={{ height: 'calc(100vh - 240px)', minHeight: '500px' }}>
          {/* Loading state */}
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10 pointer-events-none opacity-0 transition-opacity" id="embed-loading">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>

          {/* Placeholder for actual embed */}
          <div className="w-full h-full flex flex-col items-center justify-center text-center p-8 bg-muted/30">
            <Icon size={64} className="text-muted-foreground/50 mb-6" />
            <h2 className="text-xl font-bold mb-2">{config.title} View</h2>
            <p className="text-muted-foreground mb-6 max-w-md">
              This is a placeholder for the embedded {config.title.toLowerCase()} view.
              In production, this would display the actual content from:
            </p>
            <div className="space-y-2 w-full max-w-md">
              <a
                href={config.urls.mainnet}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between w-full p-4 bg-card border border-border rounded-xl hover:border-primary/50 transition-all"
              >
                <div>
                  <p className="font-medium">Mainnet</p>
                  <p className="text-sm text-muted-foreground truncate">{config.urls.mainnet}</p>
                </div>
                <ExternalLink size={18} className="text-muted-foreground" />
              </a>
              <a
                href={config.urls.testnet}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between w-full p-4 bg-card border border-border rounded-xl hover:border-primary/50 transition-all"
              >
                <div>
                  <p className="font-medium">Testnet / Alternative</p>
                  <p className="text-sm text-muted-foreground truncate">{config.urls.testnet}</p>
                </div>
                <ExternalLink size={18} className="text-muted-foreground" />
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
      <div className="grid grid-cols-2 gap-4">
        <a
          href={config.urls.mainnet}
          target="_blank"
          rel="noopener noreferrer"
          className="p-4 bg-card border border-border rounded-xl hover:border-primary/50 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon size={20} className="text-primary" />
          </div>
          <div>
            <p className="font-medium">View on Explorer</p>
            <p className="text-sm text-muted-foreground">Open in a new tab</p>
          </div>
        </a>
        <a
          href="https://docs.livepeer.org"
          target="_blank"
          rel="noopener noreferrer"
          className="p-4 bg-card border border-border rounded-xl hover:border-primary/50 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <ExternalLink size={20} className="text-blue-500" />
          </div>
          <div>
            <p className="font-medium">Documentation</p>
            <p className="text-sm text-muted-foreground">Learn more</p>
          </div>
        </a>
      </div>
    </div>
  );
}
