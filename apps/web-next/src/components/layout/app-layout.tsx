'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';
import { useShell, useEvents } from '@/contexts/shell-context';

// Constants — must match sidebar.tsx
const SIDEBAR_DEFAULT_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 52;

interface AppLayoutProps {
  children: React.ReactNode;
}

/**
 * AppLayout — Linear-inspired shell.
 *
 * Structure:
 *   ┌─────────┬──────────────────────────────┐
 *   │         │  ┌────────────────────────┐   │
 *   │ Sidebar │  │ TopBar                 │   │
 *   │ (frame) │  │────────────────────────│   │
 *   │         │  │ Content (scrollable)   │   │
 *   │         │  └────────────────────────┘   │
 *   └─────────┴──────────────────────────────┘
 *
 * The sidebar sits at the frame level (bg-background).
 * The content panel floats as a rounded card (bg-card) with
 * a small gap exposing the dark frame beneath.
 */
export function AppLayout({ children }: AppLayoutProps) {
  const { isSidebarOpen } = useShell();
  const eventBus = useEvents();

  // Track sidebar width (syncs with sidebar resize via event bus)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
    const saved = localStorage.getItem('naap_sidebar_width');
    return saved ? parseInt(saved, 10) : SIDEBAR_DEFAULT_WIDTH;
  });

  const handleResize = useCallback((data: { width: number }) => {
    setSidebarWidth(data.width);
  }, []);

  useEffect(() => {
    const unsubscribe = eventBus.on('shell:sidebar:resize', handleResize);
    return unsubscribe;
  }, [eventBus, handleResize]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('naap_sidebar_width');
    if (saved) setSidebarWidth(parseInt(saved, 10));
  }, []);

  const actualWidth = isSidebarOpen ? sidebarWidth : SIDEBAR_COLLAPSED_WIDTH;

  return (
    <div className="h-screen bg-background overflow-hidden">
      {/* Sidebar — fixed, frame level */}
      <Sidebar />

      {/* Content region — offset by sidebar, with gap for the dark frame */}
      <div
        style={{ paddingLeft: actualWidth }}
        className="h-screen pt-2 pr-2 pb-2 transition-all duration-200"
      >
        {/* Floating content panel */}
        <div className="h-full flex flex-col rounded-lg overflow-hidden bg-card border border-border/60">
          <TopBar />
          <main className="flex-1 overflow-y-auto">
            <div className="px-5 py-4">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
