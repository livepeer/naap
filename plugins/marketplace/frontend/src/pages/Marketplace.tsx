import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ShoppingBag, Search, Download, Check, Star, Users, Package, ExternalLink, X, Loader2, Sparkles, Settings, Cloud, Server, MessageSquare, Send } from 'lucide-react';
import { Card, Badge } from '@naap/ui';
import { usePluginConfig, useTenantContext, useAuthService, useTeam, useEvents, getServiceOrigin } from '@naap/plugin-sdk';

// ============================================
// Tenant Personalization Config
// ============================================

interface MarketplaceConfig {
  /** Featured plugins to highlight at the top */
  featuredPlugins: string[];
  /** Welcome banner message */
  welcomeBanner?: {
    enabled: boolean;
    title: string;
    message: string;
    variant: 'info' | 'success' | 'warning';
  };
  /** Hide certain plugins from this tenant */
  hiddenPlugins: string[];
  /** Show pricing tier badges */
  showPricingTiers: boolean;
  /** Default category filter */
  defaultCategory: string;
  /** Custom categories for this tenant */
  customCategories: string[];
}

const DEFAULT_CONFIG: MarketplaceConfig = {
  featuredPlugins: [],
  welcomeBanner: undefined,
  hiddenPlugins: [],
  showPricingTiers: false,
  defaultCategory: 'all',
  customCategories: [],
};

interface PluginPackage {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  category: string;
  author?: string;
  icon?: string;
  downloads: number;
  rating?: number;
  latestVersion?: string;
  installedCount?: number;
  keywords?: string[];
  repository?: string;
  license?: string;
  // CDN deployment fields
  bundleUrl?: string;
  stylesUrl?: string;
  bundleHash?: string;
  bundleSize?: number;
  deploymentType?: 'cdn' | 'container';
}

interface PluginInstallation {
  id: string;
  packageId: string;
  status: string;
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

const categoryColors: Record<string, 'blue' | 'emerald' | 'amber' | 'rose'> = {
  analytics: 'blue',
  monitoring: 'emerald',
  developer: 'amber',
  social: 'rose',
  finance: 'amber',
  platform: 'blue',
  other: 'blue',
};

// Get API base URL: '' in production (same-origin), 'http://localhost:4000' in dev.
// getServiceOrigin already checks shell context, env vars, and hostname.
const getApiBaseUrl = (): string => getServiceOrigin('base');

const BASE_URL = getApiBaseUrl();

// ============================================
// StarRating Component
// ============================================

function StarRating({
  rating,
  size = 14,
  interactive = false,
  onRate,
}: {
  rating: number | null;
  size?: number;
  interactive?: boolean;
  onRate?: (rating: number) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const displayRating = hovered ?? (rating ?? 0);

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!interactive}
          onClick={(e) => {
            e.stopPropagation();
            onRate?.(star);
          }}
          onMouseEnter={() => interactive && setHovered(star)}
          onMouseLeave={() => interactive && setHovered(null)}
          className={`${interactive ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'} p-0 border-0 bg-transparent`}
          style={{ lineHeight: 0 }}
        >
          <Star
            size={size}
            className={`${
              star <= displayRating
                ? 'fill-amber-400 text-amber-400'
                : 'fill-transparent text-white/20'
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
  installing,
  error,
  onInstall,
  onUninstall,
  onClose,
  onRatingUpdated,
  getIcon,
}: {
  plugin: PluginPackage;
  isInstalled: boolean;
  installing: string | null;
  error: string | null;
  onInstall: (pkg: PluginPackage) => void;
  onUninstall: (pkg: PluginPackage) => void;
  onClose: () => void;
  onRatingUpdated: (pluginName: string, newRating: number | null) => void;
  getIcon: (pkg: PluginPackage) => string;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'reviews'>('overview');
  const [reviews, setReviews] = useState<PluginReview[]>([]);
  const [aggregate, setAggregate] = useState<RatingAggregate | null>(null);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [myRating, setMyRating] = useState<number>(0);
  const [myComment, setMyComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

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
      const res = await fetch(`${BASE_URL}/api/v1/registry/packages/${encodedName}/reviews`, {
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
      const res = await fetch(`${BASE_URL}/api/v1/registry/packages/${encodedName}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rating: myRating, comment: myComment || null }),
      });
      const data = await res.json();
      if (data.success) {
        setMyRating(0);
        setMyComment('');
        const newAggregate = await loadReviews();
        // Notify parent so the card rating updates immediately
        onRatingUpdated(plugin.name, newAggregate?.averageRating ?? null);
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

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" className="bg-bg-secondary border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-bg-tertiary flex items-center justify-center text-3xl">{getIcon(plugin)}</div>
            <div>
              <h2 className="text-xl font-bold text-text-primary">{plugin.displayName}</h2>
              <p className="text-sm text-text-secondary">{plugin.author || 'NAAP Team'} • v{plugin.latestVersion || '1.0.0'}</p>
              <div className="flex items-center gap-3 mt-2 text-xs text-text-secondary">
                {aggregate && aggregate.averageRating !== null ? (
                  <div className="flex items-center gap-1.5">
                    <StarRating rating={Math.round(aggregate.averageRating)} size={12} />
                    <span className="font-medium text-text-primary">{aggregate.averageRating.toFixed(1)}</span>
                    <span>({aggregate.totalRatings})</span>
                  </div>
                ) : (
                  <span>No ratings yet</span>
                )}
                <span className="flex items-center gap-1"><Download size={12} />{plugin.downloads || 0} downloads</span>
                <span className="flex items-center gap-1"><Users size={12} />{plugin.installedCount || 0} users</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 text-text-secondary"><X size={20} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 px-6">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'overview'
                ? 'border-accent-blue text-accent-blue'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('reviews')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'reviews'
                ? 'border-accent-blue text-accent-blue'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <MessageSquare size={14} />
            Reviews
            {aggregate && aggregate.totalRatings > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-white/5 rounded-full">{aggregate.totalRatings}</span>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'overview' ? (
            <>
              <div>
                <h3 className="text-sm font-medium text-text-secondary mb-2">Description</h3>
                <p className="text-text-primary">{plugin.description || 'A plugin for the NAAP platform.'}</p>
              </div>
              {plugin.repository && (
                <a href={plugin.repository} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-accent-blue hover:underline text-sm">
                  <ExternalLink size={14} />View Repository
                </a>
              )}

              {/* Rating Distribution */}
              {aggregate && aggregate.totalRatings > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-text-secondary mb-3">Rating Breakdown</h3>
                  <div className="space-y-1.5">
                    {[5, 4, 3, 2, 1].map((star) => {
                      const count = aggregate.distribution[star] || 0;
                      const pct = aggregate.totalRatings > 0 ? (count / aggregate.totalRatings) * 100 : 0;
                      return (
                        <div key={star} className="flex items-center gap-2 text-sm">
                          <span className="w-3 text-right text-text-secondary">{star}</span>
                          <Star size={12} className="fill-amber-400 text-amber-400" />
                          <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-400 rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-8 text-xs text-text-secondary text-right">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {error && <div className="p-4 bg-accent-rose/10 border border-accent-rose/20 rounded-xl text-accent-rose text-sm">{error}</div>}
            </>
          ) : (
            <>
              {/* Submit Review Form */}
              <div className="bg-white/5 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-bold text-text-primary">Write a Review</h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-secondary">Your rating:</span>
                  <StarRating
                    rating={myRating}
                    size={18}
                    interactive
                    onRate={(r) => setMyRating(r)}
                  />
                  {myRating > 0 && (
                    <span className="text-sm text-text-secondary">{myRating}/5</span>
                  )}
                </div>
                <textarea
                  value={myComment}
                  onChange={(e) => setMyComment(e.target.value)}
                  placeholder="Share your experience with this plugin (optional)..."
                  rows={3}
                  className="w-full px-3 py-2 bg-bg-tertiary border border-white/10 rounded-lg text-sm text-text-primary resize-none focus:outline-none focus:border-accent-blue transition-colors"
                />
                {reviewError && (
                  <div className="text-sm text-accent-rose bg-accent-rose/10 px-3 py-2 rounded-lg">
                    {reviewError}
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    onClick={handleSubmitReview}
                    disabled={myRating === 0 || submittingReview}
                    className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-accent-blue text-white hover:bg-accent-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {submittingReview ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Send size={14} />
                    )}
                    Submit Review
                  </button>
                </div>
              </div>

              {/* Reviews List */}
              {loadingReviews ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-text-secondary" />
                </div>
              ) : reviews.length === 0 ? (
                <div className="text-center py-8">
                  <MessageSquare size={40} className="mx-auto text-text-secondary opacity-30 mb-2" />
                  <p className="text-sm text-text-secondary">
                    No reviews yet. Be the first to review this plugin!
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {reviews.map((review) => (
                    <div
                      key={review.id}
                      className="border border-white/10 rounded-lg p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-accent-blue/20 flex items-center justify-center text-xs font-bold text-accent-blue">
                            {review.displayName.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-text-primary">{review.displayName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <StarRating rating={review.rating} size={12} />
                          <span className="text-xs text-text-secondary">
                            {new Date(review.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      {review.comment && (
                        <p className="text-sm text-text-secondary leading-relaxed pl-9">
                          {review.comment}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-white/10 bg-bg-tertiary/30">
          {isInstalled ? (
            <>
              <button onClick={() => onUninstall(plugin)} disabled={installing === plugin.name}
                className="flex-1 px-4 py-3 bg-accent-rose/20 text-accent-rose rounded-xl font-medium hover:bg-accent-rose/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {installing === plugin.name ? <><Loader2 size={18} className="animate-spin" />Uninstalling...</> : 'Uninstall'}
              </button>
              <button onClick={onClose} className="flex-1 px-4 py-3 bg-accent-blue text-white rounded-xl font-bold hover:bg-accent-blue/90 transition-all">Done</button>
            </>
          ) : (
            <button onClick={() => onInstall(plugin)} disabled={installing === plugin.name}
              className="w-full px-4 py-3 bg-accent-blue text-white rounded-xl font-bold hover:bg-accent-blue/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {installing === plugin.name ? <><Loader2 size={18} className="animate-spin" />Installing...</> : <><Package size={18} />Install Plugin</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Main Marketplace Page
// ============================================

export const MarketplacePage: React.FC = () => {
  // ============================================
  // Tenant Personalization
  // ============================================
  const { isTenantContext } = useTenantContext();
  const auth = useAuthService();
  const user = auth.getUser();
  
  // Team context & event bus for reacting to team switches
  const teamContext = useTeam();
  const eventBus = useEvents();
  const teamId = teamContext?.currentTeam?.id || null;
  // Use ref to avoid stale closures in event handlers
  const teamIdRef = useRef(teamId);
  teamIdRef.current = teamId;

  // Load tenant-specific configuration
  const {
    config: tenantConfig,
    currentScope,
  } = usePluginConfig<MarketplaceConfig>({
    pluginName: 'marketplace',
    defaults: DEFAULT_CONFIG,
    scope: 'auto', // Auto-detect: personal, team, or tenant
  });

  // ============================================
  // State
  // ============================================
  const [packages, setPackages] = useState<PluginPackage[]>([]);
  const [installations, setInstallations] = useState<Map<string, PluginInstallation>>(new Map());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>(tenantConfig.defaultCategory || 'all');
  const [sortBy, setSortBy] = useState<string>('downloads');
  const [selectedPackage, setSelectedPackage] = useState<PluginPackage | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Update category filter when config loads
  useEffect(() => {
    if (tenantConfig.defaultCategory && tenantConfig.defaultCategory !== 'all') {
      setCategoryFilter(tenantConfig.defaultCategory);
    }
  }, [tenantConfig.defaultCategory]);

  const loadPackages = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      params.set('sort', sortBy);

      const response = await fetch(`${BASE_URL}/api/v1/registry/packages?${params}`);
      if (response.ok) {
        const json = await response.json();
        // API routes wrap responses in { success, data: { packages }, meta }
        const data = json.data ?? json;
        setPackages(data.packages || []);
      } else {
        setPackages(getMockPackages());
      }
    } catch (err) {
      console.error('Failed to load packages:', err);
      setPackages(getMockPackages());
    } finally {
      setLoading(false);
    }
  }, [searchQuery, categoryFilter, sortBy]);

  const loadInstallations = useCallback(async (overrideTeamId?: string | null) => {
    try {
      const activeTeamId = overrideTeamId !== undefined ? overrideTeamId : teamIdRef.current;
      // Use team-scoped endpoint when in team context
      const url = activeTeamId
        ? `${BASE_URL}/api/v1/base/plugins/personalized?teamId=${encodeURIComponent(activeTeamId)}`
        : `${BASE_URL}/api/v1/installations`;

      const response = await fetch(url, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();

        const map = new Map<string, PluginInstallation>();
        if (activeTeamId) {
          // Team-scoped response format
          const plugins = data.data?.plugins || data.plugins || [];
          plugins.forEach((p: { name: string; installId?: string; id?: string }) => {
            map.set(p.name, { id: p.installId || p.id || '', packageId: '', status: 'active' });
          });
        } else {
          // Personal installations format
          (data.installations || []).forEach((inst: PluginInstallation & { package: { name: string } }) => {
            map.set(inst.package.name, inst);
          });
        }
        setInstallations(map);
      }
    } catch (err) {
      console.error('Failed to load installations:', err);
    }
  }, []);

  // Reload when search/filter/sort or team changes
  useEffect(() => {
    loadPackages();
    loadInstallations();
  }, [searchQuery, categoryFilter, sortBy, teamId, loadPackages, loadInstallations]);

  // Listen for team:change events to refresh installations
  useEffect(() => {
    const handleTeamChange = (payload: { teamId: string | null }) => {
      console.log('[Marketplace] Team context changed, refreshing installations...', payload.teamId);
      loadInstallations(payload.teamId);
    };

    const unsubscribe = eventBus.on('team:change', handleTeamChange);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        eventBus.off('team:change', handleTeamChange);
      }
    };
  }, [eventBus, loadInstallations]);

  const handleInstall = async (pkg: PluginPackage) => {
    try {
      setInstalling(pkg.name);
      setError(null);

      let response: Response;
      if (teamId) {
        // Team install
        response = await fetch(`${BASE_URL}/api/v1/teams/${teamId}/plugins`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ packageId: pkg.id, packageName: pkg.name }),
        });
      } else {
        // Personal install
        response = await fetch(`${BASE_URL}/api/v1/installations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageName: pkg.name }),
        });
      }

      if (response.ok) {
        await loadInstallations();
        setSelectedPackage(null);
        // Notify the shell so sidebar refreshes
        eventBus.emit('plugin:installed', { pluginName: pkg.name, teamId });
      } else {
        const data = await response.json();
        setError(data.error || 'Installation failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation failed');
    } finally {
      setInstalling(null);
    }
  };

  const handleUninstall = async (pkg: PluginPackage) => {
    try {
      setInstalling(pkg.name);
      setError(null);

      let response: Response;
      if (teamId) {
        // Team uninstall - use the installation ID
        const installId = installations.get(pkg.name)?.id;
        response = await fetch(`${BASE_URL}/api/v1/teams/${teamId}/plugins/${installId || pkg.name}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      } else {
        // Personal uninstall
        response = await fetch(`${BASE_URL}/api/v1/installations/${pkg.name}`, { method: 'DELETE' });
      }

      if (response.ok) {
        await loadInstallations();
        setSelectedPackage(null);
        // Notify the shell so sidebar refreshes
        eventBus.emit('plugin:uninstalled', { pluginName: pkg.name, teamId });
      } else {
        const data = await response.json();
        setError(data.error || 'Uninstallation failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Uninstallation failed');
    } finally {
      setInstalling(null);
    }
  };

  const isInstalled = (pkgName: string) => installations.has(pkgName);

  // Filter packages based on tenant config
  const filteredPackages = packages.filter(pkg => 
    !tenantConfig.hiddenPlugins.includes(pkg.name)
  );

  // Separate featured and regular packages
  const featuredPackages = filteredPackages.filter(pkg => 
    tenantConfig.featuredPlugins.includes(pkg.name)
  );
  const regularPackages = filteredPackages.filter(pkg => 
    !tenantConfig.featuredPlugins.includes(pkg.name)
  );

  const getIcon = (pkg: PluginPackage) => {
    // Map plugin names (camelCase) to meaningful emoji icons
    const icons: Record<string, string> = {
      'gatewayManager': '🌐',
      'orchestratorManager': '🎛️',
      'capacityPlanner': '📊',
      'networkAnalytics': '📈',
      'marketplace': '🛒',
      'community': '👥',
      'developerApi': '🔧',
      'myWallet': '💰',
    };
    return icons[pkg.name] || '📦';
  };

  const _getDeploymentBadge = (pkg: PluginPackage) => {
    const deploymentType = pkg.deploymentType || 'cdn';
    switch (deploymentType) {
      case 'cdn':
        return (
          <div className="flex items-center gap-1 px-2 py-1 bg-accent-blue/20 text-accent-blue rounded-lg text-xs font-medium">
            <Cloud size={12} /> CDN
          </div>
        );
      case 'container':
        return (
          <div className="flex items-center gap-1 px-2 py-1 bg-accent-emerald/20 text-accent-emerald rounded-lg text-xs font-medium">
            <Server size={12} /> Container
          </div>
        );
      default:
        return null;
    }
  };

  const _formatBundleSize = (bytes?: number) => {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const categories = ['all', 'analytics', 'monitoring', 'developer', 'social', 'finance', 'platform', 'other'];

  // Banner variant styles
  const bannerStyles: Record<'info' | 'success' | 'warning', string> = {
    info: 'bg-accent-blue/10 border-accent-blue/30 text-accent-blue',
    success: 'bg-accent-emerald/10 border-accent-emerald/30 text-accent-emerald',
    warning: 'bg-accent-amber/10 border-accent-amber/30 text-accent-amber',
  };

  const renderStarRatingOnCard = (pkg: PluginPackage) => {
    if (pkg.rating) {
      return (
        <div className="flex items-center gap-1.5">
          <StarRating rating={Math.round(pkg.rating)} size={12} />
          <span className="text-xs font-medium text-text-primary">{pkg.rating.toFixed(1)}</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1">
        <StarRating rating={0} size={12} />
        <span className="text-xs text-text-secondary">No ratings</span>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Tenant Welcome Banner */}
      {tenantConfig.welcomeBanner?.enabled && (
        <div className={`p-4 rounded-xl border ${bannerStyles[(tenantConfig.welcomeBanner.variant || 'info') as keyof typeof bannerStyles]}`}>
          <h3 className="font-bold text-lg">{tenantConfig.welcomeBanner.title}</h3>
          <p className="text-sm opacity-80 mt-1">{tenantConfig.welcomeBanner.message}</p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-outfit font-bold text-text-primary">Plugin Marketplace</h1>
          <p className="text-text-secondary mt-1">
            {teamId
              ? `Managing plugins for team: ${teamContext?.currentTeam?.name || 'Team'}`
              : isTenantContext 
                ? `Personalized for ${user?.displayName || 'you'} • ${currentScope} scope`
                : 'Discover and install plugins to extend your experience'
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isTenantContext && (
            <Badge variant="amber" className="flex items-center gap-1">
              <Settings size={12} /> Personalized
            </Badge>
          )}
          <Badge variant="blue">{filteredPackages.length} plugins available</Badge>
          <Badge variant="emerald">{installations.size} installed</Badge>
        </div>
      </div>

      {/* Featured Plugins Section (tenant-specific) */}
      {featuredPackages.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="text-accent-amber" size={20} />
            <h2 className="text-xl font-bold text-text-primary">Featured for You</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredPackages.map((pkg) => (
              <Card key={pkg.id || pkg.name} className="hover:border-accent-amber/50 border-accent-amber/20 transition-all cursor-pointer group relative bg-gradient-to-br from-accent-amber/5 to-transparent"
                onClick={() => setSelectedPackage(pkg)}>
                <div className="absolute top-3 right-3">
                  <div className="flex items-center gap-1 px-2 py-1 bg-accent-amber/20 text-accent-amber rounded-lg text-xs font-medium">
                    <Sparkles size={12} /> Featured
                  </div>
                </div>
                {isInstalled(pkg.name) && (
                  <div className="absolute top-3 left-3">
                    <div className="flex items-center gap-1 px-2 py-1 bg-accent-emerald/20 text-accent-emerald rounded-lg text-xs font-medium">
                      <Check size={12} /> Installed
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3 mb-4 mt-6">
                  <div className="w-12 h-12 rounded-xl bg-bg-tertiary flex items-center justify-center text-2xl flex-shrink-0">{getIcon(pkg)}</div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-text-primary group-hover:text-accent-amber transition-colors truncate">{pkg.displayName}</h3>
                    <p className="text-xs text-text-secondary">{pkg.author || 'NAAP Team'}</p>
                  </div>
                </div>
                <p className="text-sm text-text-secondary mb-4 line-clamp-2">{pkg.description || 'A NAAP plugin'}</p>
                <div className="flex items-center justify-between text-xs text-text-secondary">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1"><Download size={12} />{pkg.downloads || 0}</span>
                    {renderStarRatingOnCard(pkg)}
                  </div>
                  <Badge variant={categoryColors[pkg.category] || 'blue'}>{pkg.category}</Badge>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-64 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
          <input type="text" placeholder="Search plugins..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg-secondary border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:border-accent-blue transition-colors" />
        </div>
        <div className="flex bg-bg-secondary border border-white/10 rounded-xl p-1">
          {categories.map((cat) => (
            <button key={cat} onClick={() => setCategoryFilter(cat)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${categoryFilter === cat ? 'bg-accent-blue text-white' : 'text-text-secondary hover:text-text-primary'}`}>
              {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
          className="bg-bg-secondary border border-white/10 rounded-xl py-2 px-4 text-sm text-text-primary focus:outline-none focus:border-accent-blue">
          <option value="downloads">Most Downloads</option>
          <option value="rating">Highest Rated</option>
          <option value="newest">Newest</option>
          <option value="name">Name A-Z</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-accent-blue animate-spin" />
        </div>
      ) : (
        <>
          {/* All Plugins Section Header */}
          {featuredPackages.length > 0 && (
            <h2 className="text-xl font-bold text-text-primary mt-8">All Plugins</h2>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {regularPackages.map((pkg) => (
              <Card key={pkg.id || pkg.name} className="hover:border-accent-blue/30 transition-all cursor-pointer group relative"
                onClick={() => setSelectedPackage(pkg)}>
                {isInstalled(pkg.name) && (
                  <div className="absolute top-3 right-3">
                    <div className="flex items-center gap-1 px-2 py-1 bg-accent-emerald/20 text-accent-emerald rounded-lg text-xs font-medium">
                      <Check size={12} /> Installed
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-bg-tertiary flex items-center justify-center text-2xl flex-shrink-0">{getIcon(pkg)}</div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-text-primary group-hover:text-accent-blue transition-colors truncate">{pkg.displayName}</h3>
                    <p className="text-xs text-text-secondary">{pkg.author || 'NAAP Team'}</p>
                  </div>
                </div>
                <p className="text-sm text-text-secondary mb-4 line-clamp-2">{pkg.description || 'A NAAP plugin'}</p>
                <div className="flex items-center justify-between text-xs text-text-secondary">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1"><Download size={12} />{pkg.downloads || 0}</span>
                    {renderStarRatingOnCard(pkg)}
                  </div>
                  <Badge variant={categoryColors[pkg.category] || 'blue'}>{pkg.category}</Badge>
                </div>
              </Card>
            ))}
          </div>
          {filteredPackages.length === 0 && (
            <Card className="text-center py-16">
              <ShoppingBag size={48} className="mx-auto mb-4 text-text-secondary opacity-30" />
              <h3 className="text-lg font-bold text-text-primary mb-2">No plugins found</h3>
              <p className="text-text-secondary">Try adjusting your search or filter criteria</p>
            </Card>
          )}
        </>
      )}

      {selectedPackage && (
        <PluginDetailModal
          plugin={selectedPackage}
          isInstalled={isInstalled(selectedPackage.name)}
          installing={installing}
          error={error}
          onInstall={handleInstall}
          onUninstall={handleUninstall}
          onClose={() => setSelectedPackage(null)}
          onRatingUpdated={(pluginName, newRating) => {
            const ratingValue = newRating ?? undefined;
            setPackages(prev =>
              prev.map(p => p.name === pluginName ? { ...p, rating: ratingValue } : p)
            );
            setSelectedPackage(prev =>
              prev && prev.name === pluginName ? { ...prev, rating: ratingValue } : prev
            );
          }}
          getIcon={getIcon}
        />
      )}
    </div>
  );
};

function getMockPackages(): PluginPackage[] {
  return [
    { id: '1', name: 'gatewayManager', displayName: 'Gateway Manager', description: 'Manage and monitor your AI gateway infrastructure', category: 'monitoring', author: 'NAAP Team', downloads: 1250, rating: 4.8, keywords: ['gateway', 'monitoring'] },
    { id: '2', name: 'orchestratorManager', displayName: 'Orchestrator Manager', description: 'Configure and orchestrate AI pipeline workflows', category: 'monitoring', author: 'NAAP Team', downloads: 980, rating: 4.6, keywords: ['orchestrator', 'workflow'] },
    { id: '3', name: 'capacityPlanner', displayName: 'Capacity Planner', description: 'Plan and optimize resource capacity', category: 'monitoring', author: 'NAAP Team', downloads: 850, rating: 4.5, keywords: ['capacity', 'planning'] },
    { id: '4', name: 'networkAnalytics', displayName: 'Network Analytics', description: 'Analytics and insights for network performance', category: 'analytics', author: 'NAAP Team', downloads: 1100, rating: 4.7, keywords: ['analytics', 'network'] },
    { id: '5', name: 'community', displayName: 'Community Hub', description: 'Connect with other operators', category: 'social', author: 'NAAP Team', downloads: 720, rating: 4.4, keywords: ['community', 'social'] },
    { id: '6', name: 'developerApi', displayName: 'Developer API Manager', description: 'Manage API keys and developer access', category: 'developer', author: 'NAAP Team', downloads: 650, rating: 4.3, keywords: ['api', 'developer'] },
    { id: '7', name: 'myWallet', displayName: 'My Wallet', description: 'MetaMask wallet integration for staking and Web3 transactions', category: 'finance', author: 'NAAP Team', downloads: 300, rating: 4.5, keywords: ['wallet', 'metamask', 'staking'] },
  ];
}

export default MarketplacePage;
