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
  Globe,
  Cpu,
  Users,
  X,
ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ExternalLink,
} from 'lucide-react';
import { Card, Badge, Modal } from '@naap/ui';
import type { NetworkModel } from '@naap/plugin-sdk';
import { formatFeeWeiStringToEthDisplay } from '@naap/utils';

const PIPELINE_COLOR: Record<string, string> = {
  'text-to-image':           '#f59e0b',
  'image-to-image':          '#8b5cf6',
  'image-to-video':          '#3b82f6',
  'upscale':                 '#84cc16',
  'audio-to-text':           '#06b6d4',
  'segment-anything-2':      '#f97316',
  'llm':                     '#a855f7',
  'image-to-text':           '#ec4899',
  'live-video-to-video':     '#10b981',
  'text-to-speech':          '#14b8a6',
  'openai-chat-completions': '#8b5cf6',
  'openai-image-generation': '#f59e0b',
  'openai-text-embeddings':  '#3b82f6',
};
const DEFAULT_PIPELINE_COLOR = '#6366f1';

const MODEL_BADGE_COLORS = [
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  'bg-violet-100  text-violet-800  dark:bg-violet-900/40  dark:text-violet-200',
  'bg-amber-100   text-amber-800   dark:bg-amber-900/40   dark:text-amber-200',
  'bg-sky-100     text-sky-800     dark:bg-sky-900/40     dark:text-sky-200',
  'bg-rose-100    text-rose-800    dark:bg-rose-900/40    dark:text-rose-200',
  'bg-lime-100    text-lime-800    dark:bg-lime-900/40    dark:text-lime-200',
  'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200',
  'bg-cyan-100    text-cyan-800    dark:bg-cyan-900/40    dark:text-cyan-200',
] as const;

const MODEL_HEX_TO_BADGE_CLASSES: Record<string, string> = {
  '#10b981': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  '#8b5cf6': 'bg-violet-100  text-violet-800  dark:bg-violet-900/40  dark:text-violet-200',
  '#3b82f6': 'bg-sky-100     text-sky-800     dark:bg-sky-900/40     dark:text-sky-200',
  '#f59e0b': 'bg-amber-100   text-amber-800   dark:bg-amber-900/40   dark:text-amber-200',
  '#84cc16': 'bg-lime-100    text-lime-800    dark:bg-lime-900/40    dark:text-lime-200',
  '#a855f7': 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200',
  '#06b6d4': 'bg-cyan-100    text-cyan-800    dark:bg-cyan-900/40    dark:text-cyan-200',
  '#ec4899': 'bg-pink-100    text-pink-800    dark:bg-pink-900/40    dark:text-pink-200',
  '#f97316': 'bg-orange-100  text-orange-800  dark:bg-orange-900/40  dark:text-orange-200',
  '#14b8a6': 'bg-teal-100    text-teal-800    dark:bg-teal-900/40    dark:text-teal-200',
  '#6366f1': 'bg-indigo-100  text-indigo-800  dark:bg-indigo-900/40  dark:text-indigo-200',
};

function hashModelId(id: string): number {
  let n = 0;
  for (let i = 0; i < id.length; i++) n += id.charCodeAt(i);
  return Math.abs(n) % MODEL_BADGE_COLORS.length;
}

function modelBadgeColor(modelId: string, fallbackPipelineId?: string): string {
  const hex = PIPELINE_COLOR[modelId];
  if (hex) return MODEL_HEX_TO_BADGE_CLASSES[hex] ?? MODEL_BADGE_COLORS[hashModelId(modelId)];
  const fallbackHex = fallbackPipelineId ? PIPELINE_COLOR[fallbackPipelineId] : undefined;
  if (fallbackHex) return MODEL_HEX_TO_BADGE_CLASSES[fallbackHex] ?? MODEL_BADGE_COLORS[hashModelId(modelId)];
  return MODEL_BADGE_COLORS[hashModelId(modelId)];
}

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
  expiresAt?: string | null;
  lastUsedAt: string | null;
}

/** Matches PymtHouse gateway signer session TTL (~90 days from key creation). */
const PYMTHOUSE_SIGNER_SESSION_MS = 90 * 24 * 60 * 60 * 1000;

function computePymthouseExpiresAtFromCreated(
  createdAt: string | undefined | null,
): string | null {
  if (!createdAt) return null;
  const ms = new Date(createdAt).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + PYMTHOUSE_SIGNER_SESSION_MS).toISOString();
}

/** Prefer server `expiresAt`; for PymtHouse keys without it, derive from `createdAt`. */
function resolveApiKeyExpiresAt(key: ApiKey): string | null {
  if (key.expiresAt != null && String(key.expiresAt).trim() !== '') {
    return key.expiresAt;
  }
  if (key.billingProvider?.slug === 'pymthouse') {
    return computePymthouseExpiresAtFromCreated(key.createdAt);
  }
  return null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatExpiryDaysRemaining(expiresIso: string, nowMs: number = Date.now()): string {
  const expMs = new Date(expiresIso).getTime();
  if (!Number.isFinite(expMs)) return '—';
  const diff = expMs - nowMs;
  if (diff <= 0) return 'Expired';
  const fullDays = Math.floor(diff / MS_PER_DAY);
  if (fullDays >= 1) {
    return `${fullDays} day${fullDays === 1 ? '' : 's'}`;
  }
  return '< 1 day';
}

function formatExpiryExactForTitle(expiresIso: string): string {
  return new Date(expiresIso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
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

interface PymthouseUsageMePayload {
  clientId: string;
  period: { start: string | null; end: string | null };
  currentUser: {
    externalUserId: string;
    requestCount: number;
    feeWei: string;
    pipelineModels: Array<{
      pipeline: string;
      modelId: string;
      requestCount: number;
      networkFeeWei: string;
      networkFeeUsdMicros: string;
      ownerChargeUsdMicros: string;
      endUserBillableUsdMicros: string;
      networkFeeEth?: string;
    }>;
  };
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

const PYTHON_GATEWAY_REPO_HREF = 'https://github.com/livepeer/livepeer-python-gateway';

interface DocsBillingProvider {
  id: string;
  name: string;
  signerUrl: string;
  apiKeyHref: string;
  /** Provider-specific notes shown in the signer section. */
  signerNote: string;
  /** Provider-specific note shown in the authentication section. */
  authNote: React.ReactNode;
}

const DOCS_BILLING_PROVIDERS: DocsBillingProvider[] = [
  {
    id: 'pymthouse',
    name: 'PymtHouse',
    signerUrl: 'https://pymthouse.com/api/signer',
    apiKeyHref: '/developer/keys',
    signerNote:
      'The PymtHouse signer validates your scoped signer session token on every ticket — your private key never leaves your machine.',
    authNote: (
      <>
        Pass the signer session token from the API Keys tab as a Bearer token in the{' '}
        <code className="text-slate-300">Authorization</code> header.{' '}
        Tokens are generated through a short-lived authorization exchange and expire after about 90 days;
        create a new key from this tab when needed.
      </>
    ),
  },
  {
    id: 'daydream',
    name: 'Daydream',
    signerUrl: 'https://signer.daydream.live',
    apiKeyHref: '/developer/keys',
    signerNote:
      'The Daydream signer co-signs Livepeer payment tickets on behalf of your account using your API key credentials.',
    authNote: (
      <>
        Pass your Daydream API key as a Bearer token in the{' '}
        <code className="text-slate-300">Authorization</code> header when calling the signer.{' '}
        Generate a key from the API Keys tab.
      </>
    ),
  },
];

function DocCodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [code]);
  return (
    <div className="relative group mt-2 mb-5">
      {label && (
        <span className="block text-[10px] font-mono text-text-secondary/60 mb-1 uppercase tracking-wide select-none">
          {label}
        </span>
      )}
      <div className="rounded-lg bg-black/50 border border-white/10 overflow-hidden">
        <pre className="p-3 pr-14 text-[11.5px] leading-relaxed font-mono text-slate-300 overflow-x-auto whitespace-pre">
          {code}
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code"
          className="absolute top-1/2 right-2 -translate-y-1/2 flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 bg-white/5 text-text-secondary hover:text-text-primary hover:bg-white/10 transition-all opacity-0 group-hover:opacity-100 text-[10px] font-medium shrink-0"
          style={{ top: label ? 'calc(50% + 0.625rem)' : '50%' }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-7 first:mt-0">
      <h3 className="text-[11px] font-semibold text-text-primary/60 uppercase tracking-widest mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

function DocProse({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-text-secondary leading-relaxed mb-3">{children}</p>;
}

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
  const [createdKeyExpiresAt, setCreatedKeyExpiresAt] = useState<string | null>(null);
  const [createdKeyWarning, setCreatedKeyWarning] = useState('');
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
  type ModelSortKey = 'Model' | 'Pipeline' | 'WarmOrchCount' | 'TotalCapacity' | 'PriceAvgWeiPerPixel' | 'PriceMinWeiPerPixel';
  const [modelSortKey, setModelSortKey] = useState<ModelSortKey>('WarmOrchCount');
  const [modelSortDir, setModelSortDir] = useState<'asc' | 'desc'>('desc');
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  const [usagePayload, setUsagePayload] = useState<PymthouseUsageMePayload | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  /** Billing provider slug for Usage tab (defaults to PymtHouse when present in catalog). */
  const [usageBillingProviderSlug, setUsageBillingProviderSlug] = useState('');
  /** Selected billing provider for the Docs tab. */
  const [docsBillingProviderId, setDocsBillingProviderId] = useState<string>(DOCS_BILLING_PROVIDERS[0].id);

  const copyCell = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCell(key);
      setTimeout(() => setCopiedCell((prev) => (prev === key ? null : prev)), 1500);
    } catch { /* ignore */ }
  }, []);

  const revokedCount = useMemo(
    () => apiKeys.filter((k) => (k.status || '').toUpperCase() === 'REVOKED').length,
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

  const selectedBillingProvider = useMemo(
    () => billingProviders?.find((provider) => provider.id === selectedBillingProviderId) || null,
    [billingProviders, selectedBillingProviderId]
  );

  const displayedKeys = useMemo(() => {
    const filteredByRevoked = showRevoked
      ? apiKeys
      : apiKeys.filter((k) => (k.status || '').toUpperCase() !== 'REVOKED');
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
      const [netRes, catalogRes] = await Promise.allSettled([
        fetch('/api/v1/developer/network-models?limit=all'),
        fetch('/api/v1/dashboard/pipeline-catalog'),
      ]);

      // Require net/models to succeed
      if (netRes.status !== 'fulfilled' || !netRes.value.ok) {
        const status = netRes.status === 'fulfilled' ? netRes.value.status : 0;
        setNetworkModels([]);
        setNetworkModelsError(status ? `Failed to load models (HTTP ${status})` : 'Network error loading models');
        return;
      }
      const json = await netRes.value.json();
      const payload = json.data ?? json;
      if (!Array.isArray(payload?.models)) {
        setNetworkModels([]);
        setNetworkModelsError('Invalid response from server');
        return;
      }
      const liveModels: NetworkModel[] = payload.models;
      const seen = new Set(liveModels.map((m) => `${m.Pipeline}::${m.Model}`));
      const merged: NetworkModel[] = [...liveModels];

      // Supplement with pipeline-catalog entries (catalog-only rows have zero warm/capacity/price)
      if (catalogRes.status === 'fulfilled' && catalogRes.value.ok) {
        try {
          const catalog: Array<{ id: string; models: string[] }> = await catalogRes.value.json();
          for (const entry of catalog) {
            const models = entry.models.length > 0 ? entry.models : ['—'];
            for (const model of models) {
              const key = `${entry.id}::${model}`;
              if (!seen.has(key)) {
                seen.add(key);
                merged.push({
                  Pipeline: entry.id,
                  Model: model,
                  WarmOrchCount: 0,
                  TotalCapacity: 0,
                  PriceMinWeiPerPixel: 0,
                  PriceMaxWeiPerPixel: 0,
                  PriceAvgWeiPerPixel: 0,
                });
              }
            }
          }
          merged.sort((a, b) => a.Pipeline.localeCompare(b.Pipeline) || a.Model.localeCompare(b.Model));
        } catch {
          // catalog merge failed — use net/models only
        }
      }

      setNetworkModels(merged);
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
result = [...result].sort((a, b) => {
      const av = a[modelSortKey];
      const bv = b[modelSortKey];
      const cmp = typeof av === 'string' && typeof bv === 'string'
        ? av.localeCompare(bv)
        : (av as number) - (bv as number);
      return modelSortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [networkModels, pipelineFilter, networkModelSearch, modelSortKey, modelSortDir]);

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

  useEffect(() => {
    if (billingProviders === null || billingProviders.length === 0) return;
    setUsageBillingProviderSlug((prev) => {
      if (prev && billingProviders.some((p) => p.slug === prev)) return prev;
      const pym = billingProviders.find((p) => p.slug === 'pymthouse');
      return pym?.slug ?? billingProviders[0].slug;
    });
  }, [billingProviders]);

  const loadPymthouseUsage = useCallback(async () => {
    setUsageLoading(true);
    setUsageError(null);
    try {
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth();
      const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
      const params = new URLSearchParams({
        scope: 'me',
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });
      const res = await fetch(`/api/v1/billing/pymthouse/usage?${params}`, {
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          (json?.error && typeof json.error === 'object' && json.error.message) ||
          json?.message ||
          `Failed to load usage (HTTP ${res.status})`;
        setUsagePayload(null);
        setUsageError(typeof msg === 'string' ? msg : 'Failed to load usage');
        return;
      }
      const data = json.data ?? json;
      if (!data?.currentUser) {
        setUsagePayload(null);
        setUsageError('Invalid usage response from server');
        return;
      }
      const cu = data.currentUser as PymthouseUsageMePayload['currentUser'] & {
        pipelineModels?: unknown;
      };
      const normalized: PymthouseUsageMePayload = {
        clientId: data.clientId,
        period: data.period,
        currentUser: {
          externalUserId: cu.externalUserId,
          requestCount: cu.requestCount,
          feeWei: cu.feeWei,
          pipelineModels: Array.isArray(cu.pipelineModels) ? cu.pipelineModels : [],
        },
      };
      setUsagePayload(normalized);
    } catch (e) {
      setUsagePayload(null);
      setUsageError(e instanceof Error ? e.message : 'Network error loading usage');
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'usage') return;
    if (usageBillingProviderSlug !== 'pymthouse') {
      setUsageLoading(false);
      setUsagePayload(null);
      setUsageError(null);
      return;
    }
    void loadPymthouseUsage();
  }, [activeTab, usageBillingProviderSlug, loadPymthouseUsage]);

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
    setCreatedKeyExpiresAt(null);
    setCreatedKeyWarning('');
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
      const directAccessToken = startData.data?.access_token || startData.access_token;
      const authUrl = startData.data?.auth_url || startData.auth_url;
      const loginSessionId = startData.data?.login_session_id || startData.login_session_id;

      // Server-to-server providers (e.g. PymtHouse) return an opaque signer session
      // token as `access_token` directly. Browser-redirect providers (e.g. Daydream)
      // return `auth_url` for popup + polling and deliver the credential later.
      let providerApiKey: string | null = directAccessToken || null;

      if (!providerApiKey) {
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
      const keyCreatedAt =
        typeof payload.key?.createdAt === 'string' ? payload.key.createdAt : null;
      const expiresFromApi =
        typeof payload.key?.expiresAt === 'string' ? payload.key.expiresAt : null;
      const resolvedExpires =
        providerSlug === 'pymthouse'
          ? expiresFromApi || computePymthouseExpiresAtFromCreated(keyCreatedAt)
          : expiresFromApi;
      setCreatedKeyExpiresAt(resolvedExpires);
      setCreatedKeyWarning(payload.warning || 'Store this key securely. It will not be shown again.');
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
                  <span className="text-xs text-text-secondary">
                    Available Pipelines and Models
                  </span>
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
                    {pipelineOptions.map((pipeline) => {
                      const color = PIPELINE_COLOR[pipeline] ?? DEFAULT_PIPELINE_COLOR;
                      const active = pipelineFilter === pipeline;
                      return (
                      <button
                        type="button"
                        key={pipeline}
                        onClick={() => setPipelineFilter(pipeline === pipelineFilter ? 'all' : pipeline)}
                        aria-pressed={active}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all bg-bg-tertiary border"
                          style={{
                            borderColor: active ? color : 'rgba(255,255,255,0.1)',
                            color: active ? color : undefined,
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                        {pipeline}
                      </button>
                    );
                    })}
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
                            {(
                              [
                                { key: 'Model', label: 'Model', align: 'left' },
                                { key: 'WarmOrchCount', label: 'Warm Orchestrators', align: 'right' },
                                { key: 'TotalCapacity', label: 'Total Capacity', align: 'right' },
                                { key: 'PriceAvgWeiPerPixel', label: 'Avg Price (wei/px)', align: 'right' },
                                { key: 'PriceMinWeiPerPixel', label: 'Price Range (wei/px)', align: 'right' },
                              ] as { key: ModelSortKey; label: string; align: 'left' | 'right' }[]
                            ).map(({ key, label, align }) => {
                              const active = modelSortKey === key;
                              const Icon = active ? (modelSortDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
                              return (
                                <th key={key} className={`pb-3 font-medium${align === 'right' ? ' text-right' : ''}`}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (modelSortKey === key) {
                                        setModelSortDir((d) => d === 'asc' ? 'desc' : 'asc');
                                      } else {
                                        setModelSortKey(key);
                                        setModelSortDir('desc');
                                      }
                                    }}
                                    className={`inline-flex items-center gap-1 hover:text-text-primary transition-colors${align === 'right' ? ' flex-row-reverse' : ''}${active ? ' text-text-primary' : ''}`}
                                  >
                                    {label}
                                    <Icon size={12} className={active ? 'text-accent-blue' : 'opacity-40'} />
                                  </button>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {filteredNetworkModels.map((model, idx) => (
                            <tr key={`${idx}-${model.Pipeline}-${model.Model}`} className="hover:bg-white/5 transition-colors">
                              <td className="py-3 pr-4">
                                <div className="flex items-center gap-1 group/model">
                                  <span className={`inline-flex max-w-full cursor-default items-center rounded px-2 py-0.5 text-[10px] font-medium font-mono ${modelBadgeColor(model.Model, model.Pipeline)}`}>
                                    <span className="truncate">{model.Model}</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => copyCell(`model-${model.Pipeline}-${model.Model}`, model.Model)}
                                    className="rounded p-0.5 opacity-0 transition-opacity group-hover/model:opacity-100 focus-visible:opacity-100 text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary"
                                    title="Copy model name"
                                    aria-label={`Copy model name ${model.Model}`}
                                  >
                                    {copiedCell === `model-${model.Pipeline}-${model.Model}` ? <Check size={12} className="text-accent-emerald" aria-hidden /> : <Copy size={12} aria-hidden />}
                                  </button>
                                </div>
                              </td>
                              <td className="py-3 pr-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <Users size={12} className={model.WarmOrchCount > 0 ? 'text-accent-blue' : 'text-text-secondary opacity-40'} />
                                  <span className={`text-sm font-mono ${model.WarmOrchCount > 0 ? 'text-text-primary' : 'text-text-secondary opacity-40'}`}>{model.WarmOrchCount}</span>
                                </div>
                              </td>
                              <td className="py-3 pr-4 text-right">
                                <span className={`text-sm font-mono ${model.TotalCapacity > 0 ? 'text-text-primary' : 'text-text-secondary opacity-40'}`}>{model.TotalCapacity > 0 ? model.TotalCapacity : '—'}</span>
                              </td>
                              <td className="py-3 pr-4 text-right">
                                <span className={`text-sm font-mono ${model.PriceAvgWeiPerPixel > 0 ? 'text-accent-emerald' : 'text-text-secondary opacity-40'}`}>{model.PriceAvgWeiPerPixel > 0 ? model.PriceAvgWeiPerPixel.toLocaleString() : '—'}</span>
                              </td>
                              <td className="py-3 text-right">
                                <span className="text-sm font-mono text-text-secondary">
                                  {model.PriceMinWeiPerPixel > 0 || model.PriceMaxWeiPerPixel > 0
                                    ? `${model.PriceMinWeiPerPixel.toLocaleString()} – ${model.PriceMaxWeiPerPixel.toLocaleString()}`
                                    : '—'}
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
                          <th
                            className="pb-3 font-medium"
                            title="Days until the key expires; hover a row for the exact time."
                          >
                            Expires
                          </th>
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
                            <td className="py-3 pr-4">
                              {(() => {
                                const expires = resolveApiKeyExpiresAt(key);
                                if (!expires) {
                                  return (
                                    <span className="text-sm text-text-secondary">—</span>
                                  );
                                }
                                const label = formatExpiryDaysRemaining(expires);
                                const exact = formatExpiryExactForTitle(expires);
                                const title =
                                  label === 'Expired'
                                    ? `Expired: ${exact}`
                                    : `Expires: ${exact}`;
                                return (
                                  <span
                                    className="text-sm text-text-secondary cursor-help border-b border-dotted border-white/20"
                                    title={title}
                                  >
                                    {label}
                                  </span>
                                );
                              })()}
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
            <div className="space-y-3">
              <Card>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex items-start gap-3 min-w-0">
                    <BarChart3 size={16} className="text-accent-blue shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-text-primary">Usage</h3>
                      <p className="text-xs text-text-secondary mt-0.5">
                        This month (UTC). Metrics reflect signed requests attributed to your account for the
                        selected billing provider.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0 lg:justify-end">
                    {billingProvidersError ? (
                      <button
                        type="button"
                        onClick={() => void loadBillingProviders()}
                        className="text-xs px-3 py-1.5 rounded-md border border-white/15 bg-bg-tertiary text-text-primary hover:border-accent-blue/50 transition-colors"
                      >
                        Retry providers
                      </button>
                    ) : (
                      <>
                        <label htmlFor="usage-billing-provider" className="text-xs text-text-secondary whitespace-nowrap">
                          Provider
                        </label>
                        <select
                          id="usage-billing-provider"
                          value={usageBillingProviderSlug}
                          onChange={(e) => setUsageBillingProviderSlug(e.target.value)}
                          disabled={!billingProviders?.length}
                          className={`${selectClassName} w-auto min-w-[11rem] max-w-[20rem] text-xs py-1.5`}
                        >
                          {!billingProviders?.length ? (
                            <option value="">Loading…</option>
                          ) : (
                            billingProviders.map((bp) => (
                              <option key={bp.id} value={bp.slug}>
                                {bp.displayName}
                              </option>
                            ))
                          )}
                        </select>
                        {usageBillingProviderSlug === 'pymthouse' && (
                          <button
                            type="button"
                            onClick={() => void loadPymthouseUsage()}
                            className="text-xs text-text-secondary hover:text-accent-blue transition-colors shrink-0 px-1"
                          >
                            Refresh
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {usageBillingProviderSlug === 'pymthouse' ? (
                  <>
                    {usageLoading ? (
                      <div className="flex items-center justify-center gap-3 py-8 mt-4">
                        <Loader2 size={16} className="animate-spin text-text-secondary" />
                        <span className="text-sm text-text-secondary">Loading usage…</span>
                      </div>
                    ) : usageError ? (
                      <div className="flex items-start gap-3 p-4 mt-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                        <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="text-red-200 font-medium">Could not load usage</p>
                          <p className="text-text-secondary mt-1">{usageError}</p>
                          <button
                            type="button"
                            onClick={() => void loadPymthouseUsage()}
                            className="text-accent-blue hover:underline mt-2 text-xs"
                          >
                            Retry
                          </button>
                        </div>
                      </div>
                    ) : usagePayload ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                        <div className="p-4 rounded-lg border bg-bg-tertiary/50 border-white/10">
                          <p className="text-xs uppercase tracking-wide text-text-secondary mb-1">Requests</p>
                          <p className="text-2xl font-mono text-text-primary">
                            {usagePayload.currentUser.requestCount.toLocaleString()}
                          </p>
                        </div>
                        <div className="p-4 rounded-lg border bg-bg-tertiary/50 border-white/10">
                          <p className="text-xs uppercase tracking-wide text-text-secondary mb-1">Fees (wei raw)</p>
                          <p className="text-sm font-mono text-text-primary break-all">{usagePayload.currentUser.feeWei}</p>
                          <p className="text-xs text-text-secondary mt-2">
                            ≈ {formatFeeWeiStringToEthDisplay(usagePayload.currentUser.feeWei)} ETH
                          </p>
                        </div>
                        <div className="sm:col-span-2 text-xs text-text-secondary font-mono">
                          <span className="text-text-secondary">Period: </span>
                          {usagePayload.period?.start ?? '—'} → {usagePayload.period?.end ?? '—'}
                        </div>
                        <div className="sm:col-span-2 mt-2">
                          <p className="text-xs uppercase tracking-wide text-text-secondary mb-2">
                            By pipeline &amp; model
                          </p>
                          {usagePayload.currentUser.pipelineModels.length > 0 ? (
                            <ul className="space-y-2 text-sm">
                              {usagePayload.currentUser.pipelineModels.map((row) => (
                                <li
                                  key={`${row.pipeline}:${row.modelId}`}
                                  className="p-3 rounded-lg border border-white/10 bg-bg-tertiary/30 font-mono"
                                >
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-text-primary">
                                    <span>
                                      <span className="text-text-secondary">Pipeline</span>{' '}
                                      {row.pipeline}
                                    </span>
                                    <span>
                                      <span className="text-text-secondary">Model</span> {row.modelId}
                                    </span>
                                    <span>
                                      <span className="text-text-secondary">Requests</span>{' '}
                                      {row.requestCount.toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="mt-2 text-xs text-text-secondary break-all">
                                    Network fee (wei): {row.networkFeeWei}
                                    <span className="block mt-1">
                                      ≈ {formatFeeWeiStringToEthDisplay(row.networkFeeWei)} ETH
                                    </span>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-text-secondary">
                              No pipeline/model breakdown for this period.
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-6 mt-4 text-text-secondary">
                        <BarChart3 size={24} className="mx-auto mb-3 opacity-30" />
                        <p className="text-sm">No usage data for this period.</p>
                      </div>
                    )}
                  </>
                ) : usageBillingProviderSlug ? (
                  <p className="text-sm text-text-secondary mt-4">
                    Usage metrics for{' '}
                    <span className="text-text-primary font-medium">
                      {billingProviders?.find((p) => p.slug === usageBillingProviderSlug)?.displayName ??
                        usageBillingProviderSlug}
                    </span>{' '}
                    are not shown here yet. Use the billing provider&apos;s tools for account usage.
                  </p>
                ) : billingProvidersError ? (
                  <p className="text-sm text-text-secondary mt-4">
                    Unable to load billing providers. Use &quot;Retry providers&quot; above to try again.
                  </p>
                ) : billingProviders !== null && billingProviders.length === 0 ? (
                  <p className="text-sm text-text-secondary mt-4">No billing providers available.</p>
                ) : (
                  <p className="text-sm text-text-secondary mt-4">Loading billing providers…</p>
                )}
              </Card>
            </div>
          )}

          {activeTab === 'docs' && (() => {
            const bp = DOCS_BILLING_PROVIDERS.find((p) => p.id === docsBillingProviderId) ?? DOCS_BILLING_PROVIDERS[0];
            return (
            <div className="space-y-4">
              {/* ── Getting Started ── */}
              <Card>
                <h2 className="text-sm font-semibold text-text-primary mb-3">Getting Started</h2>
                <ol className="list-none space-y-2">
                  {[
                    'Browse available pipelines and models in the Models tab.',
                    'Create an API key for your project in the API Keys tab.',
                    'Use the API key in your requests to authenticate against the NAAP gateway.',
                    'Track usage and billing in the Usage & Billing tab.',
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-text-secondary">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[10px] font-semibold text-text-primary mt-0.5">
                        {i + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </Card>

              {/* ── Python SDK ── */}
              <Card>
                {/* Header: title + provider tabs */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
                  <div>
                    <h2 className="text-sm font-semibold text-text-primary">Python SDK</h2>
                    <p className="text-xs text-text-secondary mt-1">
                      <a
                        href={PYTHON_GATEWAY_REPO_HREF}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-accent-blue hover:underline"
                      >
                        livepeer/livepeer-python-gateway
                        <ExternalLink size={11} aria-hidden />
                      </a>
                      {' '}— orchestrator discovery, Live Video-to-Video jobs, frame publishing.
                    </p>
                  </div>

                  {/* Billing provider pill tabs */}
                  <div className="shrink-0">
                    <p className="text-[10px] uppercase tracking-wider text-text-secondary/60 mb-1.5 font-medium">
                      Billing provider
                    </p>
                    <div className="flex items-center gap-1 p-0.5 rounded-lg bg-black/30 border border-white/10">
                      {DOCS_BILLING_PROVIDERS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setDocsBillingProviderId(p.id)}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                            docsBillingProviderId === p.id
                              ? 'bg-accent-blue text-white shadow-sm'
                              : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Provider badge row */}
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/3 border border-white/8 mb-7">
                  <span className="text-[10px] uppercase tracking-wider text-text-secondary/60 font-medium shrink-0">
                    Signer
                  </span>
                  <code className="text-xs text-accent-blue font-mono">{bp.signerUrl}</code>
                  <span className="ml-auto shrink-0">
                    <a
                      href={bp.apiKeyHref}
                      className="inline-flex items-center gap-1 text-[11px] text-text-secondary hover:text-accent-blue transition-colors font-medium"
                    >
                      Get API key
                      <ExternalLink size={10} aria-hidden />
                    </a>
                  </span>
                </div>

                <DocSection title="Install">
                  <DocProse>
                    Clone the repository and install example dependencies with{' '}
                    <code className="text-slate-300">uv</code>. The{' '}
                    <code className="text-slate-300">--extra examples</code> group pulls in{' '}
                    <code className="text-slate-300">av</code> and other packages needed to run the scripts.
                  </DocProse>
                  <DocCodeBlock code={`git clone https://github.com/livepeer/livepeer-python-gateway\ncd livepeer-python-gateway\nuv sync --extra examples`} />
                </DocSection>

                <DocSection title="Authentication">
                  <DocProse>{bp.authNote}</DocProse>
                  <DocCodeBlock
                    label="Authorization header"
                    code={`Authorization: Bearer <your-api-key>`}
                  />
                  <DocProse>{bp.signerNote}</DocProse>
                </DocSection>

                <DocSection title="Inspect orchestrators — get_orchestrator_info.py">
                  <DocProse>
                    Query a single orchestrator directly without any credentials — useful for quick capability checks on a known host.
                  </DocProse>
                  <DocCodeBlock
                    label="off-chain (direct)"
                    code={`uv run examples/get_orchestrator_info.py localhost:8935`}
                  />

                  <DocProse>
                    Run in on-chain mode with the {bp.name} signer. The signer handles payment ticket co-signing; your private key never leaves your machine.
                  </DocProse>
                  <DocCodeBlock
                    label="remote signer"
                    code={`uv run examples/get_orchestrator_info.py --signer "${bp.signerUrl}"`}
                  />

                  <DocProse>
                    Use <code className="text-slate-300">--discovery</code> to resolve orchestrators from a discovery endpoint. Append{' '}
                    <code className="text-slate-300">?cap=&lt;capability-id&gt;</code> to filter by pipeline — for example{' '}
                    <code className="text-slate-300">cap=live-video-to-video</code> or{' '}
                    <code className="text-slate-300">cap=streamdiffusion-sdxl-v2v</code>.
                  </DocProse>
                  <DocCodeBlock
                    label="discovery + capability filter + signer"
                    code={`uv run examples/get_orchestrator_info.py \\\n  --discovery "https://discovery.example.com/discover-orchestrators?cap=live-video-to-video" \\\n  --signer "${bp.signerUrl}"`}
                  />

                  <DocProse>
                    Output as JSON or JSONL for scripting or piping into other tools.
                  </DocProse>
                  <DocCodeBlock
                    label="json output"
                    code={`uv run examples/get_orchestrator_info.py localhost:8935 --format json`}
                  />
                </DocSection>

                <DocSection title="Publish frames — write_frames.py">
                  <DocProse>
                    Start a Live Video-to-Video job and push raw frames to an orchestrator. Run{' '}
                    <code className="text-slate-300">get_orchestrator_info.py</code> first to discover a suitable
                    orchestrator URL (filtered by capability if needed), then pass it as the first argument here.
                  </DocProse>
                  <DocCodeBlock
                    label="local orchestrator (off-chain)"
                    code={`uv run examples/write_frames.py localhost:8935`}
                  />
                  <DocCodeBlock
                    label={`remote orchestrator + ${bp.name} signer`}
                    code={`uv run examples/write_frames.py https://orchestrator.example.com:8935 \\\n  --signer "${bp.signerUrl}" \\\n  --model noop \\\n  --count 90`}
                  />

                  <DocProse>
                    To bundle signer, discovery, and orchestrator settings into a single reusable token, encode a JSON payload as base64 and pass it via{' '}
                    <code className="text-slate-300">--token</code>. Token fields override explicit arguments. See the{' '}
                    <a
                      href={`${PYTHON_GATEWAY_REPO_HREF}#token-schema-base64-encoded-json-object`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-accent-blue hover:underline"
                    >
                      token schema
                      <ExternalLink size={11} aria-hidden />
                    </a>{' '}
                    in the README.
                  </DocProse>
                </DocSection>

                <DocSection title="VS Code / Cursor debugging">
                  <DocProse>
                    From the cloned repo root, these match what you would pass as <code className="text-slate-300">args</code>{' '}
                    when debugging <code className="text-slate-300">examples/get_orchestrator_info.py</code> or{' '}
                    <code className="text-slate-300">examples/write_frames.py</code> (<code className="text-slate-300">cwd</code>:{' '}
                    workspace folder). Replace discovery and orchestrator URLs as needed.
                  </DocProse>
                  <DocCodeBlock
                    label="debug get_orchestrator_info.py"
                    code={`uv run examples/get_orchestrator_info.py \\\n  --discovery "https://discovery.example.com/discover-orchestrators?cap=live-video-to-video" \\\n  --signer "${bp.signerUrl}"`}
                  />
                  <DocCodeBlock
                    label="debug write_frames.py"
                    code={`uv run examples/write_frames.py https://orchestrator.example.com:8935 \\\n  --signer "${bp.signerUrl}" \\\n  --model noop \\\n  --count 90`}
                  />
                </DocSection>
              </Card>
            </div>
            );
          })()}
        </motion.div>
      </AnimatePresence>

      {/* ===== Create Key Modal ===== */}
      <Modal isOpen={showCreateModal} onClose={closeCreateModal}
        title={
          createStep === 'form'
            ? 'Create API Key'
            : createStep === 'oauth'
              ? selectedBillingProvider?.slug === 'pymthouse'
                ? 'Provisioning PymtHouse...'
                : 'Authenticating...'
              : 'API Key Created'
        }
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
              <p className="text-xs text-text-secondary mb-2">
                {selectedBillingProvider?.slug === 'pymthouse'
                  ? 'PymtHouse uses a server-to-server link. There is no browser redirect or interactive sign-in.'
                  : 'You will be redirected to authenticate with the selected provider.'}
              </p>
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
              {selectedBillingProvider?.slug === 'pymthouse' && (
                <p className="text-xs text-amber-300 mt-2">
                  PymtHouse keys are scoped signer session tokens. They are generated through a short-lived user
                  authorization exchange and expire after about 90 days.
                </p>
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
              <p className="text-text-primary font-medium">
                {selectedBillingProvider?.slug === 'pymthouse'
                  ? 'Creating your PymtHouse billing key...'
                  : 'Waiting for authentication...'}
              </p>
              <p className="text-sm text-text-secondary mt-1">
                {selectedBillingProvider?.slug === 'pymthouse'
                  ? 'The server is exchanging machine credentials with PymtHouse on your behalf. This page updates automatically when the key is ready—no new tab or interactive sign-in.'
                  : 'Complete the sign-in in the new tab that opened. This page will update automatically.'}
              </p>
            </div>
          </div>
        )}
        {createStep === 'success' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <Shield size={20} className="text-emerald-400 flex-shrink-0" />
              <div className="text-sm">
                <p className="text-emerald-200 font-medium">Store this key securely</p>
                <p className="text-text-secondary mt-0.5">
                  {createdKeyWarning || 'This is the only time your API key will be shown. Copy it now and store it in a safe place.'}
                </p>
                {createdKeyExpiresAt && (
                  <p className="text-amber-200 mt-1">
                    {createdRawKey.startsWith('pmth_')
                      ? `Valid until ${new Date(createdKeyExpiresAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })} (about 90 days from when this key was created).`
                      : `Expires at ${new Date(createdKeyExpiresAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}.`}
                  </p>
                )}
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
