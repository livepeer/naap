import React, { useState, useCallback, useEffect, useRef } from 'react';
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
import type { CapacityRequest, FilterState, SortField, RequestComment, SummaryData } from '../types';
import { VRAM_OPTIONS, GPU_MODELS, PIPELINE_OPTIONS } from '../types';
import { SummaryPanel } from '../components/SummaryPanel';
import { RequestCard } from '../components/RequestCard';
import { NewRequestModal } from '../components/NewRequestModal';
import { RequestDetailModal } from '../components/RequestDetailModal';
import {
  fetchRequests,
  createRequest as apiCreateRequest,
  commitCapacity as apiCommitCapacity,
  withdrawCommit as apiWithdrawCommit,
  addComment as apiAddComment,
  fetchCurrentUser,
  fetchSummary,
  type FetchRequestsParams,
  type CurrentUser,
} from '../lib/api';

const PAGE_SIZE = 20;

const EMPTY_SUMMARY: SummaryData = {
  totalRequests: 0,
  totalGPUsNeeded: 0,
  mostDesiredGPU: null,
  mostPopularPipeline: null,
  topRequestor: null,
  avgHourlyRate: 0,
};

export const CapacityPage: React.FC = () => {
  const [requests, setRequests] = useState<CapacityRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [committedIds, setCommittedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser>({ id: '', name: '' });
  const [summary, setSummary] = useState<SummaryData | null>(null);

  const [selectedRequest, setSelectedRequest] = useState<CapacityRequest | null>(null);
  const [showNewRequestModal, setShowNewRequestModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const [filters, setFilters] = useState<FilterState>({
    search: '',
    gpuModel: '',
    vramMin: '',
    pipeline: '',
  });
  const [sortField, setSortField] = useState<SortField>('newest');

  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => window.clearTimeout(id);
  }, [filters.search]);

  const requestSeq = useRef(0);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const requestsLenRef = useRef(0);
  const totalRef = useRef(0);
  requestsLenRef.current = requests.length;
  totalRef.current = total;

  const refreshSummary = useCallback(() => {
    fetchSummary()
      .then(setSummary)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshSummary();
  }, [refreshSummary]);

  const mergeCommittedFromRequests = useCallback((list: CapacityRequest[], userId: string) => {
    const userCommits = new Set<string>();
    list.forEach((req) => {
      if (req.softCommits?.some((sc) => sc.userId === userId)) {
        userCommits.add(req.id);
      }
    });
    return userCommits;
  }, []);

  const loadRequests = useCallback(
    async (userId: string) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setLoadingMore(false);
      setError(null);
      try {
        const params: FetchRequestsParams = {
          limit: PAGE_SIZE,
          offset: 0,
        };
        if (filters.gpuModel) params.gpuModel = filters.gpuModel;
        if (filters.pipeline) params.pipeline = filters.pipeline;
        if (filters.vramMin) params.vramMin = filters.vramMin;
        if (debouncedSearch) params.search = debouncedSearch;
        if (sortField) params.sort = sortField;

        const { requests: data, total: serverTotal } = await fetchRequests(params);
        if (seq !== requestSeq.current) return;
        setRequests(data);
        setTotal(serverTotal);
        setCommittedIds(mergeCommittedFromRequests(data, userId));
      } catch (err) {
        if (seq !== requestSeq.current) return;
        console.error('[Capacity] Failed to load requests:', err);
        setError(err instanceof Error ? err.message : 'Failed to load requests');
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
        }
      }
    },
    [filters.gpuModel, filters.pipeline, filters.vramMin, debouncedSearch, sortField, mergeCommittedFromRequests]
  );

  const loadMore = useCallback(
    async (userId: string) => {
      if (loadingMore || loading) return;
      const offset = requestsLenRef.current;
      if (offset >= totalRef.current) return;
      const seq = requestSeq.current;
      setLoadingMore(true);
      try {
        const params: FetchRequestsParams = {
          limit: PAGE_SIZE,
          offset,
        };
        if (filters.gpuModel) params.gpuModel = filters.gpuModel;
        if (filters.pipeline) params.pipeline = filters.pipeline;
        if (filters.vramMin) params.vramMin = filters.vramMin;
        if (debouncedSearch) params.search = debouncedSearch;
        if (sortField) params.sort = sortField;

        const { requests: nextBatch, total: serverTotal } = await fetchRequests(params);
        if (seq !== requestSeq.current) return;
        setTotal(serverTotal);
        if (nextBatch.length === 0) {
          return;
        }
        setRequests((prev) => [...prev, ...nextBatch]);
        setCommittedIds((prev) => {
          const next = new Set(prev);
          nextBatch.forEach((req) => {
            if (req.softCommits?.some((sc) => sc.userId === userId)) {
              next.add(req.id);
            }
          });
          return next;
        });
      } catch (err) {
        console.error('[Capacity] Failed to load more:', err);
      } finally {
        if (seq === requestSeq.current) {
          setLoadingMore(false);
        }
      }
    },
    [
      loadingMore,
      loading,
      filters.gpuModel,
      filters.pipeline,
      filters.vramMin,
      debouncedSearch,
      sortField,
    ]
  );

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then(user => {
        if (cancelled) return;
        setCurrentUser(user);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('[Capacity] Failed to load current user:', err);
        setError(err instanceof Error ? err.message : 'Failed to load current user');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!currentUser.id) return;
    loadRequests(currentUser.id);
  }, [currentUser.id, loadRequests]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !currentUser.id) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore(currentUser.id);
        }
      },
      { root: null, rootMargin: '240px', threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [currentUser.id, loadMore]);

  const availableGPUs =
    summary?.distinctGpuModels && summary.distinctGpuModels.length > 0
      ? summary.distinctGpuModels
      : GPU_MODELS;
  const availablePipelines =
    summary?.distinctPipelines && summary.distinctPipelines.length > 0
      ? summary.distinctPipelines
      : PIPELINE_OPTIONS;

  const hasActiveFilters = filters.gpuModel || filters.vramMin || filters.pipeline;
  const hasAnyListFilter = hasActiveFilters || Boolean(filters.search.trim());

  const getUserCommit = useCallback(
    (request: CapacityRequest) => {
      return request.softCommits.find(sc => sc.userId === currentUser.id);
    },
    [currentUser.id]
  );

  const applyCommitUpdate = useCallback(
    (requestId: string, updater: (commits: CapacityRequest['softCommits']) => CapacityRequest['softCommits']) => {
      setRequests(prev =>
        prev.map(r => (r.id === requestId ? { ...r, softCommits: updater(r.softCommits) } : r))
      );
      setSelectedRequest(prev => {
        if (!prev || prev.id !== requestId) return prev;
        return { ...prev, softCommits: updater(prev.softCommits) };
      });
    },
    []
  );

  const mutationSeq = useRef<Record<string, number>>({});
  const nextMutationSeq = (requestId: string) => {
    const next = (mutationSeq.current[requestId] ?? 0) + 1;
    mutationSeq.current[requestId] = next;
    return next;
  };

  const handleCommit = useCallback(
    async (request: CapacityRequest, gpuCount: number) => {
      const mutationId = nextMutationSeq(request.id);
      const existing = getUserCommit(request);
      const optimisticCommit = {
        id: existing?.id || `sc-${Date.now()}`,
        userId: currentUser.id,
        userName: currentUser.name,
        gpuCount,
        timestamp: existing?.timestamp || new Date().toISOString(),
      };

      applyCommitUpdate(request.id, (commits) => {
        const filtered = commits.filter(sc => sc.userId !== currentUser.id);
        return [...filtered, optimisticCommit];
      });
      setCommittedIds(prev => new Set(prev).add(request.id));

      try {
        const result = await apiCommitCapacity(request.id, gpuCount, currentUser.name);
        if (mutationSeq.current[request.id] !== mutationId) return;
        if (result.commit) {
          applyCommitUpdate(request.id, (commits) => {
            const filtered = commits.filter(sc => sc.userId !== currentUser.id);
            return [...filtered, result.commit!];
          });
        }
      } catch (err) {
        if (mutationSeq.current[request.id] !== mutationId) return;
        console.error('[Capacity] Failed to commit:', err);
        applyCommitUpdate(request.id, (commits) =>
          existing
            ? commits.map(sc => (sc.userId === currentUser.id ? existing : sc))
            : commits.filter(sc => sc.userId !== currentUser.id)
        );
        if (!existing) {
          setCommittedIds(prev => {
            const next = new Set(prev);
            next.delete(request.id);
            return next;
          });
        }
      }
    },
    [currentUser, getUserCommit, applyCommitUpdate]
  );

  const handleWithdraw = useCallback(
    async (request: CapacityRequest) => {
      const mutationId = nextMutationSeq(request.id);
      const existing = getUserCommit(request);
      if (!existing) return;

      applyCommitUpdate(request.id, (commits) =>
        commits.filter(sc => sc.userId !== currentUser.id)
      );
      setCommittedIds(prev => {
        const next = new Set(prev);
        next.delete(request.id);
        return next;
      });

      try {
        await apiWithdrawCommit(request.id);
      } catch (err) {
        if (mutationSeq.current[request.id] !== mutationId) return;
        console.error('[Capacity] Failed to withdraw:', err);
        applyCommitUpdate(request.id, (commits) => {
          const filtered = commits.filter(sc => sc.userId !== currentUser.id);
          return [...filtered, existing];
        });
        setCommittedIds(prev => new Set(prev).add(request.id));
      }
    },
    [currentUser.id, getUserCommit, applyCommitUpdate]
  );

  const handleAddComment = useCallback(
    async (requestId: string, comment: RequestComment) => {
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

      try {
        await apiAddComment(requestId, comment.author, comment.text);
      } catch (err) {
        console.error('[Capacity] Failed to add comment:', err);
        loadRequests(currentUser.id);
      }
    },
    [selectedRequest, loadRequests, currentUser.id]
  );

  const handleNewRequest = useCallback(
    async (request: CapacityRequest) => {
      try {
        await apiCreateRequest({
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
        refreshSummary();
        await loadRequests(currentUser.id);
      } catch (err) {
        console.error('[Capacity] Failed to create request:', err);
      }
    },
    [currentUser.id, loadRequests, refreshSummary]
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

  if (loading && requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-text-secondary mb-4" />
        <p className="text-text-secondary">Loading capacity requests...</p>
      </div>
    );
  }

  if (error && requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <AlertCircle size={48} className="text-accent-rose mb-4" />
        <h3 className="text-lg font-bold text-text-primary mb-2">Failed to Load Requests</h3>
        <p className="text-text-secondary mb-4">{error}</p>
        <button
          onClick={() => loadRequests(currentUser.id)}
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
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-accent-blue/10 text-accent-blue rounded-xl">
              <Zap size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-text-primary">
                Capacity Requests
              </h1>
              <p className="text-sm text-text-secondary">
                Browse GPU capacity needs and commit to supply
              </p>
            </div>
          </div>
        </div>

        <div className="w-full lg:w-[380px] flex-shrink-0">
          <SummaryPanel summary={summary ?? EMPTY_SUMMARY} />
        </div>
      </div>

      {/* Search, Filters & Sort bar */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
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

          <button
            onClick={() => setShowNewRequestModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent-emerald text-white rounded-xl font-bold text-sm shadow-lg shadow-accent-emerald/20 hover:bg-accent-emerald/90 transition-all whitespace-nowrap"
          >
            <Plus size={16} /> New Request
          </button>
        </div>

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
          Showing {requests.length} of {total} request{total !== 1 ? 's' : ''}
          {hasAnyListFilter && (
            <span className="text-accent-blue ml-1">(filtered)</span>
          )}
        </p>
      </div>

      {/* Request cards grid */}
      {requests.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {requests.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              onSelect={(r) => setSelectedRequest(r)}
              onCommit={handleCommit}
              onWithdraw={handleWithdraw}
              hasCommitted={committedIds.has(req.id)}
              userCommitCount={getUserCommit(req)?.gpuCount}
            />
          ))}
        </div>
      ) : null}

      {requests.length > 0 && total > requests.length ? (
        <div className="flex flex-col items-center gap-2 py-4">
          <div ref={loadMoreRef} className="h-1 w-full" aria-hidden />
          {loadingMore ? (
            <Loader2 size={20} className="animate-spin text-text-secondary" />
          ) : (
            <p className="text-xs text-text-secondary">Scroll for more</p>
          )}
        </div>
      ) : null}

      {requests.length === 0 && !loading ? (
        <Card className="text-center py-16">
          <Zap size={48} className="mx-auto mb-4 text-text-secondary opacity-30" />
          <h3 className="text-lg font-bold text-text-primary mb-2">
            {hasAnyListFilter ? 'No matching requests' : 'No active requests'}
          </h3>
          <p className="text-text-secondary mb-4">
            {hasAnyListFilter
              ? 'Try adjusting your filters or search terms'
              : 'Create a new capacity request to get started'}
          </p>
          {hasAnyListFilter && (
            <button
              onClick={clearFilters}
              className="px-4 py-2 text-sm font-medium text-accent-blue hover:bg-accent-blue/10 rounded-xl transition-colors"
            >
              Clear Filters
            </button>
          )}
        </Card>
      ) : null}

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
          onCommit={handleCommit}
          onWithdraw={handleWithdraw}
          onAddComment={handleAddComment}
          hasCommitted={committedIds.has(selectedRequest.id)}
          userCommitCount={getUserCommit(selectedRequest)?.gpuCount}
          currentUserName={currentUser.name}
        />
      )}
    </div>
  );
};

export default CapacityPage;
