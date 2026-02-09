'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useShell, useEvents } from '@/contexts/shell-context';
import { usePlugins, type PluginManifest } from '@/contexts/plugin-context';
import {
  Activity,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Shield,
  LogOut,
  Moon,
  Sun,
  Users,
  ShoppingBag,
  MessageSquare,
  Box,
  MoreHorizontal,
  BookOpen,
  GripVertical,
  // Plugin icons - referenced by name in plugin.json manifests
  Wallet,
  Radio,
  BarChart3,
  Video,
  Upload,
  Code,
  Cpu,
  Zap,
  LayoutDashboard,
  Globe,
  Package,
  Puzzle,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
}

/** Normalize plugin name for deduplication (my-wallet == myWallet == mywallet) */
function normalizePluginName(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, '');
}

function getPluginNavSection(plugin: PluginManifest): 'main' | 'network' {
  const metadata = plugin.metadata as Record<string, unknown> | undefined;
  if (metadata?.navigation && typeof metadata.navigation === 'object') {
    const nav = metadata.navigation as { section?: string };
    if (nav.section === 'network') return 'network';
    if (nav.section === 'main') return 'main';
  }

  const category = (metadata?.category as string) || '';
  if (['networking', 'infrastructure', 'communication'].includes(category)) {
    return 'network';
  }

  return 'main';
}

/**
 * Map of icon names to Lucide components.
 * Add entries here when new plugins define icons in their plugin.json.
 * This avoids importing the entire lucide-react library (tree-shaking safe).
 */
const ICON_MAP: Record<string, LucideIcon> = {
  Activity,
  BarChart3,
  Box,
  Code,
  Cpu,
  Globe,
  LayoutDashboard,
  Package,
  Puzzle,
  Radio,
  ShoppingBag,
  Upload,
  Users,
  Video,
  Wallet,
  Zap,
};

/**
 * Resolves a Lucide icon by name from the plugin manifest.
 * Falls back to Box if the icon name is not in the map.
 */
function resolveIcon(iconName?: string): LucideIcon {
  if (!iconName) return Box;
  return ICON_MAP[iconName] || Box;
}

// Sidebar width constants
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_DEFAULT_WIDTH = 256;
const SIDEBAR_COLLAPSED_WIDTH = 68;

export function Sidebar() {
  const pathname = usePathname();
  const { hasRole, logout } = useAuth();
  const { isSidebarOpen, toggleSidebar, theme } = useShell();
  const { plugins, isLoading, version, refreshPlugins } = usePlugins();
  const eventBus = useEvents();

  const isAdmin = hasRole('system:admin');

  // Sidebar width for resizing
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
    const saved = localStorage.getItem('naap_sidebar_width');
    return saved ? parseInt(saved, 10) : SIDEBAR_DEFAULT_WIDTH;
  });

  // Resizing state
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const newWidth = Math.min(
        Math.max(e.clientX, SIDEBAR_MIN_WIDTH),
        SIDEBAR_MAX_WIDTH
      );
      setSidebarWidth(newWidth);
      // Emit event during drag for smooth updates
      eventBus.emit('shell:sidebar:resize', { width: newWidth });
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        localStorage.setItem('naap_sidebar_width', sidebarWidth.toString());
        // Emit event for other components to update
        eventBus.emit('shell:sidebar:resize', { width: sidebarWidth });
      }
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, sidebarWidth, eventBus]);

  // Listen for plugin preference changes to refresh the sidebar
  useEffect(() => {
    const unsubscribePlugin = eventBus.on('plugin:preferences:changed', () => {
      refreshPlugins();
    });
    const unsubscribeTeam = eventBus.on('team:change', () => {
      refreshPlugins();
    });
    return () => {
      unsubscribePlugin();
      unsubscribeTeam();
    };
  }, [eventBus, refreshPlugins]);

  // Collapsible section states - persist to localStorage
  const [mainExpanded, setMainExpanded] = useState(true);
  const [networkExpanded, setNetworkExpanded] = useState(true);
  const [moreExpanded, setMoreExpanded] = useState(false);

  // Load collapsed states from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('naap_sidebar_sections');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setMainExpanded(parsed.main ?? true);
          setNetworkExpanded(parsed.network ?? true);
          setMoreExpanded(parsed.more ?? false);
        } catch {}
      }
    }
  }, []);

  // Save collapsed states
  const saveSectionState = (section: string, expanded: boolean) => {
    if (typeof window !== 'undefined') {
      const current = localStorage.getItem('naap_sidebar_sections');
      const parsed = current ? JSON.parse(current) : {};
      parsed[section] = expanded;
      localStorage.setItem('naap_sidebar_sections', JSON.stringify(parsed));
    }
  };

  const toggleMainExpanded = () => {
    const next = !mainExpanded;
    setMainExpanded(next);
    saveSectionState('main', next);
  };

  const toggleNetworkExpanded = () => {
    const next = !networkExpanded;
    setNetworkExpanded(next);
    saveSectionState('network', next);
  };

  const toggleMoreExpanded = () => {
    const next = !moreExpanded;
    setMoreExpanded(next);
    saveSectionState('more', next);
  };

  // Memoize plugin lists
  const { mainPlugins, networkPlugins } = useMemo(() => {
    const seenPlugins = new Set<string>();
    const uniquePlugins = (plugins || []).filter(p => {
      if (!p?.enabled) return false;
      const normalized = normalizePluginName(p.name);
      if (seenPlugins.has(normalized)) return false;
      seenPlugins.add(normalized);
      return true;
    });

    const main = uniquePlugins
      .filter(p => getPluginNavSection(p) === 'main')
      .sort((a, b) => a.order - b.order)
      .map(plugin => ({
        name: plugin.displayName,
        href: plugin.routes?.[0]?.replace('/*', '') || `/plugins/${plugin.name}`,
        icon: resolveIcon(plugin.icon),
      }));

    const network = uniquePlugins
      .filter(p => getPluginNavSection(p) === 'network')
      .sort((a, b) => a.order - b.order)
      .map(plugin => ({
        name: plugin.displayName,
        href: plugin.routes?.[0]?.replace('/*', '') || `/plugins/${plugin.name}`,
        icon: resolveIcon(plugin.icon),
      }));

    return { mainPlugins: main, networkPlugins: network };
  }, [plugins, version]);

  // Static network items are loaded from shell config rather than hardcoded.
  // To add items, register them via shell configuration or create plugins.
  const staticNetworkItems: NavItem[] = [];

  // Routes that should use exact matching only
  const exactMatchRoutes = new Set([
    '/dashboard',
    '/settings',
    '/teams',
    '/marketplace',
    '/feedback',
    '/releases',
    '/treasury',
    '/governance',
  ]);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';

    if (exactMatchRoutes.has(href)) {
      return pathname === href;
    }

    return pathname === href || pathname.startsWith(href + '/');
  };

  // Calculate actual width
  const actualWidth = isSidebarOpen ? sidebarWidth : SIDEBAR_COLLAPSED_WIDTH;

  return (
    <aside
      ref={sidebarRef}
      style={{ width: actualWidth }}
      className={`fixed left-0 top-0 z-40 h-screen bg-card/95 backdrop-blur-sm border-r border-border/50 transition-all duration-300 flex flex-col ${
        isResizing ? 'select-none' : ''
      }`}
    >
      {/* Logo - Fixed */}
      <div className="flex h-14 items-center justify-between px-3 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 flex-shrink-0 bg-gradient-to-br from-primary to-primary/70 rounded-xl flex items-center justify-center text-primary-foreground font-bold shadow-lg shadow-primary/20">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
              <path d="M4 8h2v2H4V8zm4 4h2v2H8v-2zm4 4h2v2h-2v-2zm-8 4h2v2H4v-2zm12-8h2v2h-2v-2zm4 4h2v2h-2v-2z" />
            </svg>
          </div>
          {isSidebarOpen && (
            <span className="font-bold text-lg tracking-tight text-foreground truncate">
              NaaP
            </span>
          )}
        </div>
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all shrink-0"
          title={isSidebarOpen ? 'Collapse' : 'Expand'}
        >
          {isSidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {/* Scrollable Navigation */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-muted/50 scrollbar-track-transparent px-2 py-3">
        {/* Main Section */}
        <nav className="mb-2">
          <SectionHeader
            title="Main"
            expanded={mainExpanded}
            onToggle={toggleMainExpanded}
            isOpen={isSidebarOpen}
          />
          {mainExpanded && (
            <div className="space-y-0.5 mt-1">
              <NavLink
                item={{ name: 'Overview', href: '/dashboard', icon: Activity }}
                isActive={isActive('/dashboard')}
                isOpen={isSidebarOpen}
              />
              {isLoading ? (
                <div className="py-2 px-3">
                  <div className="h-4 w-20 bg-muted/50 animate-pulse rounded" />
                </div>
              ) : (
                mainPlugins.map(item => (
                  <NavLink
                    key={item.href}
                    item={item}
                    isActive={isActive(item.href)}
                    isOpen={isSidebarOpen}
                  />
                ))
              )}
            </div>
          )}
        </nav>

        {/* Network Section */}
        <nav className="mb-2">
          <SectionHeader
            title="Network"
            expanded={networkExpanded}
            onToggle={toggleNetworkExpanded}
            isOpen={isSidebarOpen}
          />
          {networkExpanded && (
            <div className="space-y-0.5 mt-1">
              {networkPlugins.map(item => (
                <NavLink
                  key={item.href}
                  item={item}
                  isActive={isActive(item.href)}
                  isOpen={isSidebarOpen}
                />
              ))}
              {staticNetworkItems.map(item => (
                <NavLink
                  key={item.href}
                  item={item}
                  isActive={isActive(item.href)}
                  isOpen={isSidebarOpen}
                />
              ))}
            </div>
          )}
        </nav>

        {/* More Section (Collapsible) */}
        <nav className="mb-2">
          <SectionHeader
            title="More"
            expanded={moreExpanded}
            onToggle={toggleMoreExpanded}
            isOpen={isSidebarOpen}
            icon={MoreHorizontal}
          />
          {moreExpanded && (
            <div className="space-y-0.5 mt-1">
              <NavLink
                item={{ name: 'Feedback', href: '/feedback', icon: MessageSquare }}
                isActive={isActive('/feedback')}
                isOpen={isSidebarOpen}
              />
              <NavLink
                item={{ name: 'Teams', href: '/teams', icon: Users }}
                isActive={isActive('/teams')}
                isOpen={isSidebarOpen}
              />
              <NavLink
                item={{ name: 'Marketplace', href: '/marketplace', icon: ShoppingBag }}
                isActive={isActive('/marketplace')}
                isOpen={isSidebarOpen}
              />
              <NavLink
                item={{ name: 'Docs', href: '/docs', icon: BookOpen }}
                isActive={isActive('/docs')}
                isOpen={isSidebarOpen}
              />
            </div>
          )}
        </nav>
      </div>

      {/* Bottom Section - Fixed */}
      <div className="shrink-0 p-2 border-t border-border/50 space-y-0.5 bg-card/80">
        {/* Theme toggle */}
        <button
          onClick={theme.toggle}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-all"
        >
          {theme.mode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          {isSidebarOpen && <span className="text-sm">{theme.mode === 'dark' ? 'Light' : 'Dark'}</span>}
        </button>

        <NavLink
          item={{ name: 'Settings', href: '/settings', icon: Settings }}
          isActive={isActive('/settings')}
          isOpen={isSidebarOpen}
        />

        {isAdmin && (
          <NavLink
            item={{ name: 'Admin', href: '/admin/users', icon: Shield }}
            isActive={isActive('/admin')}
            isOpen={isSidebarOpen}
          />
        )}

        <button
          onClick={() => logout()}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all"
        >
          <LogOut size={18} />
          {isSidebarOpen && <span className="text-sm">Sign out</span>}
        </button>
      </div>

      {/* Resize Handle - Only show when sidebar is open */}
      {isSidebarOpen && (
        <div
          ref={resizeHandleRef}
          onMouseDown={handleMouseDown}
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize group hover:w-1.5 transition-all ${
            isResizing ? 'bg-primary w-1.5' : 'bg-transparent hover:bg-primary/50'
          }`}
        >
          {/* Grip indicator on hover */}
          <div className={`absolute top-1/2 -translate-y-1/2 right-0 -mr-1.5 p-0.5 rounded bg-muted border border-border/50 opacity-0 group-hover:opacity-100 transition-opacity ${
            isResizing ? 'opacity-100' : ''
          }`}>
            <GripVertical size={12} className="text-muted-foreground" />
          </div>
        </div>
      )}
    </aside>
  );
}

function SectionHeader({
  title,
  expanded,
  onToggle,
  isOpen,
  icon: Icon,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  isOpen: boolean;
  icon?: React.ComponentType<{ size?: number }>;
}) {
  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-center py-2 text-muted-foreground/60 hover:text-muted-foreground transition-all"
        title={`${title} (${expanded ? 'collapse' : 'expand'})`}
      >
        {Icon ? <Icon size={14} /> : (
          <div className="w-5 h-[2px] bg-current rounded-full opacity-50" />
        )}
      </button>
    );
  }

  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-all group rounded-md hover:bg-muted/50"
    >
      <span className="flex items-center gap-2">
        {Icon && <Icon size={12} />}
        {title}
      </span>
      <span className="opacity-0 group-hover:opacity-100 transition-opacity">
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </span>
    </button>
  );
}

function NavLink({
  item,
  isActive,
  isOpen,
}: {
  item: NavItem;
  isActive: boolean;
  isOpen: boolean;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
        isActive
          ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
          : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
      }`}
      title={!isOpen ? item.name : undefined}
    >
      <span className="shrink-0"><Icon size={18} /></span>
      {isOpen && <span className="text-sm font-medium truncate">{item.name}</span>}
    </Link>
  );
}
