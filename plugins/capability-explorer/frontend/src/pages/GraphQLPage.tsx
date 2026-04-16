import React, { useState, useCallback, useRef } from 'react';
import { Play, Copy, Check, RotateCcw, ChevronDown } from 'lucide-react';
import { queryGraphQL } from '../lib/api';

const EXAMPLE_QUERIES: { label: string; query: string }[] = [
  {
    label: 'All capabilities with GPU count',
    query: `{
  capabilities(sortBy: "gpuCount", sortOrder: "desc") {
    items {
      id
      name
      category
      gpuCount
      orchestratorCount
      meanPriceUsd
      priceUnit
    }
    total
  }
}`,
  },
  {
    label: 'Live-video capabilities only',
    query: `{
  capabilities(category: "live-video", limit: 10) {
    items {
      id
      name
      gpuCount
      totalCapacity
      avgLatencyMs
      meanPriceUsd
      models {
        modelId
        warm
        gpuCount
      }
    }
    total
    hasMore
  }
}`,
  },
  {
    label: 'Network stats',
    query: `{
  stats {
    totalCapabilities
    totalModels
    totalGpus
    totalOrchestrators
    avgPriceUsd
  }
}`,
  },
  {
    label: 'Categories with counts',
    query: `{
  categories {
    id
    label
    count
    icon
  }
}`,
  },
  {
    label: 'Single capability with SDK snippets',
    query: `{
  capability(id: "streamdiffusion-sdxl") {
    id
    name
    category
    gpuCount
    orchestratorCount
    meanPriceUsd
    modelSourceUrl
    sdkSnippet {
      curl
      python
      javascript
    }
  }
}`,
  },
];

export const GraphQLPage: React.FC = () => {
  const [query, setQuery] = useState(EXAMPLE_QUERIES[0].query);
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const execute = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult('');
    setDuration(null);
    const start = performance.now();
    try {
      const data = await queryGraphQL(query.trim());
      setDuration(Math.round(performance.now() - start));
      setResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setDuration(Math.round(performance.now() - start));
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        execute();
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = textareaRef.current;
        if (ta) {
          const start = ta.selectionStart;
          const end = ta.selectionEnd;
          const val = ta.value;
          setQuery(val.substring(0, start) + '  ' + val.substring(end));
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = start + 2;
          });
        }
      }
    },
    [execute],
  );

  const copyResult = useCallback(() => {
    if (result) {
      navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [result]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-text-secondary">
            Query the Livepeer AI network using GraphQL.
            Press <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-bg-tertiary border border-[var(--border-color)] rounded">Ctrl+Enter</kbd> to run.
          </p>
        </div>

        <div className="relative">
          <button
            onClick={() => setExamplesOpen(!examplesOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-secondary hover:bg-bg-tertiary border border-[var(--border-color)] rounded-lg transition-colors"
          >
            Examples
            <ChevronDown size={12} className={`transition-transform ${examplesOpen ? 'rotate-180' : ''}`} />
          </button>
          {examplesOpen && (
            <div className="absolute right-0 top-full mt-1 w-72 bg-bg-secondary border border-[var(--border-color)] rounded-xl shadow-lg z-20 overflow-hidden">
              {EXAMPLE_QUERIES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setQuery(ex.query);
                    setExamplesOpen(false);
                    setResult('');
                    setError(null);
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors border-b border-[var(--border-color)] last:border-0"
                >
                  {ex.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Query editor */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 bg-bg-tertiary border border-[var(--border-color)] rounded-t-xl border-b-0">
            <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Query</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setQuery(EXAMPLE_QUERIES[0].query); setResult(''); setError(null); }}
                className="p-1 text-text-muted hover:text-text-primary transition-colors"
                title="Reset"
              >
                <RotateCcw size={12} />
              </button>
              <button
                onClick={execute}
                disabled={loading || !query.trim()}
                className="flex items-center gap-1.5 px-3 py-1 bg-accent-emerald/20 hover:bg-accent-emerald/30 text-accent-emerald text-xs font-medium rounded-lg border border-accent-emerald/30 transition-colors disabled:opacity-40"
              >
                <Play size={10} />
                {loading ? 'Running...' : 'Run'}
              </button>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full h-[420px] p-4 font-mono text-[13px] leading-relaxed bg-bg-secondary border border-[var(--border-color)] rounded-b-xl text-text-primary resize-none focus:outline-none focus:border-accent-emerald/50 placeholder:text-text-disabled"
            placeholder="Enter your GraphQL query..."
            spellCheck={false}
            data-testid="graphql-editor"
          />
        </div>

        {/* Results */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 bg-bg-tertiary border border-[var(--border-color)] rounded-t-xl border-b-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Result</span>
              {duration !== null && (
                <span className="text-[10px] text-text-disabled">{duration}ms</span>
              )}
            </div>
            {result && (
              <button
                onClick={copyResult}
                className="flex items-center gap-1 p-1 text-text-muted hover:text-text-primary transition-colors"
                title="Copy"
              >
                {copied ? <Check size={12} className="text-accent-emerald" /> : <Copy size={12} />}
              </button>
            )}
          </div>
          <div
            className="w-full h-[420px] p-4 font-mono text-[13px] leading-relaxed bg-bg-secondary border border-[var(--border-color)] rounded-b-xl overflow-auto"
            data-testid="graphql-result"
          >
            {loading && (
              <div className="flex items-center gap-2 text-text-muted">
                <div className="w-3 h-3 border-2 border-accent-emerald/30 border-t-accent-emerald rounded-full animate-spin" />
                Executing...
              </div>
            )}
            {error && (
              <pre className="text-accent-rose whitespace-pre-wrap">{error}</pre>
            )}
            {!loading && !error && result && (
              <pre className="text-text-primary whitespace-pre-wrap">{result}</pre>
            )}
            {!loading && !error && !result && (
              <span className="text-text-disabled">Run a query to see results here</span>
            )}
          </div>
        </div>
      </div>

      {/* Endpoint info */}
      <div className="glass-card p-4 text-xs text-text-muted space-y-1.5">
        <p className="font-medium text-text-secondary text-sm">Endpoint</p>
        <code className="block px-3 py-2 bg-bg-tertiary rounded-lg font-mono text-text-primary">
          POST /api/v1/capability-explorer/graphql
        </code>
        <p className="pt-1">
          Send <code className="px-1 py-0.5 bg-bg-tertiary rounded text-text-secondary">{'{"query": "...", "variables": {}}'}</code> as JSON body with your Bearer token.
        </p>
      </div>
    </div>
  );
};
