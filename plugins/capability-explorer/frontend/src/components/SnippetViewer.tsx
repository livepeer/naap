import React, { useState, useCallback } from 'react';
import type { SdkSnippet } from '../lib/types';
import { Copy, Check } from 'lucide-react';

interface SnippetViewerProps {
  snippet: SdkSnippet;
}

type Tab = 'curl' | 'python' | 'javascript';

const TABS: { id: Tab; label: string }[] = [
  { id: 'curl', label: 'cURL' },
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
];

export const SnippetViewer: React.FC<SnippetViewerProps> = ({ snippet }) => {
  const [activeTab, setActiveTab] = useState<Tab>('curl');
  const [copied, setCopied] = useState(false);

  const code = snippet[activeTab];

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }, [code]);

  return (
    <div className="rounded-lg border border-[var(--border-color)] overflow-hidden" data-testid="snippet-viewer">
      <div className="flex items-center justify-between bg-bg-tertiary border-b border-[var(--border-color)] px-1">
        <div className="flex">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-accent-emerald border-b-2 border-accent-emerald'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
              data-testid={`snippet-tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleCopy}
          className="p-1.5 mr-1 rounded text-text-muted hover:text-text-primary transition-colors"
          title="Copy to clipboard"
          data-testid="copy-btn"
        >
          {copied ? <Check size={14} className="text-accent-emerald" /> : <Copy size={14} />}
        </button>
      </div>
      <pre className="p-4 text-xs font-mono text-text-primary bg-bg-primary overflow-x-auto whitespace-pre-wrap">
        {code}
      </pre>
    </div>
  );
};
