/**
 * QuickStart — Code snippet tabs for consuming a published connector.
 * Shows cURL, JavaScript (fetch), and Python (requests) examples.
 */

import React, { useState } from 'react';

interface QuickStartProps {
  baseUrl: string;
  connectorSlug: string;
  endpoints: Array<{ method: string; path: string; name: string }>;
}

export const QuickStart: React.FC<QuickStartProps> = ({
  baseUrl,
  connectorSlug,
  endpoints,
}) => {
  const [tab, setTab] = useState<'curl' | 'javascript' | 'python'>('curl');
  const [copied, setCopied] = useState(false);

  const endpoint = endpoints[0];
  if (!endpoint) return null;

  const gwUrl = `${baseUrl}/api/v1/gw/${connectorSlug}${endpoint.path}`;

  const snippets = {
    curl: `curl -X ${endpoint.method} "${gwUrl}" \\
  -H "Authorization: Bearer gw_YOUR_API_KEY" \\
  -H "Content-Type: application/json"${
    endpoint.method !== 'GET'
      ? ` \\
  -d '{"query": "SELECT 1"}'`
      : ''
  }`,
    javascript: `const response = await fetch("${gwUrl}", {
  method: "${endpoint.method}",
  headers: {
    "Authorization": "Bearer gw_YOUR_API_KEY",
    "Content-Type": "application/json",
  },${
    endpoint.method !== 'GET'
      ? `
  body: JSON.stringify({ query: "SELECT 1" }),`
      : ''
  }
});

const data = await response.json();`,
    python: `import requests

response = requests.${endpoint.method.toLowerCase()}(
    "${gwUrl}",
    headers={
        "Authorization": "Bearer gw_YOUR_API_KEY",
        "Content-Type": "application/json",
    },${
      endpoint.method !== 'GET'
        ? `
    json={"query": "SELECT 1"},`
        : ''
    }
)

print(response.json())`,
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(snippets[tab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-bg-primary border border-[var(--border-color)] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-2">
        <div className="flex gap-1">
          {(['curl', 'javascript', 'python'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs font-medium rounded ${
                tab === t
                  ? 'bg-accent-emerald text-white'
                  : 'text-text-tertiary hover:text-text-primary'
              }`}
            >
              {t === 'curl' ? 'cURL' : t === 'javascript' ? 'JavaScript' : 'Python'}
            </button>
          ))}
        </div>
        <button
          onClick={handleCopy}
          className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-4 text-sm text-text-secondary overflow-x-auto">
        <code>{snippets[tab]}</code>
      </pre>
    </div>
  );
};
