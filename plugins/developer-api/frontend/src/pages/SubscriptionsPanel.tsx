/**
 * Subscriptions panel (NAAP P3) — developer-facing multi-app surface.
 *
 * Browse the catalog of provider instances, subscribe to one or many, and per
 * subscription: create / list / revoke native `naap_` keys (the mint-key
 * control that was previously missing a UI) and view per-key usage.
 *
 * This panel renders ONLY when the `multi_subscription` flag is ON — the parent
 * gates it on a successful `GET /api/v1/catalog` probe (404 when OFF), so with
 * the flag OFF the dev-manager is byte-for-byte today's experience. All calls
 * are tenant-scoped to the selected team. The raw key is shown exactly once.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Card, Badge, Modal } from '@naap/ui';
import { Plus, Trash2, Copy, Check, Loader2, BarChart3, Boxes, Key } from 'lucide-react';

interface TeamInfo {
  id: string;
  name: string;
}

interface CatalogInstance {
  providerInstanceId: string;
  slug: string;
  displayName: string;
  adapterType: string;
  plans: Array<{ providerPlanId: string; name: string; capabilities: string[] }>;
}

interface SubscriptionView {
  id: string;
  providerInstanceId: string;
  providerPlanId: string | null;
  accountId: string;
  status: string;
  appId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SubKey {
  id: string;
  keyPrefix: string;
  label: string | null;
  status: string;
  subscriptionId: string | null;
  createdAt: string;
}

interface KeyUsage {
  keyId: string;
  totals: { requestCount: number; tokensUsed: number; costIncurred: number };
}

const btnPrimary =
  'flex items-center gap-2 px-3 py-1.5 bg-accent-emerald text-white rounded-md text-xs font-medium hover:bg-accent-emerald/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost =
  'px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors rounded-md hover:bg-white/5';
const selectClassName =
  'bg-bg-tertiary border border-white/10 rounded-md py-1.5 px-2 text-xs text-text-primary focus:outline-none focus:border-accent-blue appearance-none cursor-pointer';

async function fetchCsrfToken(): Promise<string> {
  try {
    const res = await fetch('/api/v1/auth/csrf', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      return data.data?.token || data.token || '';
    }
  } catch {
    /* ignore */
  }
  return '';
}

function unwrap<T>(json: { data?: T } & T): T {
  return (json.data ?? json) as T;
}

export const SubscriptionsPanel: React.FC = () => {
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [teamId, setTeamId] = useState<string>('');
  const [catalog, setCatalog] = useState<CatalogInstance[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyInstanceId, setBusyInstanceId] = useState<string | null>(null);

  // Per-subscription key state.
  const [expandedSubId, setExpandedSubId] = useState<string | null>(null);
  const [keysBySub, setKeysBySub] = useState<Record<string, SubKey[]>>({});
  const [usageByKey, setUsageByKey] = useState<Record<string, KeyUsage>>({});
  const [mintingSubId, setMintingSubId] = useState<string | null>(null);
  const [createdRawKey, setCreatedRawKey] = useState('');
  const [rawKeyCopied, setRawKeyCopied] = useState(false);

  const instanceById = useCallback(
    (id: string) => catalog.find((c) => c.providerInstanceId === id),
    [catalog],
  );

  const loadTeams = useCallback(async () => {
    const res = await fetch('/api/v1/teams', { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to load teams (HTTP ${res.status})`);
    const list = unwrap<{ teams: TeamInfo[] }>(await res.json()).teams ?? [];
    setTeams(list);
    setTeamId((prev) => prev || (list[0]?.id ?? ''));
    return list;
  }, []);

  const loadCatalog = useCallback(async () => {
    const res = await fetch('/api/v1/catalog', { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to load catalog (HTTP ${res.status})`);
    setCatalog(unwrap<{ instances: CatalogInstance[] }>(await res.json()).instances ?? []);
  }, []);

  const loadSubscriptions = useCallback(async (tid: string) => {
    if (!tid) {
      setSubscriptions([]);
      return;
    }
    const res = await fetch(`/api/v1/teams/${encodeURIComponent(tid)}/subscriptions`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Failed to load subscriptions (HTTP ${res.status})`);
    setSubscriptions(unwrap<{ subscriptions: SubscriptionView[] }>(await res.json()).subscriptions ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [list] = await Promise.all([loadTeams(), loadCatalog()]);
        if (cancelled) return;
        const tid = list[0]?.id ?? '';
        if (tid) await loadSubscriptions(tid);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load subscriptions');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTeams, loadCatalog, loadSubscriptions]);

  useEffect(() => {
    if (!teamId) return;
    void loadSubscriptions(teamId).catch((e) =>
      setError(e instanceof Error ? e.message : 'Failed to load subscriptions'),
    );
  }, [teamId, loadSubscriptions]);

  const handleSubscribe = useCallback(
    async (providerInstanceId: string) => {
      if (!teamId) return;
      setBusyInstanceId(providerInstanceId);
      setError(null);
      try {
        const csrf = await fetchCsrfToken();
        const res = await fetch(`/api/v1/teams/${encodeURIComponent(teamId)}/subscriptions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          credentials: 'include',
          body: JSON.stringify({ providerInstanceId }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error?.message || `Failed to subscribe (HTTP ${res.status})`);
        }
        await loadSubscriptions(teamId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to subscribe');
      } finally {
        setBusyInstanceId(null);
      }
    },
    [teamId, loadSubscriptions],
  );

  const handleCancel = useCallback(
    async (subId: string) => {
      if (!teamId) return;
      setError(null);
      try {
        const csrf = await fetchCsrfToken();
        const res = await fetch(
          `/api/v1/teams/${encodeURIComponent(teamId)}/subscriptions/${encodeURIComponent(subId)}`,
          { method: 'DELETE', headers: { 'X-CSRF-Token': csrf }, credentials: 'include' },
        );
        if (!res.ok) throw new Error(`Failed to cancel (HTTP ${res.status})`);
        await loadSubscriptions(teamId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to cancel subscription');
      }
    },
    [teamId, loadSubscriptions],
  );

  const loadKeys = useCallback(
    async (subId: string) => {
      if (!teamId) return;
      const res = await fetch(
        `/api/v1/teams/${encodeURIComponent(teamId)}/subscriptions/${encodeURIComponent(subId)}/keys`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(`Failed to load keys (HTTP ${res.status})`);
      const keys = unwrap<{ keys: SubKey[] }>(await res.json()).keys ?? [];
      setKeysBySub((prev) => ({ ...prev, [subId]: keys }));
    },
    [teamId],
  );

  const toggleExpand = useCallback(
    async (subId: string) => {
      const next = expandedSubId === subId ? null : subId;
      setExpandedSubId(next);
      if (next) await loadKeys(next).catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
    },
    [expandedSubId, loadKeys],
  );

  const handleMintKey = useCallback(
    async (subId: string) => {
      if (!teamId) return;
      setMintingSubId(subId);
      setError(null);
      try {
        const csrf = await fetchCsrfToken();
        const res = await fetch(
          `/api/v1/teams/${encodeURIComponent(teamId)}/subscriptions/${encodeURIComponent(subId)}/keys`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
            credentials: 'include',
            body: JSON.stringify({}),
          },
        );
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error?.message || `Failed to mint key (HTTP ${res.status})`);
        const raw = unwrap<{ rawKey: string }>(j).rawKey ?? '';
        setCreatedRawKey(raw);
        setRawKeyCopied(false);
        await loadKeys(subId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to mint key');
      } finally {
        setMintingSubId(null);
      }
    },
    [teamId, loadKeys],
  );

  const handleRevokeKey = useCallback(
    async (subId: string, keyId: string) => {
      if (!teamId) return;
      try {
        const csrf = await fetchCsrfToken();
        const res = await fetch(
          `/api/v1/teams/${encodeURIComponent(teamId)}/subscriptions/${encodeURIComponent(subId)}/keys/${encodeURIComponent(keyId)}`,
          { method: 'DELETE', headers: { 'X-CSRF-Token': csrf }, credentials: 'include' },
        );
        if (!res.ok) throw new Error(`Failed to revoke (HTTP ${res.status})`);
        await loadKeys(subId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to revoke key');
      }
    },
    [teamId, loadKeys],
  );

  const loadUsage = useCallback(
    async (subId: string, keyId: string) => {
      if (!teamId) return;
      try {
        const res = await fetch(
          `/api/v1/teams/${encodeURIComponent(teamId)}/subscriptions/${encodeURIComponent(subId)}/keys/${encodeURIComponent(keyId)}/usage`,
          { credentials: 'include' },
        );
        if (!res.ok) throw new Error(`Failed to load usage (HTTP ${res.status})`);
        const usage = unwrap<KeyUsage>(await res.json());
        setUsageByKey((prev) => ({ ...prev, [keyId]: usage }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load usage');
      }
    },
    [teamId],
  );

  const handleCopyRawKey = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(createdRawKey);
      setRawKeyCopied(true);
      setTimeout(() => setRawKeyCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [createdRawKey]);

  if (loading) {
    return (
      <Card>
        <div className="flex items-center justify-center gap-3 py-8">
          <Loader2 size={16} className="animate-spin text-text-secondary" />
          <span className="text-sm text-text-secondary">Loading subscriptions…</span>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Boxes size={14} className="text-accent-blue" />
          <h2 className="text-sm font-semibold text-text-primary">Apps &amp; Subscriptions</h2>
        </div>
        {teams.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">Team</span>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={selectClassName}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-300">{error}</div>
      )}

      {/* ── Catalog ── */}
      <Card>
        <h3 className="text-sm font-semibold text-text-primary mb-3">Catalog</h3>
        {catalog.length === 0 ? (
          <p className="text-sm text-text-secondary">No provider instances available yet.</p>
        ) : (
          <div className="space-y-2">
            {catalog.map((c) => (
              <div
                key={c.providerInstanceId}
                className="flex items-center justify-between gap-3 p-3 rounded-lg border border-white/10 bg-bg-tertiary/40"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{c.displayName}</p>
                  <p className="text-xs text-text-secondary font-mono truncate">
                    {c.slug} · {c.adapterType}
                  </p>
                </div>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={!teamId || busyInstanceId === c.providerInstanceId}
                  onClick={() => handleSubscribe(c.providerInstanceId)}
                >
                  {busyInstanceId === c.providerInstanceId ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Plus size={14} />
                  )}
                  Subscribe
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── My subscriptions ── */}
      <Card>
        <h3 className="text-sm font-semibold text-text-primary mb-3">My subscriptions</h3>
        {subscriptions.length === 0 ? (
          <p className="text-sm text-text-secondary">No subscriptions yet. Subscribe to an app above.</p>
        ) : (
          <div className="space-y-2">
            {subscriptions.map((s) => {
              const inst = instanceById(s.providerInstanceId);
              const expanded = expandedSubId === s.id;
              const keys = keysBySub[s.id] ?? [];
              return (
                <div key={s.id} className="rounded-lg border border-white/10 overflow-hidden">
                  <div className="flex items-center justify-between gap-3 p-3 bg-bg-tertiary/40">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary truncate">
                          {inst?.displayName ?? s.providerInstanceId}
                        </span>
                        <Badge variant={s.status === 'active' ? 'emerald' : 'rose'}>{s.status}</Badge>
                      </div>
                      <p className="text-xs text-text-secondary font-mono truncate">{s.id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" className={btnGhost} onClick={() => toggleExpand(s.id)}>
                        <span className="inline-flex items-center gap-1">
                          <Key size={14} /> {expanded ? 'Hide keys' : 'Keys'}
                        </span>
                      </button>
                      {s.status === 'active' && (
                        <button
                          type="button"
                          className="p-1.5 hover:bg-white/5 rounded-md text-accent-rose"
                          title="Cancel subscription"
                          onClick={() => handleCancel(s.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-white/10 p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-secondary">
                          {keys.length} key{keys.length !== 1 ? 's' : ''}
                        </span>
                        <button
                          type="button"
                          className={btnPrimary}
                          disabled={s.status !== 'active' || mintingSubId === s.id}
                          onClick={() => handleMintKey(s.id)}
                        >
                          {mintingSubId === s.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Plus size={14} />
                          )}
                          Create Key
                        </button>
                      </div>
                      {keys.length === 0 ? (
                        <p className="text-xs text-text-secondary">No keys for this subscription yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {keys.map((k) => {
                            const usage = usageByKey[k.id];
                            return (
                              <div
                                key={k.id}
                                className="flex items-center justify-between gap-3 rounded-md border border-white/5 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <span className="text-sm font-mono text-text-primary">
                                    {k.label ? `${k.label} · ` : ''}
                                    {k.keyPrefix}
                                  </span>
                                  {usage && (
                                    <span className="ml-2 text-xs text-text-secondary">
                                      {usage.totals.requestCount.toLocaleString()} req
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant={k.status === 'ACTIVE' ? 'emerald' : 'rose'}>{k.status}</Badge>
                                  <button
                                    type="button"
                                    className="p-1.5 hover:bg-white/5 rounded-md text-text-secondary"
                                    title="View usage"
                                    onClick={() => loadUsage(s.id, k.id)}
                                  >
                                    <BarChart3 size={15} />
                                  </button>
                                  {k.status !== 'REVOKED' && (
                                    <button
                                      type="button"
                                      className="p-1.5 hover:bg-white/5 rounded-md text-accent-rose"
                                      title="Revoke key"
                                      onClick={() => handleRevokeKey(s.id, k.id)}
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── New-key reveal (shown once) ── */}
      <Modal isOpen={createdRawKey !== ''} onClose={() => setCreatedRawKey('')} title="API Key Created" size="lg">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Store this key securely. It is provider-opaque and will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-bg-tertiary border border-white/10 rounded-lg py-2 px-3 font-mono text-sm text-accent-emerald break-all select-all">
              {createdRawKey}
            </code>
            <button
              type="button"
              onClick={handleCopyRawKey}
              className="flex-shrink-0 p-2 bg-bg-tertiary border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
              title="Copy to clipboard"
            >
              {rawKeyCopied ? <Check size={18} className="text-emerald-400" /> : <Copy size={18} className="text-text-secondary" />}
            </button>
          </div>
          <div className="flex justify-end">
            <button type="button" className={btnPrimary} onClick={() => setCreatedRawKey('')}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default SubscriptionsPanel;
