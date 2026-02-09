'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, FileText, ArrowRight } from 'lucide-react';

interface SearchEntry {
  title: string;
  description: string;
  href: string;
  section: string;
}

export function DocsSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchIndex, setSearchIndex] = useState<SearchEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Load search index on mount
  useEffect(() => {
    fetch('/api/v1/docs/search-index')
      .then((res) => res.json())
      .then((data) => setSearchIndex(data))
      .catch(() => {
        // Fallback: empty search index
      });
  }, []);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  // Filter results
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const q = query.toLowerCase();
    const filtered = searchIndex.filter(
      (entry) =>
        entry.title.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.section.toLowerCase().includes(q)
    );
    setResults(filtered.slice(0, 8));
    setSelectedIndex(0);
  }, [query, searchIndex]);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      navigate(results[selectedIndex].href);
    }
  };

  return (
    <>
      {/* Search trigger */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm text-muted-foreground hover:bg-muted transition-colors"
      >
        <Search size={16} />
        <span className="flex-1 text-left">Search docs...</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted border border-border text-[10px] font-mono text-muted-foreground">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      {/* Dialog */}
      {open && (
        <div className="fixed inset-0 z-[100]">
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Dialog */}
          <div className="relative max-w-lg w-full mx-auto mt-[15vh] bg-background border border-border rounded-xl shadow-2xl overflow-hidden">
            {/* Input */}
            <div className="flex items-center gap-3 px-4 border-b border-border">
              <Search size={18} className="text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search documentation..."
                className="flex-1 py-4 bg-transparent text-foreground placeholder:text-muted-foreground outline-none text-sm"
              />
              <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px] font-mono text-muted-foreground">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {query && results.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No results found for &ldquo;{query}&rdquo;
                </p>
              )}
              {results.map((result, i) => (
                <button
                  key={result.href}
                  onClick={() => navigate(result.href)}
                  className={`flex items-start gap-3 w-full px-3 py-3 rounded-lg text-left transition-colors ${
                    i === selectedIndex
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <FileText size={16} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">{result.title}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {result.section} &middot; {result.description}
                    </div>
                  </div>
                  <ArrowRight size={14} className="mt-1 shrink-0 opacity-50" />
                </button>
              ))}
              {!query && (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Type to search the documentation...
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
