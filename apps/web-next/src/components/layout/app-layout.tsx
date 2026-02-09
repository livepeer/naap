'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';
import { useShell, useEvents } from '@/contexts/shell-context';

// Constants - must match sidebar.tsx
const SIDEBAR_DEFAULT_WIDTH = 256;
const SIDEBAR_COLLAPSED_WIDTH = 68;

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
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

  // Calculate actual width based on sidebar state
  const actualWidth = isSidebarOpen ? sidebarWidth : SIDEBAR_COLLAPSED_WIDTH;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <TopBar />
      <main
        style={{ paddingLeft: actualWidth }}
        className="pt-14 min-h-screen transition-all duration-300"
      >
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
