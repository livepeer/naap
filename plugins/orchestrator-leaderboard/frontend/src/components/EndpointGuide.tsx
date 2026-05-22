import React, { useState } from 'react';
import { Copy, Check, Link } from 'lucide-react';
import { SectionLabel } from './SectionLabel';

interface EndpointGuideProps {
  planId: string;
}

function getBaseUrl() {
  return typeof window !== 'undefined' ? window.location.origin : '';
}

export const EndpointGuide: React.FC<EndpointGuideProps> = ({ planId }) => {
  const [copied, setCopied] = useState(false);

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
    <div onClick={(e) => e.stopPropagation()}>
      <SectionLabel icon={Link} className="mb-2">
        API Endpoint
      </SectionLabel>
      <div className="flex items-start gap-2 bg-bg-primary border border-[var(--border-color)] rounded-lg px-3 py-2">
        <pre className="text-[11px] text-accent-emerald font-mono flex-1 overflow-x-auto whitespace-pre-wrap break-all">
          {curlExample}
        </pre>
        <button
          onClick={() => copyToClipboard(curlExample)}
          className="shrink-0 p-1 rounded hover:bg-bg-tertiary transition-colors"
          title="Copy curl command"
        >
          {copied ? <Check size={13} className="text-accent-emerald" /> : <Copy size={13} className="text-text-muted" />}
        </button>
      </div>
    </div>
  );
};
