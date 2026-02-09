'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useShell, useEvents } from '@/contexts/shell-context';
import { Bell, Search, Command } from 'lucide-react';
import { TeamSwitcher } from './team-switcher';

// Constants - must match sidebar.tsx
const SIDEBAR_DEFAULT_WIDTH = 256;
const SIDEBAR_COLLAPSED_WIDTH = 68;

/**
 * LiveClock - Stable clock that doesn't disappear during navigation
 * Uses useMemo for initial state to avoid hydration mismatch
 */
function LiveClock() {
  // Use a ref for the actual time to avoid hydration issues
  // Initialize with a placeholder that matches server render
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Mark as mounted (client-side only)
    setMounted(true);
    setNow(new Date());

    // Update every second
    intervalRef.current = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Format date and time
  const { date, time } = useMemo(() => {
    return {
      date: now.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
      time: now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }),
    };
  }, [now]);

  // Don't show anything until mounted to prevent hydration mismatch
  // But keep the space reserved with skeleton
  if (!mounted) {
    return (
      <div className="hidden lg:flex items-center gap-3 px-4 py-2 rounded-xl bg-muted/30 border border-border/50 min-w-[140px]">
        <div className="w-full h-8 bg-muted/50 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="hidden lg:flex items-center gap-3 px-4 py-2 rounded-xl bg-muted/30 border border-border/50 select-none transition-all hover:bg-muted/50">
      <div className="flex flex-col items-end">
        <span className="text-xs text-muted-foreground leading-none">{date}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground leading-tight mt-0.5">
          {time}
        </span>
      </div>
    </div>
  );
}

/**
 * SearchTrigger - Minimal search button that opens command palette
 */
function SearchTrigger() {
  return (
    <button
      className="hidden md:flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/30 border border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-all group"
      title="Search (⌘K)"
    >
      <Search size={16} className="shrink-0" />
      <span className="text-sm">Search...</span>
      <kbd className="hidden lg:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-background border border-border rounded opacity-60 group-hover:opacity-100 transition-opacity">
        <Command size={10} />K
      </kbd>
    </button>
  );
}

export function TopBar() {
  const { user } = useAuth();
  const { isSidebarOpen } = useShell();
  const eventBus = useEvents();

  // Track sidebar width (syncs with sidebar resize via event bus)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
    const saved = localStorage.getItem('naap_sidebar_width');
    return saved ? parseInt(saved, 10) : SIDEBAR_DEFAULT_WIDTH;
  });

  // Handle resize events from sidebar
  const handleResize = useCallback((data: { width: number }) => {
    setSidebarWidth(data.width);
  }, []);

  // Listen for sidebar width changes via event bus
  useEffect(() => {
    const unsubscribe = eventBus.on('shell:sidebar:resize', handleResize);
    return unsubscribe;
  }, [eventBus, handleResize]);

  // Also sync on initial mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('naap_sidebar_width');
    if (saved) {
      setSidebarWidth(parseInt(saved, 10));
    }
  }, []);

  // Calculate the left position based on sidebar state
  const actualWidth = isSidebarOpen ? sidebarWidth : SIDEBAR_COLLAPSED_WIDTH;

  return (
    <header
      style={{ left: actualWidth }}
      className="fixed top-0 right-0 z-30 h-14 transition-all duration-300"
    >
      {/* Glassmorphism background */}
      <div className="absolute inset-0 bg-background/70 backdrop-blur-xl border-b border-border/50" />

      {/* Content */}
      <div className="relative flex h-full items-center justify-between px-4 gap-4">
        {/* Left side - Search */}
        <div className="flex items-center gap-3">
          <SearchTrigger />
        </div>

        {/* Right side - clock, team switcher, notifications & user */}
        <div className="flex items-center gap-2">
          {/* Live Date & Time - Fixed to not disappear */}
          <LiveClock />

          {/* Divider */}
          <div className="hidden md:block w-px h-6 bg-border/50" />

          {/* Team/Personal Workspace Switcher */}
          <TeamSwitcher />

          {/* Notifications */}
          <button
            className="relative p-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
            aria-label="Notifications"
          >
            <Bell size={18} />
            <span className="absolute top-2 right-2 h-2 w-2 bg-primary rounded-full ring-2 ring-background" />
          </button>

          {/* User Avatar */}
          <button className="flex items-center gap-2.5 p-1.5 pr-3 rounded-xl hover:bg-muted/50 transition-all group">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center shadow-sm shadow-primary/20">
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.displayName || 'User'}
                  className="h-8 w-8 rounded-lg object-cover"
                />
              ) : (
                <span className="text-xs font-bold text-primary-foreground">
                  {(user?.displayName || user?.email || 'U')[0].toUpperCase()}
                </span>
              )}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-medium leading-tight text-foreground group-hover:text-foreground transition-colors">
                {user?.displayName || 'User'}
              </p>
              <p className="text-[11px] text-muted-foreground leading-tight">
                {user?.email?.split('@')[0] || user?.address?.slice(0, 8) + '...'}
              </p>
            </div>
          </button>
        </div>
      </div>
    </header>
  );
}
