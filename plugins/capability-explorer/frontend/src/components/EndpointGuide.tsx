import React, { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';

interface EndpointGuideProps {
  queryId: string;
  compact?: boolean;
}

export const EndpointGuide: React.FC<EndpointGuideProps> = ({ queryId, compact }) => {
  const [copied, setCopied] = useState(false);
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const endpointUrl = `${baseUrl}/api/v1/capability-explorer/queries/${queryId}/results`;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(endpointUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <code className="text-[10px] text-text-muted font-mono truncate flex-1">{endpointUrl}</code>
        <button
          onClick={handleCopy}
          className="shrink-0 p-1 hover:bg-bg-tertiary rounded transition-colors"
          title="Copy endpoint URL"
        >
          {copied ? <Check size={12} className="text-accent-emerald" /> : <Copy size={12} className="text-text-muted" />}
        </button>
      </div>
    );
  }

  return (
    <div className="glass-card p-4 space-y-3" data-testid="endpoint-guide">
      <div className="flex items-center gap-2">
        <ExternalLink size={14} className="text-accent-emerald" />
        <h4 className="text-sm font-semibold text-text-primary">Stable API Endpoint</h4>
      </div>
      <p className="text-xs text-text-secondary">
        Use this endpoint to retrieve filtered capabilities for this query. Configure the query once, then poll this URL — no need to pass filter parameters each time.
      </p>
      <div className="flex items-center gap-2 bg-bg-tertiary rounded-lg p-3">
        <code className="text-xs font-mono text-accent-emerald flex-1 break-all">{endpointUrl}</code>
        <button
          onClick={handleCopy}
          className="shrink-0 p-1.5 hover:bg-bg-secondary rounded transition-colors"
          title="Copy endpoint URL"
        >
          {copied ? <Check size={14} className="text-accent-emerald" /> : <Copy size={14} className="text-text-muted" />}
        </button>
      </div>
      <div className="text-[11px] text-text-muted space-y-1">
        <p><strong>Method:</strong> GET</p>
        <p><strong>Auth:</strong> Bearer token (Authorization header)</p>
        <p><strong>Response:</strong> {`{ success: true, data: { items: EnrichedCapability[], total: number, hasMore: boolean } }`}</p>
      </div>
    </div>
  );
};
