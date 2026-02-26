'use client';

import { usePathname } from 'next/navigation';
import { Bell, Search } from 'lucide-react';

/**
 * Derive a human-readable view title from the current pathname.
 * Falls back to a cleaned-up version of the last path segment.
 */
function useViewTitle(): string {
  const pathname = usePathname();

  const titles: Record<string, string> = {
    '/': 'Overview',
    '/dashboard': 'Overview',
    '/settings': 'Settings',
    '/teams': 'Teams',
    '/marketplace': 'Marketplace',
    '/feedback': 'Feedback',
    '/docs': 'Documentation',
    '/admin/users': 'Admin',
  };

  if (titles[pathname]) return titles[pathname];

  // Plugin / dynamic routes — use the last meaningful segment
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || 'Overview';
  return last
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * TopBar — sits inside the content panel (not fixed).
 * Shows the current view title on the left (Linear-style)
 * and minimal contextual actions on the right.
 */
export function TopBar() {
  const title = useViewTitle();

  return (
    <div className="shrink-0 h-12 border-b border-border/40">
      <div className="flex h-full items-center justify-between px-4 gap-4">
        {/* Left side — view title */}
        <h1 className="text-[13px] font-semibold text-foreground truncate">
          {title}
        </h1>

        {/* Right side — contextual actions */}
        <div className="flex items-center gap-1">
          {/* Search (opens command palette) */}
          <button
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors duration-100"
            aria-label="Search (⌘K)"
            title="Search (⌘K)"
          >
            <Search size={16} />
          </button>

          {/* Notifications */}
          <button
            className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors duration-100"
            aria-label="Notifications"
          >
            <Bell size={16} />
            <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 bg-primary rounded-full" />
          </button>
        </div>
      </div>
    </div>
  );
}
