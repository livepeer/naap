'use client';

/**
 * PluginInfoButton Component
 *
 * A floating info button that appears on plugin pages.
 * When clicked, shows plugin metadata in an elegant popover.
 * Supports both light and dark modes with crisp, modern styling.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Info, X, Package, User, Calendar, Tag, Clock } from 'lucide-react';

export interface PluginMetadata {
  /** Plugin name (technical) */
  name: string;
  /** Display name */
  displayName?: string;
  /** Installed version */
  installedVersion?: string;
  /** Latest available version */
  latestVersion?: string;
  /** Publisher name or ID */
  publisher?: string;
  /** Installation date */
  installedAt?: string | Date;
  /** Creation date */
  createdAt?: string | Date;
  /** Plugin category */
  category?: string;
  /** Deployment type */
  deploymentType?: 'cdn' | 'container';
}

interface PluginInfoButtonProps {
  metadata: PluginMetadata;
  className?: string;
}

function formatDate(date: string | Date | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatRelativeTime(date: string | Date | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

// Inject animation keyframes
if (typeof document !== 'undefined' && !document.getElementById('plugin-info-styles')) {
  const style = document.createElement('style');
  style.id = 'plugin-info-styles';
  style.textContent = `
    @keyframes pluginInfoFadeIn {
      from {
        opacity: 0;
        transform: translateY(8px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `;
  document.head.appendChild(style);
}

export function PluginInfoButton({ metadata, className = '' }: PluginInfoButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    // Close on escape key
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const hasUpdate = metadata.latestVersion &&
    metadata.installedVersion &&
    metadata.latestVersion !== metadata.installedVersion;

  return (
    <div className={`relative ${className}`}>
      {/* Info Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`
          p-2.5 rounded-full transition-all duration-200
          ${isOpen
            ? 'bg-slate-900 dark:bg-white/20 text-white shadow-lg shadow-slate-900/25 dark:shadow-black/25 scale-105'
            : 'bg-slate-800/90 dark:bg-white/10 text-white/90 dark:text-white/70 hover:bg-slate-900 dark:hover:bg-white/15 hover:text-white hover:scale-105'
          }
          backdrop-blur-sm
          border border-slate-700/50 dark:border-white/10
          hover:shadow-lg hover:shadow-slate-900/20 dark:hover:shadow-black/20
        `}
        title="Plugin Info"
        aria-label="Show plugin information"
        aria-expanded={isOpen}
      >
        <Info className="w-4 h-4" />
      </button>

      {/* Info Panel - appears above the button */}
      {isOpen && (
        <div
          ref={panelRef}
          className="
            absolute bottom-full right-0 mb-3 z-50
            w-80 rounded-2xl overflow-hidden

            /* Light mode: crisp white with subtle shadows and borders */
            bg-white dark:bg-[#1a1a2e]/95
            border border-slate-200 dark:border-white/10
            shadow-xl shadow-slate-900/10 dark:shadow-black/40

            /* Subtle gradient overlay for depth in light mode */
            before:absolute before:inset-0 before:bg-gradient-to-b
            before:from-slate-50/50 before:to-transparent before:pointer-events-none
            before:dark:from-transparent before:dark:to-transparent

            backdrop-blur-xl
          "
          style={{
            animation: 'pluginInfoFadeIn 0.2s ease-out',
          }}
          role="dialog"
          aria-label="Plugin information"
        >
          {/* Header with accent background */}
          <div className="relative px-5 pt-5 pb-4 bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-transparent dark:to-transparent border-b border-slate-100 dark:border-white/5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/25">
                  <Package className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-white text-sm leading-tight">
                    {metadata.displayName || metadata.name}
                  </h3>
                  <p className="text-slate-500 dark:text-white/50 text-xs font-mono mt-0.5">
                    {metadata.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white/70 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Info Grid */}
          <div className="px-5 py-4 space-y-1">
            {/* Version Row */}
            <div className="flex items-center justify-between py-2.5 border-b border-slate-100 dark:border-white/5">
              <div className="flex items-center gap-2.5 text-slate-500 dark:text-white/60">
                <div className="p-1.5 rounded-md bg-slate-100 dark:bg-white/5">
                  <Tag className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-medium">Version</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono font-semibold text-slate-900 dark:text-white">
                  {metadata.installedVersion || '-'}
                </span>
                {hasUpdate && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold bg-amber-100 dark:bg-accent-amber/20 text-amber-700 dark:text-accent-amber rounded-full">
                    {metadata.latestVersion} available
                  </span>
                )}
              </div>
            </div>

            {/* Publisher Row */}
            <div className="flex items-center justify-between py-2.5 border-b border-slate-100 dark:border-white/5">
              <div className="flex items-center gap-2.5 text-slate-500 dark:text-white/60">
                <div className="p-1.5 rounded-md bg-slate-100 dark:bg-white/5">
                  <User className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-medium">Publisher</span>
              </div>
              <span className="text-sm font-medium text-slate-900 dark:text-white">
                {metadata.publisher || 'Unknown'}
              </span>
            </div>

            {/* Installed Row */}
            <div className="flex items-center justify-between py-2.5 border-b border-slate-100 dark:border-white/5">
              <div className="flex items-center gap-2.5 text-slate-500 dark:text-white/60">
                <div className="p-1.5 rounded-md bg-slate-100 dark:bg-white/5">
                  <Clock className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-medium">Installed</span>
              </div>
              <div className="text-right">
                <span className="text-sm font-medium text-slate-900 dark:text-white">
                  {formatDate(metadata.installedAt)}
                </span>
                {metadata.installedAt && (
                  <span className="text-xs text-slate-400 dark:text-white/40 ml-1.5">
                    ({formatRelativeTime(metadata.installedAt)})
                  </span>
                )}
              </div>
            </div>

            {/* Created Row */}
            <div className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-2.5 text-slate-500 dark:text-white/60">
                <div className="p-1.5 rounded-md bg-slate-100 dark:bg-white/5">
                  <Calendar className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-medium">Created</span>
              </div>
              <span className="text-sm font-medium text-slate-900 dark:text-white">
                {formatDate(metadata.createdAt)}
              </span>
            </div>
          </div>

          {/* Footer */}
          {metadata.category && (
            <div className="px-5 py-3 bg-slate-50 dark:bg-white/5 border-t border-slate-100 dark:border-white/5">
              <span className="inline-flex items-center px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-white/60 rounded-md">
                {metadata.category}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PluginInfoButton;
