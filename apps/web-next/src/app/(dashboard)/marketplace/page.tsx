'use client';

/**
 * Plugin Marketplace Page
 * Browse and install plugins from the marketplace.
 * Includes star ratings and comment/review threads.
 *
 * Supports team context via:
 * 1. URL params (?teamId=...&teamName=...) when navigating from team management
 * 2. Shell team context when switching teams via the team switcher
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useShell, useEvents } from '@/contexts/shell-context';
import { getCsrfToken } from '@/lib/api/csrf';
import {
  Search,
  Package,
  Download,
  Filter,
  Loader2,
  Check,
  Trash2,
  Star,
  MessageSquare,
  X,
  Send,
  User as UserIcon,
} from 'lucide-react';

// ============================================
// Types
// ============================================

interface PluginPackage {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  author: string;
  icon: string;
  downloads: number;
  rating: number | null;
  isCore: boolean;
  versions: Array<{
    version: string;
    frontendUrl: string;
  }>;
}

interface PluginReview {
  id: string;
  userId: string;
  displayName: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RatingAggregate {
  averageRating: number | null;
  totalRatings: number;
  distribution: Record<number, number>;
}

// ============================================
// StarRating Component
// ============================================

function StarRating({
  rating,
  size = 'sm',
  interactive = false,
  onRate,
}: {
  rating: number | null;
  size?: 'sm' | 'md' | 'lg';
  interactive?: boolean;
  onRate?: (rating: number) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const displayRating = hovered ?? (rating ?? 0);

  const sizeClasses = {
    sm: 'w-3.5 h-3.5',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!interactive}
          onClick={() => onRate?.(star)}
          onMouseEnter={() => interactive && setHovered(star)}
          onMouseLeave={() => interactive && setHovered(null)}
          className={`${interactive ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'} p-0 border-0 bg-transparent`}
        >
          <Star
            className={`${sizeClasses[size]} ${
              star <= displayRating
                ? 'fill-yellow-400 text-yellow-400'
                : 'fill-transparent text-muted-foreground/40'
            } transition-colors`}
          />
        </button>
      ))}
    </div>
  );
}

// ============================================
// PluginDetailModal Component
// ============================================

function PluginDetailModal({
  plugin,
  isInstalled,
  isCore,
  onClose,
  onInstall,
  onUninstall,
  onRatingUpdated,
  installingId,
  uninstallingId,
}: {
  plugin: PluginPackage;
  isInstalled: boolean;
  isCore: boolean;
  onClose: () => void;
  onInstall: (pkg: PluginPackage) => void;
  onUninstall: (pkg: PluginPackage) => void;
  onRatingUpdated: (pluginId: string, newRating: number | null) => void;
  installingId: string | null;
  uninstallingId: string | null;
}) {
  const [reviews, setReviews] = useState<PluginReview[]>([]);
  const [aggregate, setAggregate] = useState<RatingAggregate | null>(null);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [myRating, setMyRating] = useState<number>(0);
  const [myComment, setMyComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'reviews'>('overview');

  // Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const encodedName = encodeURIComponent(plugin.name);

  const loadReviews = useCallback(async (): Promise<RatingAggregate | null> => {
    try {
      setLoadingReviews(true);
      const res = await fetch(`/api/v1/registry/packages/${encodedName}/reviews`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        setReviews(data.data.reviews);
        setAggregate(data.data.aggregate);
        return data.data.aggregate as RatingAggregate;
      }
    } catch (err) {
      console.error('Failed to load reviews:', err);
    } finally {
      setLoadingReviews(false);
    }
    return null;
  }, [encodedName]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const handleSubmitReview = async () => {
    if (myRating === 0) return;
    setSubmittingReview(true);
    setReviewError(null);
    try {
      const csrfToken = await getCsrfToken();
      const res = await fetch(`/api/v1/registry/packages/${encodedName}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({ rating: myRating, comment: myComment || null }),
      });
      const data = await res.json();
      if (data.success) {
        setMyRating(0);
        setMyComment('');
        const newAggregate = await loadReviews();
        // Notify parent so the card rating updates immediately
        onRatingUpdated(plugin.id, newAggregate?.averageRating ?? null);
      } else {
        const errMsg = typeof data.error === 'string'
          ? data.error
          : data.error?.message || 'Failed to submit review';
        setReviewError(errMsg);
      }
    } catch (err) {
      setReviewError('Failed to submit review. Please try again.');
      console.error('Failed to submit review:', err);
    } finally {
      setSubmittingReview(false);
    }
  };

  const isInstalling = installingId === plugin.id;
  const isUninstalling = uninstallingId === plugin.id;
  const canUninstall = isInstalled && !isCore;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div role="dialog" aria-modal="true" className="relative w-full max-w-2xl max-h-[85vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start gap-4 p-6 border-b border-border">
          <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Package className="w-7 h-7 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-bold truncate">{plugin.displayName}</h2>
              {plugin.isCore && (
                <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full">Core</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">by {plugin.author}</p>
            <div className="flex items-center gap-3 mt-2">
              {aggregate && aggregate.averageRating !== null ? (
                <div className="flex items-center gap-1.5">
                  <StarRating rating={Math.round(aggregate.averageRating)} size="sm" />
                  <span className="text-sm font-medium">{aggregate.averageRating.toFixed(1)}</span>
                  <span className="text-xs text-muted-foreground">({aggregate.totalRatings})</span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">No ratings yet</span>
              )}
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Download className="w-3 h-3" />
                {plugin.downloads} downloads
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-6">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'overview'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('reviews')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'reviews'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            Reviews
            {aggregate && aggregate.totalRatings > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-muted rounded-full">{aggregate.totalRatings}</span>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-2">Description</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {plugin.description || 'No description available.'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-semibold mb-1">Category</h3>
                  <p className="text-sm text-muted-foreground capitalize">{plugin.category}</p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold mb-1">Latest Version</h3>
                  <p className="text-sm text-muted-foreground">
                    {plugin.versions[0]?.version || 'N/A'}
                  </p>
                </div>
              </div>

              {/* Rating Distribution */}
              {aggregate && aggregate.totalRatings > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Rating Breakdown</h3>
                  <div className="space-y-1.5">
                    {[5, 4, 3, 2, 1].map((star) => {
                      const count = aggregate.distribution[star] || 0;
                      const pct = aggregate.totalRatings > 0 ? (count / aggregate.totalRatings) * 100 : 0;
                      return (
                        <div key={star} className="flex items-center gap-2 text-sm">
                          <span className="w-3 text-right text-muted-foreground">{star}</span>
                          <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-yellow-400 rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-8 text-xs text-muted-foreground text-right">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Submit Review Form */}
              <div className="bg-muted/50 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold">Write a Review</h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Your rating:</span>
                  <StarRating
                    rating={myRating}
                    size="md"
                    interactive
                    onRate={(r) => setMyRating(r)}
                  />
                  {myRating > 0 && (
                    <span className="text-sm text-muted-foreground">{myRating}/5</span>
                  )}
                </div>
                <textarea
                  value={myComment}
                  onChange={(e) => setMyComment(e.target.value)}
                  placeholder="Share your experience with this plugin (optional)..."
                  rows={3}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {reviewError && (
                  <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                    {reviewError}
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    onClick={handleSubmitReview}
                    disabled={myRating === 0 || submittingReview}
                    className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {submittingReview ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Submit Review
                  </button>
                </div>
              </div>

              {/* Reviews List */}
              {loadingReviews ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : reviews.length === 0 ? (
                <div className="text-center py-8">
                  <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No reviews yet. Be the first to review this plugin!
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {reviews.map((review) => (
                    <div
                      key={review.id}
                      className="border border-border rounded-lg p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                            <UserIcon className="w-4 h-4 text-primary" />
                          </div>
                          <span className="text-sm font-medium">{review.displayName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <StarRating rating={review.rating} size="sm" />
                          <span className="text-xs text-muted-foreground">
                            {new Date(review.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      {review.comment && (
                        <p className="text-sm text-muted-foreground leading-relaxed pl-9">
                          {review.comment}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer - Install/Uninstall action */}
        <div className="border-t border-border p-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
          >
            Close
          </button>
          {canUninstall ? (
            <button
              onClick={() => onUninstall(plugin)}
              disabled={isUninstalling}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50 transition-colors"
            >
              {isUninstalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {isUninstalling ? 'Uninstalling...' : 'Uninstall'}
            </button>
          ) : isInstalled && isCore ? (
            <div className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-muted text-muted-foreground">
              <Check className="w-4 h-4" />
              Core Plugin
            </div>
          ) : (
            <button
              onClick={() => onInstall(plugin)}
              disabled={isInstalling}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isInstalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {isInstalling ? 'Installing...' : 'Install'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Categories
// ============================================

const CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'platform', label: 'Platform' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'developer', label: 'Developer' },
  { value: 'finance', label: 'Finance' },
  { value: 'social', label: 'Social' },
  { value: 'media', label: 'Media' },
];

// ============================================
// Main Marketplace Page
// ============================================

export default function MarketplacePage() {
  const searchParams = useSearchParams();
  const urlTeamId = searchParams.get('teamId');
  const urlTeamName = searchParams.get('teamName');

  // Shell team context (from team switcher)
  const shell = useShell();
  const eventBus = useEvents();
  const shellTeamId = shell.team?.currentTeam?.id || null;
  const shellTeamName = shell.team?.currentTeam?.name || null;

  // Prefer URL param if present, otherwise use shell team context
  const teamId = urlTeamId || shellTeamId;
  const teamName = urlTeamName || shellTeamName;

  // Ref to avoid stale closure in event handler
  const teamIdRef = useRef(teamId);
  teamIdRef.current = teamId;

  const [packages, setPackages] = useState<PluginPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [installationMap, setInstallationMap] = useState<Map<string, string>>(new Map());
  const [selectedPlugin, setSelectedPlugin] = useState<PluginPackage | null>(null);

  const loadPackages = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') params.set('category', selectedCategory);
      if (searchQuery) params.set('search', searchQuery);

      const res = await fetch(`/api/v1/registry/packages?${params}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        setPackages(data.data.packages || []);
      } else {
        const errMsg = typeof data.error === 'string'
          ? data.error
          : data.error?.message || 'Failed to load packages';
        setError(errMsg);
      }
    } catch (err) {
      setError('Failed to load packages');
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, searchQuery]);

  const loadInstalledPlugins = useCallback(async (overrideTeamId?: string | null) => {
    try {
      const activeTeamId = overrideTeamId !== undefined ? overrideTeamId : teamIdRef.current;
      const url = activeTeamId
        ? `/api/v1/base/plugins/personalized?teamId=${activeTeamId}`
        : '/api/v1/base/plugins/personalized';

      const res = await fetch(url, {
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        const plugins = data.data?.plugins || data.plugins || [];
        // Only treat plugins that are explicitly installed (have a preference record
        // or are core) as "installed". Use the `installed` flag from the personalized
        // API, falling back to `enabled` for backward compatibility.
        const installed = new Set<string>(
          plugins
            .filter((p: { name: string; enabled?: boolean; installed?: boolean }) =>
              p.installed !== undefined ? p.installed : p.enabled !== false
            )
            .map((p: { name: string }) => p.name)
        );
        setInstalledIds(installed);

        const instMap = new Map<string, string>();
        plugins
          .filter((p: { name: string; enabled?: boolean; installed?: boolean }) =>
            p.installed !== undefined ? p.installed : p.enabled !== false
          )
          .forEach((p: { name: string; installId?: string; id?: string }) => {
            const installId = p.installId || p.id;
            if (installId) {
              instMap.set(p.name, installId);
            }
          });
        setInstallationMap(instMap);
      }
    } catch (err) {
      console.error('Failed to load installed plugins:', err);
    }
  }, []);

  // Reload data when filters or team context changes
  useEffect(() => {
    loadPackages();
    loadInstalledPlugins();
  }, [selectedCategory, searchQuery, teamId, loadPackages, loadInstalledPlugins]);

  // Listen for team:change events
  useEffect(() => {
    const handleTeamChange = (payload: { teamId: string | null }) => {
      console.log('[Marketplace] Team context changed, refreshing...', payload.teamId);
      loadInstalledPlugins(payload.teamId);
    };

    const unsubscribe = eventBus.on('team:change', handleTeamChange);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        eventBus.off('team:change', handleTeamChange);
      }
    };
  }, [eventBus, loadInstalledPlugins]);

  async function handleInstall(pkg: PluginPackage) {
    setInstallingId(pkg.id);
    try {
      let success = false;
      if (teamId) {
        const res = await fetch(`/api/v1/teams/${teamId}/plugins`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ packageId: pkg.id }),
        });
        const data = await res.json();
        if (data.success) {
          setInstalledIds(prev => new Set([...prev, pkg.name]));
          success = true;
        }
      } else {
        const res = await fetch('/api/v1/base/plugins/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ pluginName: pkg.name, enabled: true }),
        });
        const data = await res.json();
        if (data.success) {
          setInstalledIds(prev => new Set([...prev, pkg.name]));
          success = true;
        }
      }
      if (success) {
        eventBus.emit('plugin:installed', { pluginName: pkg.name, teamId });
      }
    } catch (err) {
      console.error('Failed to install plugin:', err);
    } finally {
      setInstallingId(null);
    }
  }

  async function handleUninstall(pkg: PluginPackage) {
    if (pkg.isCore) return;
    setUninstallingId(pkg.id);
    try {
      let success = false;
      if (teamId) {
        const installId = installationMap.get(pkg.name);
        if (installId) {
          const res = await fetch(`/api/v1/teams/${teamId}/plugins/${installId}`, {
            method: 'DELETE',
            credentials: 'include',
          });
          const data = await res.json();
          success = data.success;
        }
      } else {
        const res = await fetch('/api/v1/base/plugins/preferences', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ pluginName: pkg.name }),
        });
        const data = await res.json();
        success = data.success;
      }
      if (success) {
        setInstalledIds(prev => {
          const next = new Set(prev);
          next.delete(pkg.name);
          return next;
        });
        setInstallationMap(prev => {
          const next = new Map(prev);
          next.delete(pkg.name);
          return next;
        });
        eventBus.emit('plugin:uninstalled', { pluginName: pkg.name, teamId });
      }
    } catch (err) {
      console.error('Failed to uninstall plugin:', err);
    } finally {
      setUninstallingId(null);
    }
  }

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      platform: 'bg-purple-500/10 text-purple-500',
      monitoring: 'bg-blue-500/10 text-blue-500',
      analytics: 'bg-green-500/10 text-green-500',
      developer: 'bg-orange-500/10 text-orange-500',
      finance: 'bg-yellow-500/10 text-yellow-500',
      social: 'bg-pink-500/10 text-pink-500',
      media: 'bg-red-500/10 text-red-500',
    };
    return colors[category] || 'bg-gray-500/10 text-gray-500';
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="w-6 h-6" />
          Plugin Marketplace
        </h1>
        <p className="text-muted-foreground mt-1">
          {teamId ? (
            <>Managing plugins for team: <strong>{teamName || 'Team'}</strong></>
          ) : (
            'Discover and install plugins to extend your NAAP experience'
          )}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search plugins..."
            className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : packages.length === 0 ? (
        <div className="text-center py-12 bg-muted/50 rounded-xl">
          <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No plugins found</h3>
          <p className="text-muted-foreground">
            Try adjusting your search or filter criteria
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map(pkg => {
            const isInstalled = installedIds.has(pkg.name);
            const isInstalling = installingId === pkg.id;
            const isUninstalling = uninstallingId === pkg.id;
            const canUninstall = isInstalled && !pkg.isCore;
            return (
              <div
                key={pkg.id}
                className="bg-card border border-border rounded-xl p-4 hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => setSelectedPlugin(pkg)}
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Package className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">{pkg.displayName}</h3>
                      {pkg.isCore && (
                        <span className="px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded">
                          Core
                        </span>
                      )}
                      {isInstalled && (
                        <span className="px-1.5 py-0.5 text-xs bg-green-500/10 text-green-500 rounded">
                          Installed
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">by {pkg.author}</p>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                  {pkg.description}
                </p>

                <div className="flex items-center gap-2 mb-4">
                  <span className={`px-2 py-0.5 text-xs rounded-full ${getCategoryColor(pkg.category)}`}>
                    {pkg.category}
                  </span>
                  {pkg.versions[0] && (
                    <span className="text-xs text-muted-foreground">
                      v{pkg.versions[0].version}
                    </span>
                  )}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                    <Download className="w-3 h-3" />
                    {pkg.downloads}
                  </div>
                </div>

                {/* Star Rating Display */}
                <div className="flex items-center gap-2 mb-4">
                  {pkg.rating ? (
                    <div className="flex items-center gap-1.5">
                      <StarRating rating={Math.round(pkg.rating)} size="sm" />
                      <span className="text-xs font-medium">{pkg.rating.toFixed(1)}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <StarRating rating={0} size="sm" />
                      <span className="text-xs text-muted-foreground">No ratings</span>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div onClick={(e) => e.stopPropagation()}>
                  {canUninstall ? (
                    <button
                      onClick={() => handleUninstall(pkg)}
                      disabled={isUninstalling}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50"
                    >
                      {isUninstalling ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Uninstalling...
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4" />
                          Uninstall
                        </>
                      )}
                    </button>
                  ) : isInstalled && pkg.isCore ? (
                    <div className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-muted text-muted-foreground cursor-not-allowed">
                      <Check className="w-4 h-4" />
                      Core Plugin
                    </div>
                  ) : (
                    <button
                      onClick={() => handleInstall(pkg)}
                      disabled={isInstalling}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isInstalling ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Installing...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          Install
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Plugin Detail Modal */}
      {selectedPlugin && (
        <PluginDetailModal
          plugin={selectedPlugin}
          isInstalled={installedIds.has(selectedPlugin.name)}
          isCore={selectedPlugin.isCore}
          onClose={() => setSelectedPlugin(null)}
          onInstall={handleInstall}
          onUninstall={handleUninstall}
          onRatingUpdated={(pluginId, newRating) => {
            // Update the rating on the card in the grid immediately
            setPackages(prev =>
              prev.map(p => p.id === pluginId ? { ...p, rating: newRating } : p)
            );
            // Also update the selected plugin so the modal header reflects it
            setSelectedPlugin(prev =>
              prev && prev.id === pluginId ? { ...prev, rating: newRating } : prev
            );
          }}
          installingId={installingId}
          uninstallingId={uninstallingId}
        />
      )}
    </div>
  );
}
