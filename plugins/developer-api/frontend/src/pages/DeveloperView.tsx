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
  CircleHelp,
} from 'lucide-react';
import { Card, Badge, Modal, Tooltip } from '@naap/ui';
import type { NetworkModel } from '@naap/plugin-sdk';
import { computeSignerSessionExpiry } from '@pymthouse/builder-sdk/tokens';

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

const DEFAULT_TAB: TabId = 'api-keys';

function resolveTabFromPath(pathname: string): TabId {
  const parts = pathname.split('/').filter(Boolean);
  const maybeRoot = parts[0];
  const maybeTab = parts[1];
  if (maybeRoot !== 'developer') {
    return DEFAULT_TAB;
  }
  return TAB_FROM_SEGMENT[maybeTab ?? ''] ?? DEFAULT_TAB;
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
  /** Fingerprint for matching: NaaP `naap_<lookup>…`, or leading chars of the billing provider secret + "…". */
  keyPrefix: string;
  label: string | null;
  createdAt: string;
  expiresAt?: string | null;
  lastUsedAt: string | null;
}

/**
 * TODO(backend): return actual token expiry for PymtHouse keys in `expiresAt`
 * (not only the default 90-day TTL fallback) so frontend can rely on server data.
 *
 * Prefer server `expiresAt`; for PymtHouse keys without it, derive from `createdAt`.
 */
function resolveApiKeyExpiresAt(key: ApiKey): string | null {
  if (key.expiresAt != null && String(key.expiresAt).trim() !== '') {
    return key.expiresAt;
  }
  if (key.billingProvider?.slug === 'pymthouse') {
    return computeSignerSessionExpiry(key.createdAt).toISOString();
  }
  return null;
}

function formatApiKeyListName(key: ApiKey): React.ReactNode {
  const prefix = key.keyPrefix;
  const label = key.label?.trim();
  if (label) {
    return (
      <>
        <span className="text-sm font-medium text-text-primary">{label}</span>
        <span className="text-sm text-text-secondary font-mono ml-1.5">· {prefix}</span>
      </>
    );
  }
  return <span className="text-sm font-medium text-text-primary font-mono">{prefix}</span>;
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
    currency: string;
    networkFeeUsdMicros: string;
    ownerChargeUsdMicros: string;
    endUserBillableUsdMicros: string;
    pipelineModels: Array<{
      pipeline: string;
      modelId: string;
      requestCount: number;
      currency: string;
      networkFeeUsdMicros: string;
      ownerChargeUsdMicros: string;
      endUserBillableUsdMicros: string;
    }>;
  };
}

function formatUsdMicros(microsRaw: string | number | bigint): string {
  try {
    const micros = BigInt(typeof microsRaw === 'string' ? microsRaw : String(microsRaw));
    const whole = micros / 1_000_000n;
    const frac = micros % 1_000_000n;
    const fracText = frac.toString().padStart(6, '0').replace(/0+$/, '');
    return fracText.length > 0 ? `$${whole.toString()}.${fracText}` : `$${whole.toString()}`;
  } catch {
    return '$0';
  }
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

/** Base64 (standard) for UTF-8 JSON — matches python-gateway `parse_token` expectations. */
function utf8ToBase64Json(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
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
  { id: 'api-keys' as TabId, label: 'API Keys', icon: <Key size={14} /> },
  { id: 'usage' as TabId, label: 'Usage & Billing', icon: <BarChart3 size={14} /> },
  { id: 'models' as TabId, label: 'Models', icon: <Box size={14} /> },
  { id: 'docs' as TabId, label: 'Docs', icon: <BookOpen size={14} /> },
];

const selectClassName =
  'w-full bg-bg-tertiary border border-white/10 rounded-lg py-2 px-3 text-sm text-text-primary focus:outline-none focus:border-accent-blue appearance-none cursor-pointer';

const inputClassName =
  'w-full bg-bg-tertiary border border-white/10 rounded-lg py-2 px-3 text-sm text-text-primary focus:outline-none focus:border-accent-blue';

const PYTHON_GATEWAY_DISCOVERY_BILLING_SLUGS = new Set(['pymthouse', 'daydream']);

const DEFAULT_PYMTHOUSE_SIGNER_BASE_URL = 'https://pymthouse.com/api/signer';

function getSignerBaseUrlForBillingProvider(slug: string): string {
  if (slug === 'daydream') {
    return 'https://signer.daydream.live';
  }
  return DEFAULT_PYMTHOUSE_SIGNER_BASE_URL;
}

type UsagePeriodPreset = '1d' | '7d' | '30d' | 'mtd' | 'last_month';

const USAGE_PERIOD_PRESETS: { id: UsagePeriodPreset; label: string }[] = [
  { id: '1d', label: '1d' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'mtd', label: 'MTD' },
  { id: 'last_month', label: 'Last month' },
];

function computeUsagePeriodDates(preset: UsagePeriodPreset): {
  start: Date;
  end: Date;
  rangeLabel: string;
} {
  const now = new Date();
  const fmtShort = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  if (preset === '1d') {
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { start, end: now, rangeLabel: `${fmtShort(start)} – ${fmtShort(now)}` };
  }
  if (preset === '7d') {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start, end: now, rangeLabel: `${fmtShort(start)} – ${fmtShort(now)}` };
  }
  if (preset === '30d') {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start, end: now, rangeLabel: `${fmtShort(start)} – ${fmtShort(now)}` };
  }
  if (preset === 'last_month') {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    return { start, end, rangeLabel: `${fmtShort(start)} – ${fmtShort(end)}` };
  }
  // mtd
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  return { start, end: now, rangeLabel: `${fmtShort(start)} – ${fmtShort(now)}` };
}

/** Usage tab pill order — Daydream first, then PymtHouse (no default bias toward either). */
const USAGE_PANEL_PROVIDER_SLUGS: readonly string[] = ['pymthouse', 'daydream'];

function billingProviderSupportsPythonGatewayDiscovery(slug: string | undefined): boolean {
  return !!slug && PYTHON_GATEWAY_DISCOVERY_BILLING_SLUGS.has(slug);
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
  /** When an SDK token is shown, the billing API key is tucked into this expandable. */
  const [apiKeyPanelOpen, setApiKeyPanelOpen] = useState(false);
  const [sdkTokenCopied, setSdkTokenCopied] = useState(false);

  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [billingProviders, setBillingProviders] = useState<BillingProviderInfo[] | null>(null);
  const [billingProvidersError, setBillingProvidersError] = useState(false);
  const [modalDataLoading, setModalDataLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [selectedBillingProviderId, setSelectedBillingProviderId] = useState('');

  /** NaaP orchestrator-leaderboard discovery plans (python-gateway bundle for PymtHouse + Daydream). */
  const [discoveryPlans, setDiscoveryPlans] = useState<Array<{ id: string; name: string }>>([]);
  const [discoveryPlansLoading, setDiscoveryPlansLoading] = useState(false);
  const [selectedDiscoveryPlanId, setSelectedDiscoveryPlanId] = useState('');
  const [createdPythonGatewayToken, setCreatedPythonGatewayToken] = useState('');
  const [gatewayDiscoveryKeyMintError, setGatewayDiscoveryKeyMintError] = useState('');

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
  /** Billing provider slug for Usage tab (pill tabs: Daydream / PymtHouse). */
  const [usageBillingProviderSlug, setUsageBillingProviderSlug] = useState('');
  const [usagePeriodPreset, setUsagePeriodPreset] = useState<UsagePeriodPreset>('mtd');

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

  const usagePanelProviders = useMemo<BillingProviderInfo[]>(() => {
    if (!billingProviders?.length) return [];
    const bySlug = new Map(billingProviders.map((p: BillingProviderInfo) => [p.slug, p]));
    return USAGE_PANEL_PROVIDER_SLUGS.map((slug: string) => bySlug.get(slug)).filter(
      (p): p is BillingProviderInfo => p != null,
    );
  }, [billingProviders]);

  useEffect(() => {
    if (!showCreateModal || !billingProviderSupportsPythonGatewayDiscovery(selectedBillingProvider?.slug)) {
      setDiscoveryPlans([]);
      setSelectedDiscoveryPlanId('');
      return;
    }

    let cancelled = false;
    setDiscoveryPlansLoading(true);

    void (async () => {
      try {
        const slug = selectedBillingProvider?.slug?.trim();
        const q = slug ? `?billingProviderSlug=${encodeURIComponent(slug)}` : '';
        const res = await fetch(`/api/v1/orchestrator-leaderboard/plans${q}`, { credentials: 'include' });
        if (!res.ok || cancelled) {
          return;
        }
        const json = await res.json();
        const raw = json.data?.plans;
        const list = Array.isArray(raw) ? raw : [];
        if (cancelled) {
          return;
        }
        setDiscoveryPlans(
          list.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })),
        );
      } catch {
        if (!cancelled) {
          setDiscoveryPlans([]);
        }
      } finally {
        if (!cancelled) {
          setDiscoveryPlansLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showCreateModal, selectedBillingProvider?.slug, selectedBillingProviderId]);

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
    if (usagePanelProviders.length === 0) return;
    setUsageBillingProviderSlug((prev) => {
      if (prev && usagePanelProviders.some((p) => p.slug === prev)) return prev;
      return usagePanelProviders[0].slug;
    });
  }, [usagePanelProviders]);

  const loadPymthouseUsage = useCallback(async (preset: UsagePeriodPreset = 'mtd') => {
    setUsageLoading(true);
    setUsageError(null);
    try {
      const { start, end } = computeUsagePeriodDates(preset);
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
          currency: typeof cu.currency === 'string' ? cu.currency : 'USD',
          networkFeeUsdMicros:
            typeof cu.networkFeeUsdMicros === 'string' ? cu.networkFeeUsdMicros : '0',
          ownerChargeUsdMicros:
            typeof cu.ownerChargeUsdMicros === 'string' ? cu.ownerChargeUsdMicros : '0',
          endUserBillableUsdMicros:
            typeof cu.endUserBillableUsdMicros === 'string' ? cu.endUserBillableUsdMicros : '0',
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
    void loadPymthouseUsage(usagePeriodPreset);
  }, [activeTab, usageBillingProviderSlug, usagePeriodPreset, loadPymthouseUsage]);

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
    setCreatedPythonGatewayToken('');
    setGatewayDiscoveryKeyMintError('');
    setCreatedKeyExpiresAt(null);
    setCreatedKeyWarning('');
    setCreateError('');
    setCreating(false);
    setKeyCopied(false);
    setApiKeyPanelOpen(false);
    setSdkTokenCopied(false);
    setSelectedProjectId('');
    setNewProjectName('');
    setNewKeyLabel('');
    setSelectedBillingProviderId('');
    setSelectedDiscoveryPlanId('');
    setDiscoveryPlans([]);
    setShowCreateModal(true);
    loadModalData();
  }, [loadModalData]);

  const closeCreateModal = useCallback(() => {
    pollAbortControllerRef.current?.abort();
    const stepAtClose = createStep;
    setShowCreateModal(false);
    if (stepAtClose === 'oauth') {
      setCreateStep('form');
      setCreating(false);
    }
    setCreatedPythonGatewayToken('');
    setGatewayDiscoveryKeyMintError('');
    setApiKeyPanelOpen(false);
    setSdkTokenCopied(false);
    setSelectedDiscoveryPlanId('');
    if (stepAtClose === 'success') loadData();
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
      const startData = (await startRes.json().catch(() => ({}))) as {
        error?: { message?: string } | string;
        message?: string;
        data?: { access_token?: string; login_session_id?: string; poll_after_ms?: number; expires_in?: number };
        access_token?: string;
        login_session_id?: string;
        poll_after_ms?: number;
        expires_in?: number;
      };
      if (!startRes.ok) {
        const apiError = startData.error;
        const detail =
          (typeof apiError === 'object' && apiError?.message) ||
          (typeof apiError === 'string' ? apiError : undefined) ||
          startData.message;
        setCreateError(
          detail
            ? `Failed to start authentication with billing provider: ${detail}`
            : 'Failed to start authentication with billing provider.',
        );
        setCreateStep('form');
        setCreating(false);
        return;
      }
      const directAccessToken = startData.data?.access_token || startData.access_token;
      const loginSessionId = startData.data?.login_session_id || startData.login_session_id;

      // Server-to-server providers (e.g. PymtHouse) return an opaque signer session
      // token as `access_token` directly. Browser-redirect providers (e.g. Daydream)
      // hand back only a `login_session_id`; the popup opens a same-origin NaaP
      // redirector that resolves the provider authorization URL server-side, so no
      // remote-controlled URL is ever passed into window.open.
      let providerApiKey: string | null = directAccessToken || null;

      if (!providerApiKey) {
        if (!loginSessionId) {
          setCreateError('Missing login session from billing provider.');
          setCreateStep('form');
          setCreating(false);
          return;
        }

        // The destination is a same-origin path; `encodeURIComponent` keeps the
        // tainted slug/session-id inside their URL segments, and the actual
        // provider authorization URL is resolved server-side in the redirect
        // route — so no external URL is ever reachable from this sink.
        // deepcode ignore OpenRedirect: same-origin relative path, see comment above
        window.open(
          `/api/v1/auth/providers/${encodeURIComponent(providerSlug)}/redirect?login_session_id=${encodeURIComponent(loginSessionId)}`,
          '_blank',
          'noopener,noreferrer',
        );

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
          ? expiresFromApi ||
            (keyCreatedAt ? computeSignerSessionExpiry(keyCreatedAt).toISOString() : null)
          : expiresFromApi;
      setCreatedKeyExpiresAt(resolvedExpires);
      setCreatedKeyWarning(payload.warning || 'Store this key securely. It will not be shown again.');
      setCreatedPythonGatewayToken('');
      setGatewayDiscoveryKeyMintError('');
      if (billingProviderSupportsPythonGatewayDiscovery(providerSlug)) {
        const signerBase = getSignerBaseUrlForBillingProvider(providerSlug).replace(/\/+$/, '');
        const selectedPlanId = selectedDiscoveryPlanId.trim();
        const discoveryPath = selectedPlanId
          ? `/api/v1/orchestrator-leaderboard/plans/${encodeURIComponent(selectedPlanId)}/python-gateway`
          : '/api/v1/orchestrator-leaderboard/python-gateway';
        const discoveryQs =
          !selectedPlanId && providerSlug === 'pymthouse' ? '?billingProvider=pymthouse' : '';
        const discoveryUrl = `${window.location.origin}${discoveryPath}${discoveryQs}`;
        const signerAuth = `Bearer ${providerApiKey}`;
        const gwName = `python-gateway discovery${newKeyLabel.trim() ? ` — ${newKeyLabel.trim()}` : ''}`.slice(0, 128);
        let discoveryAuth = '';
        try {
          const gwCsrf = await fetchCsrfToken();
          const gwRes = await fetch('/api/v1/gw/admin/keys', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': gwCsrf,
            },
            credentials: 'include',
            body: JSON.stringify({ name: gwName }),
          });
          let gwJson: { data?: { rawKey?: string }; rawKey?: string; error?: string } = {};
          try {
            gwJson = await gwRes.json();
          } catch {
            gwJson = {};
          }
          const gwData = gwJson.data ?? gwJson;
          const rawGw =
            typeof gwData?.rawKey === 'string' && gwData.rawKey.startsWith('gw_') ? gwData.rawKey : '';
          if (gwRes.ok && rawGw) {
            discoveryAuth = `Bearer ${rawGw}`;
          } else {
            const msg =
              typeof gwJson.error === 'string' && gwJson.error.trim()
                ? gwJson.error
                : 'Could not create a NaaP gateway API key (gw_…) for discovery. Add one under Service Gateway → API keys and set discovery_headers yourself, or try again.';
            setGatewayDiscoveryKeyMintError(msg);
          }
        } catch {
          setGatewayDiscoveryKeyMintError(
            'Could not create a NaaP gateway API key (gw_…) for discovery. Add one under Service Gateway → API keys and set discovery_headers yourself, or try again.',
          );
        }
        if (discoveryAuth) {
          setCreatedPythonGatewayToken(
            utf8ToBase64Json({
              signer: signerBase,
              discovery: discoveryUrl,
              signer_headers: { Authorization: signerAuth },
              discovery_headers: { Authorization: discoveryAuth },
            }),
          );
        }
      }
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
  }, [selectedProjectId, newProjectName, newKeyLabel, selectedBillingProviderId, billingProviders, selectedDiscoveryPlanId]);

  const handleCopyKey = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(createdRawKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    } catch { /* fallback */ }
  }, [createdRawKey]);

  const handleCopySdkToken = useCallback(async () => {
    if (!createdPythonGatewayToken) return;
    try {
      await navigator.clipboard.writeText(createdPythonGatewayToken);
      setSdkTokenCopied(true);
      setTimeout(() => setSdkTokenCopied(false), 2000);
    } catch { /* ignore */ }
  }, [createdPythonGatewayToken]);

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
                              {formatApiKeyListName(key)}
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
                {/* ── Header row: title + provider pills ── */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <BarChart3 size={16} className="text-accent-blue shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary">Usage</h3>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Signed requests attributed to your account for the selected billing provider.
                      </p>
                    </div>
                  </div>
                  {billingProvidersError ? (
                    <button
                      type="button"
                      onClick={() => void loadBillingProviders()}
                      className="text-xs px-3 py-1.5 rounded-md border border-white/15 bg-bg-tertiary text-text-primary hover:border-accent-blue/50 transition-colors shrink-0"
                    >
                      Retry providers
                    </button>
                  ) : (
                    <div className="flex flex-wrap gap-2 shrink-0" role="tablist" aria-label="Billing provider">
                      {usagePanelProviders.length === 0 ? (
                        <span className="text-xs text-text-secondary px-1">Loading…</span>
                      ) : (
                        usagePanelProviders.map((bp) => {
                          const selected = usageBillingProviderSlug === bp.slug;
                          return (
                            <button
                              key={bp.id}
                              type="button"
                              role="tab"
                              aria-selected={selected}
                              onClick={() => setUsageBillingProviderSlug(bp.slug)}
                              className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                                selected
                                  ? 'bg-accent-blue/15 border-accent-blue text-text-primary'
                                  : 'bg-bg-tertiary border-white/10 text-text-secondary hover:border-white/25 hover:text-text-primary'
                              }`}
                            >
                              {bp.displayName}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {usageBillingProviderSlug === 'pymthouse' ? (
                  <>
                    {/* ── Period selector row ── */}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-black/30 border border-white/10">
                        {USAGE_PERIOD_PRESETS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setUsagePeriodPreset(p.id);
                              void loadPymthouseUsage(p.id);
                            }}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                              usagePeriodPreset === p.id
                                ? 'bg-accent-blue text-white shadow-sm'
                                : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      {usagePayload && (
                        <span className="text-xs text-text-secondary font-mono">
                          {computeUsagePeriodDates(usagePeriodPreset).rangeLabel}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void loadPymthouseUsage(usagePeriodPreset)}
                        className="ml-auto text-xs text-text-secondary hover:text-accent-blue transition-colors px-1"
                      >
                        Refresh
                      </button>
                    </div>

                    {usageLoading ? (
                      <div className="flex items-center justify-center gap-3 py-10 mt-4">
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
                            onClick={() => void loadPymthouseUsage(usagePeriodPreset)}
                            className="text-accent-blue hover:underline mt-2 text-xs"
                          >
                            Retry
                          </button>
                        </div>
                      </div>
                    ) : usagePayload ? (
                      <>
                        {/* ── Stats cards ── */}
                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="p-4 rounded-lg border bg-bg-tertiary/50 border-white/10">
                            <p className="text-xs text-text-secondary mb-1">Total requests</p>
                            <p className="text-2xl font-semibold text-text-primary tabular-nums">
                              {usagePayload.currentUser.requestCount.toLocaleString()}
                            </p>
                          </div>
                          <div className="p-4 rounded-lg border bg-bg-tertiary/50 border-white/10">
                            <p className="text-xs text-text-secondary mb-1">Credit Usage</p>
                            <p className="text-2xl font-semibold text-text-primary tabular-nums">
                              {formatUsdMicros(usagePayload.currentUser.networkFeeUsdMicros)}
                            </p>
                            <p className="text-xs text-text-secondary mt-0.5">{usagePayload.currentUser.currency}</p>
                          </div>
                          <div className="p-4 rounded-lg border bg-bg-tertiary/50 border-white/10">
                            <p className="text-xs text-text-secondary mb-1">Models used</p>
                            <p className="text-2xl font-semibold text-text-primary tabular-nums">
                              {usagePayload.currentUser.pipelineModels.length}
                            </p>
                          </div>
                        </div>

                        {/* ── Pipeline / model table ── */}
                        {usagePayload.currentUser.pipelineModels.length > 0 ? (
                          <div className="mt-5 overflow-x-auto">
                            <table className="w-full text-sm border-collapse">
                              <thead>
                                <tr className="border-b border-white/8">
                                  <th className="py-2 pr-4 text-left text-xs font-medium text-text-secondary uppercase tracking-wide whitespace-nowrap">Pipeline</th>
                                  <th className="py-2 pr-4 text-left text-xs font-medium text-text-secondary uppercase tracking-wide whitespace-nowrap">Model</th>
                                  <th className="py-2 pr-4 text-right text-xs font-medium text-text-secondary uppercase tracking-wide whitespace-nowrap">Requests</th>
                                  <th className="py-2 text-right text-xs font-medium text-text-secondary uppercase tracking-wide whitespace-nowrap">Usage (USD)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...usagePayload.currentUser.pipelineModels]
                                  .sort((a, b) => b.requestCount - a.requestCount)
                                  .map((row) => (
                                    <tr
                                      key={`${row.pipeline}:${row.modelId}`}
                                      className="border-b border-white/5 hover:bg-white/3 transition-colors"
                                    >
                                      <td className="py-2.5 pr-4 text-text-secondary font-mono text-xs whitespace-nowrap">
                                        {row.pipeline}
                                      </td>
                                      <td className="py-2.5 pr-4 text-text-primary font-mono text-xs max-w-[18rem] truncate">
                                        {row.modelId}
                                      </td>
                                      <td className="py-2.5 pr-4 text-right font-mono text-xs text-text-primary tabular-nums whitespace-nowrap">
                                        {row.requestCount.toLocaleString()}
                                      </td>
                                      <td className="py-2.5 text-right font-mono text-xs text-text-primary tabular-nums whitespace-nowrap">
                                        {formatUsdMicros(row.networkFeeUsdMicros)}
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-xs text-text-secondary mt-4">
                            No pipeline/model breakdown for this period.
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="text-center py-10 mt-4 text-text-secondary">
                        <BarChart3 size={24} className="mx-auto mb-3 opacity-30" />
                        <p className="text-sm">No usage data for this period.</p>
                      </div>
                    )}
                  </>
                ) : usageBillingProviderSlug ? (
                  <p className="text-sm text-text-secondary mt-4">
                    Usage metrics for{' '}
                    <span className="text-text-primary font-medium">
                      {usagePanelProviders.find((p) => p.slug === usageBillingProviderSlug)?.displayName ??
                        usageBillingProviderSlug}
                    </span>{' '}
                    are not shown here yet. Use the billing provider&apos;s tools for account usage.
                  </p>
                ) : billingProvidersError ? (
                  <p className="text-sm text-text-secondary mt-4">
                    Unable to load billing providers. Use &quot;Retry providers&quot; above to try again.
                  </p>
                ) : billingProviders !== null && usagePanelProviders.length === 0 ? (
                  <p className="text-sm text-text-secondary mt-4">No billing providers available.</p>
                ) : (
                  <p className="text-sm text-text-secondary mt-4">Loading billing providers…</p>
                )}
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
      <Modal
        isOpen={showCreateModal}
        onClose={closeCreateModal}
        title={
          createStep === 'form'
            ? 'Create API Key'
            : createStep === 'oauth'
              ? selectedBillingProvider?.slug === 'pymthouse'
                ? 'Provisioning PymtHouse...'
                : 'Authenticating...'
              : 'API Key Created'
        }
        description={createStep === 'form' ? 'Configure your new API key' : undefined}
        size="lg"
        closeOnBackdrop={createStep !== 'oauth'}
        closeOnEscape={createStep !== 'oauth'}
        showCloseButton={createStep !== 'oauth'}
      >
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
                  ? 'Server-to-server link; no browser sign-in.'
                  : selectedBillingProvider
                    ? 'You will authenticate with this provider when you create the key.'
                    : 'Choose where usage and billing are managed.'}
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
                <div className="flex flex-wrap gap-2" role="group" aria-label="Billing provider">
                  {billingProviders.map((bp) => {
                    const selected = selectedBillingProviderId === bp.id;
                    return (
                      <button
                        key={bp.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedBillingProviderId(bp.id);
                          setSelectedDiscoveryPlanId('');
                        }}
                        className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                          selected
                            ? 'bg-accent-blue/15 border-accent-blue text-text-primary'
                            : 'bg-bg-tertiary border-white/10 text-text-secondary hover:border-white/25 hover:text-text-primary'
                        }`}
                      >
                        {bp.displayName}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {billingProviderSupportsPythonGatewayDiscovery(selectedBillingProvider?.slug) && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <label className="text-xs font-medium text-text-primary">
                    Discovery plan <span className="text-text-secondary font-normal">(optional)</span>
                  </label>
                  <Tooltip
                    position="right"
                    className="whitespace-normal max-w-xs text-xs leading-relaxed"
                    content={
                      selectedBillingProvider?.slug === 'pymthouse' ? (
                        <>
                          Pick a saved PymtHouse discovery plan, or leave blank for default discovery. Results are intersected
                          with your app&apos;s Network Price allowlist (
                          <code className="text-slate-300">GET …/manifest</code>
                          ); capabilities outside that list return no orchestrators. Discovery uses a new{' '}
                          <code className="text-slate-300">gw_…</code> gateway key; the signer still uses your billing provider
                          secret above.
                        </>
                      ) : (
                        <>
                          Pick a saved plan or leave blank for NaaP&apos;s default discovery for the python-gateway model.
                          No PymtHouse-style allowlist. Discovery uses a new <code className="text-slate-300">gw_…</code> gateway
                          key; the signer still uses your billing provider secret above.
                        </>
                      )
                    }
                  >
                    <button
                      type="button"
                      className="text-text-secondary hover:text-text-primary transition-colors"
                      aria-label="Discovery plan help"
                    >
                      <CircleHelp size={14} />
                    </button>
                  </Tooltip>
                </div>
                <p className="text-xs text-text-secondary mb-2">
                  {selectedBillingProvider?.slug === 'pymthouse'
                    ? 'Blank uses default discovery, filtered by your allowlist.'
                    : 'Blank uses NaaP default discovery for the requested model.'}
                </p>
                {discoveryPlansLoading ? (
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <Loader2 size={16} className="animate-spin" /> Loading plans…
                  </div>
                ) : discoveryPlans.length === 0 ? (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-200">
                    No discovery plans found. The SDK token will use NaaP's default model-based discovery response.
                  </div>
                ) : (
                  <select
                    value={selectedDiscoveryPlanId}
                    onChange={(e) => setSelectedDiscoveryPlanId(e.target.value)}
                    className={selectClassName}
                  >
                    <option value="">Select a plan…</option>
                    {discoveryPlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            {createError && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-300">
                <AlertTriangle size={16} className="flex-shrink-0" />{createError}
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={handleCreateKey}
                disabled={
                  creating ||
                  modalDataLoading ||
                  billingProvidersError ||
                  !billingProviders?.length ||
                  !selectedBillingProviderId ||
                  (billingProviderSupportsPythonGatewayDiscovery(selectedBillingProvider?.slug) && discoveryPlansLoading)
                }
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
                  ? 'Exchanging credentials with PymtHouse. This page updates when your key is ready.'
                  : 'Complete sign-in in the new tab. This page updates automatically.'}
              </p>
            </div>
            <button
              type="button"
              onClick={closeCreateModal}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors rounded-md hover:bg-white/5"
            >
              Cancel
            </button>
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
            {createdPythonGatewayToken ? (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-text-primary">SDK Token (python-gateway)</label>
                <p className="text-xs text-text-secondary">
                  Base64 JSON for python-gateway <code className="text-slate-300">--token</code> flag, includes signer
                  and discovery plan configuration
                </p>
                <div className="flex items-start gap-2">
                  <code className="max-h-40 flex-1 overflow-y-auto break-all rounded-lg border border-white/10 bg-bg-tertiary px-3 py-2 font-mono text-xs text-accent-emerald select-all">
                    {createdPythonGatewayToken}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopySdkToken}
                    className="flex-shrink-0 rounded-lg border border-white/10 bg-bg-tertiary p-2 hover:bg-white/5 transition-colors"
                    title="Copy SDK token"
                  >
                    {sdkTokenCopied ? <Check size={18} className="text-emerald-400" /> : <Copy size={18} className="text-text-secondary" />}
                  </button>
                </div>
              </div>
            ) : null}
            {gatewayDiscoveryKeyMintError ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100">
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-amber-400" aria-hidden />
                <p>{gatewayDiscoveryKeyMintError}</p>
              </div>
            ) : null}
            {createdPythonGatewayToken ? (
              <div className="rounded-lg border border-white/10 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setApiKeyPanelOpen((open) => !open)}
                  aria-expanded={apiKeyPanelOpen}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-medium text-text-primary hover:bg-white/5 transition-colors"
                >
                  <span>Your API Key (billing)</span>
                  <ChevronDown
                    size={16}
                    className={`flex-shrink-0 text-text-secondary transition-transform ${apiKeyPanelOpen ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>
                {apiKeyPanelOpen ? (
                  <div className="border-t border-white/10 bg-bg-tertiary/40 px-3 py-3">
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-bg-tertiary border border-white/10 rounded-lg py-2 px-3 font-mono text-sm text-accent-emerald break-all select-all">
                        {createdRawKey}
                      </code>
                      <button
                        onClick={handleCopyKey}
                        className="flex-shrink-0 p-2 bg-bg-tertiary border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
                        title="Copy to clipboard"
                      >
                        {keyCopied ? <Check size={18} className="text-emerald-400" /> : <Copy size={18} className="text-text-secondary" />}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-text-primary mb-1.5">Your API Key</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-bg-tertiary border border-white/10 rounded-lg py-2 px-3 font-mono text-sm text-accent-emerald break-all select-all">
                    {createdRawKey}
                  </code>
                  <button
                    onClick={handleCopyKey}
                    className="flex-shrink-0 p-2 bg-bg-tertiary border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
                    title="Copy to clipboard"
                  >
                    {keyCopied ? <Check size={18} className="text-emerald-400" /> : <Copy size={18} className="text-text-secondary" />}
                  </button>
                </div>
              </div>
            )}
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
