'use client';

import Link from 'next/link';
import { Moon, Sun, Menu, X, ArrowLeft } from 'lucide-react';
import { useState, useEffect } from 'react';
import { DocsSearch } from './docs-search';

interface DocsHeaderProps {
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
}

export function DocsHeader({ onToggleSidebar, isSidebarOpen }: DocsHeaderProps) {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const saved = localStorage.getItem('naap_theme');
    const isDark = saved === 'dark' || (!saved && document.documentElement.classList.contains('dark'));
    setTheme(isDark ? 'dark' : 'light');
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem('naap_theme', next);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="flex h-14 items-center px-4 lg:px-6">
        {/* Mobile sidebar toggle */}
        <button
          onClick={onToggleSidebar}
          className="mr-3 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all lg:hidden"
          aria-label="Toggle navigation"
        >
          {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        {/* Logo */}
        <Link href="/docs" className="flex items-center gap-2.5 mr-6 shrink-0">
          <div className="w-8 h-8 bg-gradient-to-br from-primary to-primary/70 rounded-lg flex items-center justify-center text-primary-foreground font-bold shadow-lg shadow-primary/20">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
              <path d="M4 8h2v2H4V8zm4 4h2v2H8v-2zm4 4h2v2h-2v-2zm-8 4h2v2H4v-2zm12-8h2v2h-2v-2zm4 4h2v2h-2v-2z" />
            </svg>
          </div>
          <span className="font-bold text-lg tracking-tight text-foreground">
            NaaP <span className="text-muted-foreground font-normal text-sm">Docs</span>
          </span>
        </Link>

        {/* Search */}
        <div className="flex-1 max-w-md hidden sm:block">
          <DocsSearch />
        </div>

        {/* Right side */}
        <div className="ml-auto flex items-center gap-2">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Back to app */}
          <Link
            href="/dashboard"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <ArrowLeft size={14} />
            Back to App
          </Link>

          {/* GitHub - optional */}
          <a
            href="https://github.com/livepeer/naap"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            aria-label="GitHub"
          >
            <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
          </a>
        </div>
      </div>

      {/* Mobile search */}
      <div className="px-4 pb-3 sm:hidden">
        <DocsSearch />
      </div>
    </header>
  );
}
