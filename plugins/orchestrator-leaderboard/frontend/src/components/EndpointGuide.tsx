import React, { useState } from 'react';
import { Copy, Check, ChevronDown, ChevronUp, Terminal, Link } from 'lucide-react';

interface EndpointGuideProps {
  planId: string;
  compact?: boolean;
}

function getBaseUrl() {
  return typeof window !== 'undefined' ? window.location.origin : '';
}

export const EndpointGuide: React.FC<EndpointGuideProps> = ({ planId, compact = false }) => {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(!compact);

  const baseUrl = getBaseUrl();
  const endpoint = `${baseUrl}/api/v1/orchestrator-leaderboard/plans/${planId}/results`;

  const curlExample = `curl -s "${endpoint}" \\
  -H "Authorization: Bearer <YOUR_API_KEY>" | jq .`;

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback ignored */ }
  };

  return (
    <div className={compact ? '' : 'glass-card p-4'} onClick={(e) => e.stopPropagation()}>
      {/* Endpoint URL */}
      <div className="flex items-center gap-2 mb-2">
        <Link size={12} className="text-text-muted shrink-0" />
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
          API Endpoint
        </span>
      </div>
      <div className="flex items-center gap-2 bg-bg-primary border border-[var(--border-color)] rounded-lg px-3 py-2">
        <code className="text-[11px] text-accent-emerald font-mono truncate flex-1">
          GET {compact ? `/plans/${planId.slice(0, 8)}../results` : endpoint}
        </code>
        <button
          onClick={() => copyToClipboard(endpoint)}
          className="shrink-0 p-1 rounded hover:bg-bg-tertiary transition-colors"
          title="Copy endpoint URL"
        >
          {copied ? <Check size={13} className="text-accent-emerald" /> : <Copy size={13} className="text-text-muted" />}
        </button>
      </div>

      {/* Toggle for compact mode */}
      {compact && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary mt-2 transition-colors"
        >
          <Terminal size={10} />
          Webhook Setup
          {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>
      )}

      {/* Expanded guide */}
      {expanded && (
        <div className={compact ? 'mt-2' : 'mt-4'}>
          <div className="space-y-2 text-[11px] text-text-secondary">
            <div className="flex gap-2">
              <span className="shrink-0 w-4 h-4 rounded-full bg-accent-blue/20 text-accent-blue text-[10px] font-bold flex items-center justify-center">1</span>
              <span>Copy the endpoint URL above</span>
            </div>
            <div className="flex gap-2">
              <span className="shrink-0 w-4 h-4 rounded-full bg-accent-blue/20 text-accent-blue text-[10px] font-bold flex items-center justify-center">2</span>
              <span>
                Set your signer&apos;s{' '}
                <code className="px-1 py-0.5 bg-bg-secondary rounded text-text-primary text-[10px]">ORCHESTRATOR_DISCOVERY_URL</code>
                {' '}to this endpoint
              </span>
            </div>
            <div className="flex gap-2">
              <span className="shrink-0 w-4 h-4 rounded-full bg-accent-blue/20 text-accent-blue text-[10px] font-bold flex items-center justify-center">3</span>
              <span>
                Add{' '}
                <code className="px-1 py-0.5 bg-bg-secondary rounded text-text-primary text-[10px]">Authorization: Bearer &lt;api-key&gt;</code>
                {' '}header
              </span>
            </div>
          </div>

          {/* Curl example */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-text-muted font-medium">Example</span>
              <button
                onClick={() => copyToClipboard(curlExample)}
                className="text-[10px] text-text-muted hover:text-text-primary flex items-center gap-1 transition-colors"
              >
                <Copy size={10} />
                Copy
              </button>
            </div>
            <pre className="bg-bg-primary border border-[var(--border-color)] rounded-lg p-3 text-[10px] text-text-secondary font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {curlExample}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
