import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap,
  Plus,
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { Card } from '@naap/ui';
import type { CapacityRequest, FilterState, SortField, RequestComment } from '../types';
import { VRAM_OPTIONS } from '../types';
import { computeSummary, filterRequests, sortRequests, getUniqueValues } from '../utils';
import { SummaryPanel } from '../components/SummaryPanel';
import { RequestCard } from '../components/RequestCard';
import { NewRequestModal } from '../components/NewRequestModal';
import { RequestDetailModal } from '../components/RequestDetailModal';
import {
  fetchRequests,
  createRequest as apiCreateRequest,
  toggleCommit as apiToggleCommit,
  addComment as apiAddComment,
  type FetchRequestsParams,
} from '../lib/api';

// Mock user context - in production this would come from shell context
const getCurrentUser = () => ({
  id: 'current-user',
  name: 'You',
});

export const CapacityPage: React.FC = () => {
  // Data state
  const [requests, setRequests] = useState<CapacityRequest[]>([]);
  const [committedIds, setCommittedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [selectedRequest, setSelectedRequest] = useState<CapacityRequest | null>(null);
  const [showNewRequestModal, setShowNewRequestModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Filter/sort state
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    gpuModel: '',
    vramMin: '',
    pipeline: '',
  });
  const [sortField, setSortField] = useState<SortField>('newest');

  // Load requests on mount
  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: FetchRequestsParams = {};
      if (filters.gpuModel) params.gpuModel = filters.gpuModel;
      if (filters.pipeline) params.pipeline = filters.pipeline;
      if (filters.vramMin) params.vramMin = filters.vramMin;
      if (filters.search) params.search = filters.search;
      if (sortField) params.sort = sortField;

      const data = await fetchRequests(params);
      setRequests(data);

      // Initialize committed IDs based on current user's commits
      const user = getCurrentUser();
      const userCommits = new Set<string>();
      data.forEach(req => {
        if (req.softCommits?.some(sc => sc.userId === user.id)) {
          userCommits.add(req.id);
        }
      });
      setCommittedIds(userCommits);
    } catch (err) {
      console.error('[Capacity] Failed to load requests:', err);
      setError(err instanceof Error ? err.message : 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [filters, sortField]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  // Derived data
  const filteredAndSorted = useMemo(() => {
    const filtered = filterRequests(requests, filters);
    return sortRequests(filtered, sortField);
  }, [requests, filters, sortField]);

  const summary = useMemo(() => computeSummary(requests), [requests]);

  // Available filter options from current data
  const availableGPUs = useMemo(() => getUniqueValues(requests, 'gpuModel'), [requests]);
  const availablePipelines = useMemo(() => getUniqueValues(requests, 'pipeline'), [requests]);

  const hasActiveFilters = filters.gpuModel || filters.vramMin || filters.pipeline;

  // Handlers
  const handleThumbsUp = useCallback(
    async (request: CapacityRequest) => {
      const user = getCurrentUser();
      const alreadyCommitted = committedIds.has(request.id);

      // Optimistic update
      setRequests((prev) =>
        prev.map((r) => {
          if (r.id !== request.id) return r;
          if (alreadyCommitted) {
            return {
              ...r,
              softCommits: r.softCommits.filter((sc) => sc.userId !== user.id),
            };
          }
          return {
            ...r,
            softCommits: [
              ...r.softCommits,
              {
                id: `sc-${Date.now()}`,
                userId: user.id,
                userName: user.name,
                timestamp: new Date().toISOString(),
              },
            ],
          };
        })
      );

      setCommittedIds((prev) => {
        const next = new Set(prev);
        if (next.has(request.id)) {
          next.delete(request.id);
        } else {
          next.add(request.id);
        }
        return next;
      });

      // Update selected request if open
      if (selectedRequest?.id === request.id) {
        setSelectedRequest((prev) => {
          if (!prev) return prev;
          if (alreadyCommitted) {
            return {
              ...prev,
              softCommits: prev.softCommits.filter((sc) => sc.userId !== user.id),
            };
          }
          return {
            ...prev,
            softCommits: [
              ...prev.softCommits,
              {
                id: `sc-${Date.now()}`,
                userId: user.id,
                userName: user.name,
                timestamp: new Date().toISOString(),
              },
            ],
          };
        });
      }

      // Call API (fire and forget with error handling)
      try {
        await apiToggleCommit(request.id, user.id, user.name);
      } catch (err) {
        console.error('[Capacity] Failed to toggle commit:', err);
        // Revert the optimistic update for only the affected request
        // instead of calling loadRequests() which can wipe the list if backend is down
        setRequests((prev) =>
          prev.map((r) => {
            if (r.id !== request.id) return r;
            if (alreadyCommitted) {
              // Was removed optimistically — re-add the commit
              return {
                ...r,
                softCommits: [
                  ...r.softCommits,
                  {
                    id: `sc-${Date.now()}`,
                    userId: user.id,
                    userName: user.name,
                    timestamp: new Date().toISOString(),
                  },
                ],
              };
            }
            // Was added optimistically — remove it
            return {
              ...r,
              softCommits: r.softCommits.filter((sc) => sc.userId !== user.id),
            };
          })
        );
        setCommittedIds((prev) => {
          const next = new Set(prev);
          if (alreadyCommitted) {
            next.add(request.id);
          } else {
            next.delete(request.id);
          }
          return next;
        });
        // Also revert selected request if it was open.
        // Use the functional updater to read current state and avoid stale closure
        // over `selectedRequest` — the user may have switched to a different request
        // between the optimistic update and the error callback.
        setSelectedRequest((prev) => {
          if (!prev || prev.id !== request.id) return prev;
          if (alreadyCommitted) {
            return {
              ...prev,
              softCommits: [
                ...prev.softCommits,
                {
                  id: `sc-${Date.now()}`,
                  userId: user.id,
                  userName: user.name,
                  timestamp: new Date().toISOString(),
                },
              ],
            };
          }
          return {
            ...prev,
            softCommits: prev.softCommits.filter((sc) => sc.userId !== user.id),
          };
        });
      }
    },
    [committedIds]
  );

  const handleAddComment = useCallback(
    async (requestId: string, comment: RequestComment) => {
      // Optimistic update
      setRequests((prev) =>
        prev.map((r) =>
          r.id === requestId ? { ...r, comments: [...r.comments, comment] } : r
        )
      );

      if (selectedRequest?.id === requestId) {
        setSelectedRequest((prev) =>
          prev ? { ...prev, comments: [...prev.comments, comment] } : prev
        );
      }

      // Call API
      try {
        await apiAddComment(requestId, comment.author, comment.text);
      } catch (err) {
        console.error('[Capacity] Failed to add comment:', err);
        // Reload on error
        loadRequests();
      }
    },
    [selectedRequest, loadRequests]
  );

  const handleNewRequest = useCallback(
    async (request: CapacityRequest) => {
      // Optimistic update
      setRequests((prev) => [request, ...prev]);

      // Call API
      try {
        const created = await apiCreateRequest({
          requesterName: request.requesterName,
          requesterAccount: request.requesterAccount,
          gpuModel: request.gpuModel,
          vram: request.vram,
          osVersion: request.osVersion,
          cudaVersion: request.cudaVersion,
          count: request.count,
          pipeline: request.pipeline,
          startDate: request.startDate,
          endDate: request.endDate,
          validUntil: request.validUntil,
          hourlyRate: request.hourlyRate,
          reason: request.reason,
          riskLevel: request.riskLevel,
        });
        // Replace optimistic with server response
        setRequests((prev) =>
          prev.map((r) => (r.id === request.id ? created : r))
        );
      } catch (err) {
        console.error('[Capacity] Failed to create request:', err);
        // Remove optimistic entry on error
        setRequests((prev) => prev.filter((r) => r.id !== request.id));
      }
    },
    []
  );

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({ search: '', gpuModel: '', vramMin: '', pipeline: '' });
  };

  const sortOptions: { value: SortField; label: string }[] = [
    { value: 'newest', label: 'Newest First' },
    { value: 'gpuCount', label: 'Most GPUs' },
    { value: 'hourlyRate', label: 'Highest Rate' },
    { value: 'riskLevel', label: 'Highest Risk' },
    { value: 'mostCommits', label: 'Most Commits' },
    { value: 'deadline', label: 'Soonest Deadline' },
  ];

  const selectCls =
    'bg-bg-tertiary border border-[var(--border-color)] rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue transition-colors appearance-none cursor-pointer';

  // Loading state
  if (loading && requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 size={48} className="animate-spin text-accent-blue mb-4" />
        <p className="text-text-secondary">Loading capacity requests...</p>
      </div>
    );
  }

  // Error state
  if (error && requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <AlertCircle size={48} className="text-accent-rose mb-4" />
        <h3 className="text-lg font-bold text-text-primary mb-2">Failed to Load Requests</h3>
        <p className="text-text-secondary mb-4">{error}</p>
        <button
          onClick={loadRequests}
          className="flex items-center gap-2 px-4 py-2 bg-accent-blue text-white rounded-xl font-medium"
        >
          <RefreshCw size={16} />
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top bar: Title + Summary */}
      <div className="flex flex-col lg:flex-row lg:items-start gap-6">
        {/* Left: Title + subtitle */}
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-accent-blue/10 text-accent-blue rounded-xl">
              <Zap size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-outfit font-bold text-text-primary">
                Capacity Requests
              </h1>
              <p className="text-sm text-text-secondary">
                Browse GPU capacity needs and commit to supply
              </p>
            </div>
          </div>
        </div>

        {/* Right: Summary panel */}
        <div className="w-full lg:w-[380px] flex-shrink-0">
          <SummaryPanel summary={summary} />
        </div>
      </div>

      {/* Search, Filters & Sort bar */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
              size={16}
            />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
              placeholder="Search by name, GPU, pipeline, reason..."
              className="w-full bg-bg-secondary border border-[var(--border-color)] rounded-xl py-2.5 pl-10 pr-4 text-sm text-text-primary focus:outline-none focus:border-accent-blue transition-colors placeholder:text-text-secondary/50"
            />
            {filters.search && (
              <button
                onClick={() => updateFilter('search', '')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
              showFilters || hasActiveFilters
                ? 'bg-accent-blue/10 text-accent-blue border-accent-blue/30'
                : 'bg-bg-secondary text-text-secondary border-[var(--border-color)] hover:text-text-primary'
            }`}
          >
            <SlidersHorizontal size={15} />
            Filters
            {hasActiveFilters && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent-blue" />
            )}
          </button>

          {/* Sort dropdown */}
          <div className="flex items-center gap-2">
            <ArrowUpDown size={14} className="text-text-secondary flex-shrink-0" />
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              className={selectCls}
            >
              {sortOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* New Request button */}
          <button
            onClick={() => setShowNewRequestModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent-emerald text-white rounded-xl font-bold text-sm shadow-lg shadow-accent-emerald/20 hover:bg-accent-emerald/90 transition-all whitespace-nowrap"
          >
            <Plus size={16} /> New Request
          </button>
        </div>

        {/* Expanded filters */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="glass-card p-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="flex-1 min-w-[150px]">
                    <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1">
                      GPU Model
                    </label>
                    <select
                      value={filters.gpuModel}
                      onChange={(e) => updateFilter('gpuModel', e.target.value)}
                      className={selectCls + ' w-full'}
                    >
                      <option value="">All GPUs</option>
                      {availableGPUs.map((gpu) => (
                        <option key={gpu} value={gpu}>
                          {gpu}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[150px]">
                    <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1">
                      Min VRAM
                    </label>
                    <select
                      value={filters.vramMin}
                      onChange={(e) => updateFilter('vramMin', e.target.value)}
                      className={selectCls + ' w-full'}
                    >
                      <option value="">Any VRAM</option>
                      {VRAM_OPTIONS.map((v) => (
                        <option key={v} value={v}>
                          {v}+ GB
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[150px]">
                    <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1">
                      Pipeline
                    </label>
                    <select
                      value={filters.pipeline}
                      onChange={(e) => updateFilter('pipeline', e.target.value)}
                      className={selectCls + ' w-full'}
                    >
                      <option value="">All Pipelines</option>
                      {availablePipelines.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  {hasActiveFilters && (
                    <button
                      onClick={clearFilters}
                      className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-accent-rose hover:bg-accent-rose/10 rounded-lg transition-colors"
                    >
                      <X size={12} />
                      Clear All
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-secondary">
          Showing {filteredAndSorted.length} of {requests.length} request{requests.length !== 1 ? 's' : ''}
          {hasActiveFilters && (
            <span className="text-accent-blue ml-1">(filtered)</span>
          )}
        </p>
      </div>

      {/* Request cards grid - 3-4 per row */}
      {filteredAndSorted.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filteredAndSorted.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              onSelect={(r) => setSelectedRequest(r)}
              onThumbsUp={handleThumbsUp}
              hasCommitted={committedIds.has(req.id)}
            />
          ))}
        </div>
      ) : (
        <Card className="text-center py-16">
          <Zap size={48} className="mx-auto mb-4 text-text-secondary opacity-30" />
          <h3 className="text-lg font-bold text-text-primary mb-2">
            {hasActiveFilters ? 'No matching requests' : 'No active requests'}
          </h3>
          <p className="text-text-secondary mb-4">
            {hasActiveFilters
              ? 'Try adjusting your filters or search terms'
              : 'Create a new capacity request to get started'}
          </p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-4 py-2 text-sm font-medium text-accent-blue hover:bg-accent-blue/10 rounded-xl transition-colors"
            >
              Clear Filters
            </button>
          )}
        </Card>
      )}

      {/* Modals */}
      <NewRequestModal
        isOpen={showNewRequestModal}
        onClose={() => setShowNewRequestModal(false)}
        onSubmit={handleNewRequest}
      />

      {selectedRequest && (
        <RequestDetailModal
          request={selectedRequest}
          isOpen={!!selectedRequest}
          onClose={() => setSelectedRequest(null)}
          onThumbsUp={handleThumbsUp}
          onAddComment={handleAddComment}
          hasCommitted={committedIds.has(selectedRequest.id)}
        />
      )}
    </div>
  );
};

export default CapacityPage;
