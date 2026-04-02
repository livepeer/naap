import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Box,
  Key,
  BarChart3,
  BookOpen,
  Plus,
  Copy,
  Trash2,
  Search,
  Check,
  AlertTriangle,
  Shield,
  Loader2,
  CreditCard,
  Cloud,
  Globe,
  Cpu,
  Users,
  X,
} from 'lucide-react';
import { Card, Badge, Modal } from '@naap/ui';
import type { NetworkModel } from '@naap/plugin-sdk';

type TabId = 'models' | 'api-keys' | 'usage' | 'docs';

const TAB_PATH_SEGMENT: Record<TabId, string> = {
  models: 'models',
  'api-keys': 'keys',
  usage: 'usage',
  docs: 'docs',
};

const TAB_FROM_SEGMENT: Record<string, TabId> = {
  models: 'models',
  keys: 'api-keys',
  usage: 'usage',
  docs: 'docs',
  'api-keys': 'api-keys',
};

function resolveTabFromPath(pathname: string): TabId {
  const parts = pathname.split('/').filter(Boolean);
  const maybeRoot = parts[0];
  const maybeTab = parts[1];
  if (maybeRoot !== 'developer') {
    return 'models';
  }
  return TAB_FROM_SEGMENT[maybeTab ?? ''] ?? 'models';
}

function getPathForTab(tab: TabId): string {
  return `/developer/${TAB_PATH_SEGMENT[tab]}`;
}

interface ApiKeyProject {
  id: string;
  name: string;
  isDefault: boolean;
}

interface ApiKey {
  id: string;
  project: ApiKeyProject;
  billingProvider: { id: string; slug: string; displayName: string };
  status: string;
  keyPrefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface BillingProviderInfo {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  icon: string | null;
  authType: string;
}

interface ProjectInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

async function fetchCsrfToken(): Promise<string> {
  try {
    const res = await fetch('/api/v1/auth/csrf', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      return data.data?.token || data.token || '';
    }
  } catch (err) {
    console.warn('Failed to fetch CSRF token:', err);
  }
  return '';
}

function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      window.clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
      reject(new Error('Polling aborted'));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener('abort', onAbort);
  });
}

const tabs = [
  { id: 'models' as TabId, label: 'Models', icon: <Box size={14} /> },
  { id: 'api-keys' as TabId, label: 'API Keys', icon: <Key size={14} /> },
  { id: 'usage' as TabId, label: 'Usage & Billing', icon: <BarChart3 size={14} /> },
  { id: 'docs' as TabId, label: 'Docs', icon: <BookOpen size={14} /> },
];

const selectClassName =
  'w-full bg-bg-tertiary border border-white/10 rounded-lg py-2 px-3 text-sm text-text-primary focus:outline-none focus:border-accent-blue appearance-none cursor-pointer';

const inputClassName =
  'w-full bg-bg-tertiary border border-white/10 rounded-lg py-2 px-3 text-sm text-text-primary focus:outline-none focus:border-accent-blue';

export const DeveloperView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>(() => resolveTabFromPath(window.location.pathname));
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [_loading, setLoading] = useState(true);
  const [showRevoked, setShowRevoked] = useState(false);
  const [projectFilterId, setProjectFilterId] = useState<'__all__' | string>('__all__');
  const [providerFilterId, setProviderFilterId] = useState<'__all__' | string>('__all__');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createStep, setCreateStep] = useState<'form' | 'oauth' | 'success'>('form');
  const [createdRawKey, setCreatedRawKey] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [billingProviders, setBillingProviders] = useState<BillingProviderInfo[] | null>(null);
  const [billingProvidersError, setBillingProvidersError] = useState(false);
  const [modalDataLoading, setModalDataLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [selectedBillingProviderId, setSelectedBillingProviderId] = useState('');

  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const pollAbortControllerRef = useRef<AbortController | null>(null);

  const [networkModels, setNetworkModels] = useState<NetworkModel[]>([]);
  const [networkModelsLoading, setNetworkModelsLoading] = useState(false);
  const [networkModelsError, setNetworkModelsError] = useState<string | null>(null);
  const [networkModelSearch, setNetworkModelSearch] = useState('');
  const [pipelineFilter, setPipelineFilter] = useState<string>('all');
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  const copyCell = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCell(key);
      setTimeout(() => setCopiedCell((prev) => (prev === key ? null : prev)), 1500);
    } catch { /* ignore */ }
  }, []);

  const revokedCount = useMemo(
    () => apiKeys.filter(k => (k.status || '').toUpperCase() === 'REVOKED').length,
    [apiKeys]
  );

  const providerOptions = useMemo(() => {
    if (billingProviders && billingProviders.length > 0) {
      return billingProviders
        .map((provider) => ({ id: provider.id, displayName: provider.displayName }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

    const seen = new Set<string>();
    return apiKeys
      .map((key) => key.billingProvider)
      .filter((provider): provider is ApiKey['billingProvider'] => {
        if (!provider?.id || seen.has(provider.id)) return false;
        seen.add(provider.id);
        return true;
      })
      .map((provider) => ({ id: provider.id, displayName: provider.displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [billingProviders, apiKeys]);

  const displayedKeys = useMemo(() => {
    const filteredByRevoked = showRevoked
      ? apiKeys
      : apiKeys.filter(k => (k.status || '').toUpperCase() !== 'REVOKED');
    const filteredByProject = projectFilterId === '__all__'
      ? filteredByRevoked
      : filteredByRevoked.filter(k => k.project?.id === projectFilterId);
    const filtered = providerFilterId === '__all__'
      ? filteredByProject
      : filteredByProject.filter(k => k.billingProvider?.id === providerFilterId);
    return [...filtered].sort((a, b) => {
      const aDefault = a.project?.isDefault ? 1 : 0;
      const bDefault = b.project?.isDefault ? 1 : 0;
      if (aDefault !== bDefault) return bDefault - aDefault;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [apiKeys, showRevoked, projectFilterId, providerFilterId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [keysRes, projectsRes] = await Promise.all([
        fetch('/api/v1/developer/keys'),
        fetch('/api/v1/developer/projects'),
      ]);
      if (!keysRes.ok) {
        throw new Error(`Failed to load API keys (HTTP ${keysRes.status})`);
      }
      if (!projectsRes.ok) {
        throw new Error(`Failed to load projects (HTTP ${projectsRes.status})`);
      }
      const [keysJson, projectsJson] = await Promise.all([
        keysRes.json(),
        projectsRes.json(),
      ]);
      setApiKeys((keysJson.data ?? keysJson).keys || []);
      setProjects((projectsJson.data ?? projectsJson).projects || []);
    } catch (err) {
      console.error('Failed to load data:', err);
      setApiKeys([]);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => () => {
    pollAbortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(resolveTabFromPath(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    const canonicalPath = getPathForTab(activeTab);
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState(window.history.state, '', canonicalPath);
    }
  }, [activeTab]);

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    const targetPath = getPathForTab(tab);
    if (window.location.pathname !== targetPath) {
      window.history.pushState(window.history.state, '', targetPath);
    }
  }, []);

  const loadNetworkModels = useCallback(async () => {
    setNetworkModelsLoading(true);
    setNetworkModelsError(null);
    try {
      const res = await fetch('/api/v1/developer/network-models?limit=all');
      if (!res.ok) {
        setNetworkModels([]);
        setNetworkModelsError(`Failed to load models (HTTP ${res.status})`);
        return;
      }
      const json = await res.json();
      const payload = json.data ?? json;
      if (!Array.isArray(payload?.models)) {
        setNetworkModels([]);
        setNetworkModelsError('Invalid response from server');
        return;
      }
      setNetworkModels(payload.models);
    } catch (err) {
      console.error('Failed to load network models:', err);
      setNetworkModels([]);
      setNetworkModelsError('Network error loading models');
    } finally {
      setNetworkModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'models') loadNetworkModels();
  }, [activeTab, loadNetworkModels]);

  const pipelineOptions = useMemo(() => {
    const pipelines = new Set(networkModels.map((m) => m.Pipeline));
    return Array.from(pipelines).sort();
  }, [networkModels]);

  useEffect(() => {
    if (pipelineFilter !== 'all' && !pipelineOptions.includes(pipelineFilter)) {
      setPipelineFilter('all');
    }
  }, [pipelineFilter, pipelineOptions]);

  const filteredNetworkModels = useMemo(() => {
    let result = networkModels;
    if (pipelineFilter !== 'all') {
      result = result.filter((m) => m.Pipeline === pipelineFilter);
    }
    if (networkModelSearch) {
      const q = networkModelSearch.toLowerCase();
      result = result.filter(
        (m) =>
          m.Model.toLowerCase().includes(q) ||
          m.Pipeline.toLowerCase().includes(q)
      );
    }
    return result;
  }, [networkModels, pipelineFilter, networkModelSearch]);

  const loadBillingProviders = useCallback(async () => {
    setBillingProvidersError(false);
    try {
      const res = await fetch('/api/v1/billing-providers');
      if (!res.ok) {
        console.error('Failed to load billing providers:', res.status);
        setBillingProvidersError(true);
        return;
      }
      const json = await res.json();
      setBillingProviders((json.data ?? json).providers || []);
    } catch (err) {
      console.error('Failed to load billing providers:', err);
      setBillingProvidersError(true);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'usage' || activeTab === 'api-keys') loadBillingProviders();
  }, [activeTab, loadBillingProviders]);

  const loadModalData = useCallback(async () => {
    setModalDataLoading(true);
    try {
      const [projectsRes, bpRes] = await Promise.all([
        fetch('/api/v1/developer/projects'),
        fetch('/api/v1/billing-providers'),
      ]);
      if (!projectsRes.ok || !bpRes.ok) {
        console.error(
          'Failed to load modal data:',
          `projects HTTP ${projectsRes.status}, billing HTTP ${bpRes.status}`,
        );
        if (!projectsRes.ok) setProjects([]);
        if (!bpRes.ok) setBillingProvidersError(true);
        return;
      }
      setBillingProvidersError(false);
      const [projectsJson, bpJson] = await Promise.all([
        projectsRes.json(),
        bpRes.json(),
      ]);
      const projectList: ProjectInfo[] = (projectsJson.data ?? projectsJson).projects || [];
      const providerList: BillingProviderInfo[] = (bpJson.data ?? bpJson).providers || [];
      setProjects(projectList);
      setBillingProviders(providerList);
      if (projectList.length > 0) {
        setSelectedProjectId((projectList.find(p => p.isDefault) || projectList[0]).id);
      }
      if (providerList.length > 0) {
        setSelectedBillingProviderId(providerList[0].id);
      }
    } catch (err) {
      console.error('Failed to load modal data:', err);
      setProjects([]);
      setBillingProviders([]);
    } finally {
      setModalDataLoading(false);
    }
  }, []);

  const openCreateModal = useCallback(() => {
    setCreateStep('form');
    setCreatedRawKey('');
    setCreateError('');
    setCreating(false);
    setKeyCopied(false);
    setSelectedProjectId('');
    setNewProjectName('');
    setNewKeyLabel('');
    setSelectedBillingProviderId('');
    setShowCreateModal(true);
    loadModalData();
  }, [loadModalData]);

  const closeCreateModal = useCallback(() => {
    pollAbortControllerRef.current?.abort();
    setShowCreateModal(false);
    if (createStep === 'success') loadData();
  }, [createStep, loadData]);

  const handleCreateKey = useCallback(async () => {
    setCreateError('');
    const resolvedProjectId = selectedProjectId === '__new__' ? undefined : selectedProjectId;
    const resolvedProjectName = selectedProjectId === '__new__' ? newProjectName.trim() : undefined;

    if (selectedProjectId === '__new__' && !resolvedProjectName) {
      setCreateError('Please enter a project name.');
      return;
    }
    if (!selectedBillingProviderId) {
      setCreateError('Please select a billing provider.');
      return;
    }
    const selectedProvider = billingProviders?.find(bp => bp.id === selectedBillingProviderId);
    if (!selectedProvider) {
      setCreateError('Selected billing provider not found.');
      return;
    }
    const providerSlug = selectedProvider.slug;

    setCreating(true);
    setCreateStep('oauth');

    try {
      pollAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      pollAbortControllerRef.current = abortController;

      const startCsrfToken = await fetchCsrfToken();
      const startRes = await fetch(`/api/v1/auth/providers/${encodeURIComponent(providerSlug)}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': startCsrfToken },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!startRes.ok) {
        setCreateError('Failed to start authentication with billing provider.');
        setCreateStep('form');
        setCreating(false);
        return;
      }
      const startData = await startRes.json();
      const authUrl = startData.data?.auth_url || startData.auth_url;
      const loginSessionId = startData.data?.login_session_id || startData.login_session_id;
      if (!authUrl || !loginSessionId) {
        setCreateError('Missing auth URL from billing provider.');
        setCreateStep('form');
        setCreating(false);
        return;
      }

      window.open(authUrl, '_blank', 'noopener,noreferrer');

      const pollInterval = startData.data?.poll_after_ms ?? startData.poll_after_ms ?? 2000;
      const pollTimeout = (startData.data?.expires_in ?? startData.expires_in ?? 180) * 1000;
      const started = Date.now();
      let providerApiKey: string | null = null;

      while (Date.now() - started < pollTimeout && !abortController.signal.aborted) {
        try {
          await delayWithAbort(pollInterval, abortController.signal);
        } catch {
          break;
        }

        if (abortController.signal.aborted) {
          break;
        }

        try {
          const pollRes = await fetch(
            `/api/v1/auth/providers/${encodeURIComponent(providerSlug)}/result?login_session_id=${encodeURIComponent(
              loginSessionId
            )}`,
            { signal: abortController.signal }
          );
          if (!pollRes.ok) break;
          const pollData = await pollRes.json();
          const status = pollData.data?.status || pollData.status;
          if (status === 'complete') {
            providerApiKey = pollData.data?.access_token || pollData.access_token;
            break;
          }
          if (status === 'redeemed') {
            setCreateError('Authentication redeemed. Please request a new token.');
            setCreateStep('form');
            setCreating(false);
            return;
          }
          if (status === 'expired' || status === 'denied') {
            setCreateError(`Authentication ${status}. Please try again.`);
            setCreateStep('form');
            setCreating(false);
            return;
          }
        } catch {
          break;
        }
      }

      if (abortController.signal.aborted) {
        return;
      }

      if (!providerApiKey) {
        setCreateError('Authentication timed out. Please try again.');
        setCreateStep('form');
        setCreating(false);
        return;
      }

      const csrfToken = await fetchCsrfToken();
      const res = await fetch('/api/v1/developer/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        credentials: 'include',
        body: JSON.stringify({
          billingProviderId: selectedBillingProviderId,
          rawApiKey: providerApiKey,
          projectId: resolvedProjectId || undefined,
          projectName: resolvedProjectName || undefined,
          label: newKeyLabel.trim() || undefined,
        }),
      });
      const json = await res.json();
      const payload = json.data ?? json;

      if (!res.ok) {
        setCreateError(payload.error || json.error || 'Failed to create API key');
        setCreateStep('form');
        return;
      }

      setCreatedRawKey(providerApiKey);
      setCreateStep('success');
    } catch (err) {
      if (pollAbortControllerRef.current?.signal.aborted) {
        return;
      }
      console.error('Error creating key:', err);
      setCreateError('Network error. Please try again.');
      setCreateStep('form');
    } finally {
      pollAbortControllerRef.current = null;
      setCreating(false);
    }
  }, [selectedProjectId, newProjectName, newKeyLabel, selectedBillingProviderId, billingProviders]);

  const handleCopyKey = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(createdRawKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    } catch { /* fallback */ }
  }, [createdRawKey]);

  const handleRevokeKey = useCallback(async () => {
    if (!revokeKeyId) return;
    setRevoking(true);
    try {
      const csrfToken = await fetchCsrfToken();
      const res = await fetch(`/api/v1/developer/keys/${revokeKeyId}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken },
        credentials: 'include',
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error('Error revoking key:', err);
    } finally {
      setRevoking(false);
      setRevokeKeyId(null);
    }
  }, [revokeKeyId, loadData]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Developer API Manager</h1>
        <p className="text-[13px] text-text-secondary mt-1">Explore models, manage API keys, and track usage</p>
      </div>
      <div className="border-b border-white/10">
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-medium transition-all border-b-2 ${activeTab === tab.id ? 'text-accent-emerald' : 'text-text-secondary hover:text-text-primary border-transparent'}`}
              style={{ marginBottom: '-1px', borderBottomColor: activeTab === tab.id ? 'var(--accent-emerald)' : 'transparent' }}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </nav>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.15 }}>

          {activeTab === 'models' && (
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Globe size={14} className="text-accent-blue" />
                  <h2 className="text-sm font-semibold text-text-primary">Network Models</h2>
                  <span className="text-xs text-text-secondary">naap-api /v1/net/models</span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 max-w-md">
                    <label htmlFor="network-model-search" className="sr-only">
                      Search network models by name or pipeline
                    </label>
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
                      size={14}
                      aria-hidden
                    />
                    <input
                      id="network-model-search"
                      type="text"
                      placeholder="Search models..."
                      value={networkModelSearch}
                      onChange={(e) => setNetworkModelSearch(e.target.value)}
                      autoComplete="off"
                      className="w-full bg-bg-secondary border border-white/10 rounded-lg py-2 pl-9 pr-3 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary focus:border-accent-blue"
                    />
                    {networkModelSearch && (
                      <button
                        type="button"
                        onClick={() => setNetworkModelSearch('')}
                        aria-label="Clear search"
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-secondary hover:text-text-primary focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary"
                      >
                        <X size={12} aria-hidden />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setPipelineFilter('all')}
                      aria-pressed={pipelineFilter === 'all'}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                        pipelineFilter === 'all'
                          ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/30'
                          : 'bg-bg-tertiary text-text-secondary border border-white/10 hover:border-white/20'
                      }`}
                    >
                      All Pipelines
                    </button>
                    {pipelineOptions.map((pipeline) => (
                      <button
                        type="button"
                        key={pipeline}
                        onClick={() => setPipelineFilter(pipeline === pipelineFilter ? 'all' : pipeline)}
                        aria-pressed={pipelineFilter === pipeline}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                          pipelineFilter === pipeline
                            ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/30'
                            : 'bg-bg-tertiary text-text-secondary border border-white/10 hover:border-white/20'
                        }`}
                      >
                        {pipeline}
                      </button>
                    ))}
                  </div>
                </div>

                {networkModelsLoading ? (
                  <Card>
                    <div className="flex items-center justify-center gap-3 py-8">
                      <Loader2 size={16} className="animate-spin text-text-secondary" />
                      <span className="text-sm text-text-secondary">Loading models...</span>
                    </div>
                  </Card>
                ) : networkModelsError ? (
                  <Card>
                    <div className="flex items-center justify-center gap-3 py-6">
                      <AlertTriangle size={16} className="text-accent-rose" />
                      <span className="text-sm text-accent-rose">{networkModelsError}</span>
                      <button onClick={loadNetworkModels} className="text-xs text-text-secondary hover:text-accent-blue transition-colors ml-2">Retry</button>
                    </div>
                  </Card>
                ) : filteredNetworkModels.length === 0 ? (
                  <Card>
                    <div className="text-center py-6 text-text-secondary">
                      <Globe size={24} className="mx-auto mb-3 opacity-30" />
                      <p className="text-sm">{networkModelSearch || pipelineFilter !== 'all' ? 'No models match your search' : 'No models available'}</p>
                    </div>
                  </Card>
                ) : (
                  <Card>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-text-secondary">
                        {filteredNetworkModels.length} model{filteredNetworkModels.length !== 1 ? 's' : ''}
                        {(networkModelSearch || pipelineFilter !== 'all') && ` (filtered from ${networkModels.length})`}
                      </span>
                      <button
                        onClick={loadNetworkModels}
                        className="text-xs text-text-secondary hover:text-accent-blue transition-colors"
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wider text-text-secondary border-b border-white/10">
                            <th className="pb-3 font-medium">Model</th>
                            <th className="pb-3 font-medium">Pipeline</th>
                            <th className="pb-3 font-medium text-right">Warm Orchestrators</th>
                            <th className="pb-3 font-medium text-right">Total Capacity</th>
                            <th className="pb-3 font-medium text-right">Avg Price (wei/px)</th>
                            <th className="pb-3 font-medium text-right">Price Range (wei/px)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {filteredNetworkModels.map((model) => (
                            <tr key={`${model.Pipeline}-${model.Model}`} className="hover:bg-white/5 transition-colors">
                              <td className="py-3 pr-4">
                                <div className="flex items-center gap-2 group">
                                  <Cpu size={12} className="text-accent-emerald flex-shrink-0" />
                                  <span className="text-sm font-medium text-text-primary font-mono">{model.Model}</span>
                                  <button
                                    type="button"
                                    onClick={() => copyCell(`model-${model.Pipeline}-${model.Model}`, model.Model)}
                                    className="rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary"
                                    title="Copy model name"
                                    aria-label={`Copy model name ${model.Model}`}
                                  >
                                    {copiedCell === `model-${model.Pipeline}-${model.Model}` ? <Check size={12} className="text-accent-emerald" aria-hidden /> : <Copy size={12} aria-hidden />}
                                  </button>
                                </div>
                              </td>
                              <td className="py-3 pr-4">
                                <div className="flex items-center gap-1.5 group">
                                  <Badge variant="secondary">{model.Pipeline}</Badge>
                                  <button
                                    type="button"
                                    onClick={() => copyCell(`pipeline-${model.Pipeline}-${model.Model}`, model.Pipeline)}
                                    className="rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary"
                                    title="Copy pipeline name"
                                    aria-label={`Copy pipeline name ${model.Pipeline}`}
                                  >
                                    {copiedCell === `pipeline-${model.Pipeline}-${model.Model}` ? <Check size={12} className="text-accent-emerald" aria-hidden /> : <Copy size={12} aria-hidden />}
                                  </button>
                                </div>
                              </td>
                              <td className="py-3 pr-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <Users size={12} className="text-accent-blue" />
                                  <span className="text-sm font-mono text-text-primary">{model.WarmOrchCount}</span>
                                </div>
                              </td>
                              <td className="py-3 pr-4 text-right">
                                <span className="text-sm font-mono text-text-primary">{model.TotalCapacity}</span>
                              </td>
                              <td className="py-3 pr-4 text-right">
                                <span className="text-sm font-mono text-accent-emerald">{model.PriceAvgWeiPerPixel.toLocaleString()}</span>
                              </td>
                              <td className="py-3 text-right">
                                <span className="text-sm font-mono text-text-secondary">
                                  {model.PriceMinWeiPerPixel.toLocaleString()} – {model.PriceMaxWeiPerPixel.toLocaleString()}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}
              </div>
            </div>
          )}

          {activeTab === 'api-keys' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-text-primary">{displayedKeys.length} API key{displayedKeys.length !== 1 ? 's' : ''}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary">Project</span>
                    <select
                      value={projectFilterId}
                      onChange={(e) => setProjectFilterId(e.target.value)}
                      className="bg-bg-tertiary border border-white/10 rounded-md py-1.5 px-2 text-xs text-text-primary focus:outline-none focus:border-accent-blue appearance-none cursor-pointer"
                    >
                      <option value="__all__">All projects</option>
                      {projects
                        .slice()
                        .sort((a, b) => {
                          const aDefault = a.isDefault ? 1 : 0;
                          const bDefault = b.isDefault ? 1 : 0;
                          if (aDefault !== bDefault) return bDefault - aDefault;
                          return a.name.localeCompare(b.name);
                        })
                        .map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name}{p.isDefault ? ' (Default)' : ''}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary">Provider</span>
                    <select
                      value={providerFilterId}
                      onChange={(e) => setProviderFilterId(e.target.value)}
                      className="bg-bg-tertiary border border-white/10 rounded-md py-1.5 px-2 text-xs text-text-primary focus:outline-none focus:border-accent-blue appearance-none cursor-pointer"
                    >
                      <option value="__all__">All providers</option>
                      {providerOptions.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                  {revokedCount > 0 && (
                    <button onClick={() => setShowRevoked(!showRevoked)}
                      className="text-sm text-text-secondary hover:text-text-primary transition-colors">
                      {showRevoked ? 'Hide revoked' : `Show revoked (${revokedCount})`}
                    </button>
                  )}
                </div>
                <button onClick={openCreateModal} className="flex items-center gap-2 px-3 py-1.5 bg-accent-emerald text-white rounded-md text-xs font-medium hover:bg-accent-emerald/90 transition-all">
                  <Plus size={14} /> Create Key
                </button>
              </div>
              {displayedKeys.length > 0 ? (
                <Card>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wider text-text-secondary border-b border-white/10">
                          <th className="pb-3 font-medium">Name</th>
                          <th className="pb-3 font-medium">Project</th>
                          <th className="pb-3 font-medium">Provider</th>
                          <th className="pb-3 font-medium">Secret Key</th>
                          <th className="pb-3 font-medium">Created</th>
                          <th className="pb-3 font-medium text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {displayedKeys.map((key) => (
                          <tr key={key.id}>
                            <td className="py-3 pr-4">
                              <span className="text-sm font-medium text-text-primary">{key.label || key.keyPrefix}</span>
                            </td>
                            <td className="py-3 pr-4">
                              {key.project ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-text-secondary">{key.project.name}</span>
                                  {key.project.isDefault && (
                                    <Badge variant="emerald">Default</Badge>
                                  )}
                                </div>
                              ) : (
                                <span className="text-sm text-text-secondary">—</span>
                              )}
                            </td>
                            <td className="py-3 pr-4">
                              <span className="text-sm text-text-secondary">
                                {key.billingProvider?.displayName || '—'}
                              </span>
                            </td>
                            <td className="py-3 pr-4">
                              <span className="text-sm text-text-secondary font-mono">{key.keyPrefix}</span>
                            </td>
                            <td className="py-3 pr-4">
                              <span className="text-sm text-text-secondary">
                                {new Date(key.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            </td>
                            <td className="py-3">
                              <div className="flex items-center justify-end gap-2">
                                <Badge variant={key.status === 'ACTIVE' || key.status === 'active' ? 'emerald' : 'rose'}>{key.status}</Badge>
                                {(key.status || '').toUpperCase() !== 'REVOKED' && (
                                  <button onClick={() => setRevokeKeyId(key.id)}
                                    className="p-1.5 hover:bg-white/5 rounded-md text-accent-rose">
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ) : (
                <Card>
                  <div className="text-center py-6 text-text-secondary">
                    No API keys yet. Create one to get started.
                  </div>
                </Card>
              )}
            </div>
          )}

          {activeTab === 'usage' && (
            <div className="space-y-4">
              <Card>
                <div className="flex items-center gap-3 mb-3">
                  <CreditCard size={16} className="text-accent-emerald" />
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">Billing Providers</h3>
                    <p className="text-sm text-text-secondary">Available billing providers for API key creation</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {billingProvidersError ? (
                    <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                      <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
                      <div className="text-sm">
                        <p className="text-red-200 font-medium">Failed to load billing providers</p>
                        <button onClick={loadBillingProviders} className="text-accent-blue hover:underline mt-1">Retry</button>
                      </div>
                    </div>
                  ) : !billingProviders || billingProviders.length === 0 ? (
                    <div className="text-center py-6 text-text-secondary">
                      <CreditCard size={24} className="mx-auto mb-3 opacity-30" />
                      <p>No billing providers available</p>
                    </div>
                  ) : billingProviders.map((bp) => (
                    <div key={bp.id} className="flex items-center justify-between p-3 rounded-lg border bg-bg-tertiary/50 border-white/10">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md flex items-center justify-center bg-white/5 text-text-secondary">
                          <Cloud size={16} />
                        </div>
                        <div>
                          <p className="font-medium text-text-primary">{bp.displayName}</p>
                          <p className="text-xs text-text-secondary">{bp.description || bp.slug}</p>
                        </div>
                      </div>
                      <span className="text-xs text-text-secondary capitalize">{bp.authType}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between p-3 rounded-lg border border-dashed border-white/20 bg-bg-tertiary/30">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md flex items-center justify-center bg-white/5 text-text-secondary">
                        <Plus size={16} />
                      </div>
                      <div>
                        <p className="font-medium text-text-primary">Add your own Billing Provider</p>
                        <p className="text-xs text-text-secondary">Connect a custom billing provider</p>
                      </div>
                    </div>
                    <span className="text-xs text-text-secondary">Coming soon</span>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="text-center py-6">
                  <BarChart3 size={24} className="mx-auto mb-3 text-text-secondary opacity-30" />
                  <h3 className="text-sm font-semibold text-text-primary mb-1">Usage Dashboard</h3>
                  <p className="text-sm text-text-secondary">Usage tracking and cost breakdown coming soon</p>
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'docs' && (
            <Card>
              <div className="prose prose-invert max-w-none">
                <h2 className="text-sm font-semibold text-text-primary mb-3">Getting Started</h2>
                <p className="text-text-secondary mb-3">
                  Welcome to the NAAP Developer API. Follow these steps to integrate:
                </p>
                <ol className="list-decimal list-inside space-y-2 text-text-secondary">
                  <li>Select a model from the Models tab</li>
                  <li>Create an API key for your project</li>
                  <li>Use the API key in your requests</li>
                  <li>Monitor usage in the Usage & Billing tab</li>
                </ol>
              </div>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ===== Create Key Modal ===== */}
      <Modal isOpen={showCreateModal} onClose={closeCreateModal}
        title={createStep === 'form' ? 'Create API Key' : createStep === 'oauth' ? 'Authenticating...' : 'API Key Created'}
        description={createStep === 'form' ? 'Configure your new API key' : undefined} size="lg">
        {createStep === 'form' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-primary mb-1.5">Project</label>
              <select value={selectedProjectId}
                onChange={(e) => { setSelectedProjectId(e.target.value); if (e.target.value !== '__new__') setNewProjectName(''); }}
                className={selectClassName}>
                <option value="">Select a project...</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' (Default)' : ''}</option>
                ))}
                <option value="__new__">+ Create New Project</option>
              </select>
              {selectedProjectId === '__new__' && (
                <input type="text" placeholder="Enter project name..." value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)} className={`${inputClassName} mt-2`} autoFocus />
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-text-primary mb-1.5">Key Label <span className="text-text-secondary font-normal">(optional)</span></label>
              <input type="text" placeholder="e.g. Production API Key" value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)} className={inputClassName} />
              <p className="text-xs text-text-secondary mt-1.5">A friendly name for this key. If left empty, the key prefix will be shown.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-primary mb-1.5">Billing Provider</label>
              <p className="text-xs text-text-secondary mb-2">You will be redirected to authenticate with the selected provider.</p>
              {modalDataLoading ? (
                <div className="flex items-center gap-3 p-4 bg-bg-tertiary border border-white/10 rounded-lg">
                  <Loader2 size={18} className="text-text-secondary animate-spin flex-shrink-0" />
                  <span className="text-sm text-text-secondary">Loading billing providers...</span>
                </div>
              ) : billingProvidersError ? (
                <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="text-red-200 font-medium">Failed to load billing providers</p>
                    <button onClick={loadBillingProviders} className="text-accent-blue hover:underline mt-1">Retry</button>
                  </div>
                </div>
              ) : !billingProviders || billingProviders.length === 0 ? (
                <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <AlertTriangle size={18} className="text-amber-400 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="text-amber-200 font-medium">No billing providers available</p>
                    <p className="text-text-secondary mt-0.5">Contact your administrator to configure a billing provider.</p>
                  </div>
                </div>
              ) : (
                <select value={selectedBillingProviderId}
                  onChange={(e) => setSelectedBillingProviderId(e.target.value)} className={selectClassName}>
                  <option value="">Select a billing provider...</option>
                  {billingProviders.map(bp => (
                    <option key={bp.id} value={bp.id}>{bp.displayName}</option>
                  ))}
                </select>
              )}
            </div>
            {createError && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-300">
                <AlertTriangle size={16} className="flex-shrink-0" />{createError}
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={handleCreateKey}
                disabled={creating || modalDataLoading || billingProvidersError || !billingProviders?.length || !selectedBillingProviderId}
                className="order-2 flex items-center gap-2 px-3 py-1.5 bg-accent-emerald text-white rounded-md text-xs font-medium hover:bg-accent-emerald/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Key size={16} /> Create API Key
              </button>
              <button
                onClick={closeCreateModal}
                className="order-1 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors rounded-md hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {createStep === 'oauth' && (
          <div className="flex flex-col items-center justify-center py-6 space-y-4">
            <Loader2 size={20} className="animate-spin text-text-secondary" />
            <div className="text-center">
              <p className="text-text-primary font-medium">Waiting for authentication...</p>
              <p className="text-sm text-text-secondary mt-1">Complete the sign-in in the new tab that opened. This page will update automatically.</p>
            </div>
          </div>
        )}
        {createStep === 'success' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <Shield size={20} className="text-emerald-400 flex-shrink-0" />
              <div className="text-sm">
                <p className="text-emerald-200 font-medium">Store this key securely</p>
                <p className="text-text-secondary mt-0.5">This is the only time your API key will be shown. Copy it now and store it in a safe place.</p>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-primary mb-1.5">Your API Key</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-bg-tertiary border border-white/10 rounded-lg py-2 px-3 font-mono text-sm text-accent-emerald break-all select-all">
                  {createdRawKey}
                </code>
                <button onClick={handleCopyKey}
                  className="flex-shrink-0 p-2 bg-bg-tertiary border border-white/10 rounded-lg hover:bg-white/5 transition-colors" title="Copy to clipboard">
                  {keyCopied ? <Check size={18} className="text-emerald-400" /> : <Copy size={18} className="text-text-secondary" />}
                </button>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={closeCreateModal}
                className="px-3 py-1.5 bg-accent-emerald text-white rounded-md text-xs font-medium hover:bg-accent-emerald/90 transition-all">Done</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ===== Revoke Confirmation Modal ===== */}
      <Modal isOpen={revokeKeyId !== null} onClose={() => setRevokeKeyId(null)} title="Revoke API Key" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Are you sure you want to revoke this API key? This action cannot be undone and any applications using this key will stop working.
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setRevokeKeyId(null)} disabled={revoking}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors rounded-md hover:bg-white/5">Cancel</button>
            <button onClick={handleRevokeKey} disabled={revoking}
              className="flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded-md text-xs font-medium hover:bg-red-700 transition-all disabled:opacity-50">
              {revoking ? (<><Loader2 size={16} className="animate-spin" /> Revoking...</>) : (<><Trash2 size={16} /> Revoke Key</>)}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default DeveloperView;
