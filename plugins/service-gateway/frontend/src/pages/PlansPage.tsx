/**
 * PlansPage — Manage rate limit / quota plans.
 *
 * The "default" plan is auto-created and always present.
 * It applies to API keys with no explicit plan assigned.
 * It can be edited but not deleted.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { useGatewayApi, useAsync } from '../hooks/useGatewayApi';

interface Plan {
  id: string;
  name: string;
  displayName: string;
  rateLimit: number;
  dailyQuota: number | null;
  monthlyQuota: number | null;
  maxRequestSize: number;
  activeKeyCount: number;
}

const DEFAULT_PLAN_NAME = 'default';

export const PlansPage: React.FC = () => {
  const api = useGatewayApi();
  const { data, loading, execute } = useAsync<{ success: boolean; data: Plan[] }>();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [rateLimit, setRateLimit] = useState(100);
  const [dailyQuota, setDailyQuota] = useState('');
  const [monthlyQuota, setMonthlyQuota] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRateLimit, setEditRateLimit] = useState(100);
  const [editDailyQuota, setEditDailyQuota] = useState('');
  const [editMonthlyQuota, setEditMonthlyQuota] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadPlans = useCallback(() => {
    return execute(() => api.get('/plans'));
  }, [execute, api]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const handleCreate = async () => {
    if (!name || !displayName) return;
    setCreating(true);
    try {
      await api.post('/plans', {
        name,
        displayName,
        rateLimit,
        ...(dailyQuota ? { dailyQuota: parseInt(dailyQuota) } : {}),
        ...(monthlyQuota ? { monthlyQuota: parseInt(monthlyQuota) } : {}),
      });
      setShowCreate(false);
      setName('');
      setDisplayName('');
      setRateLimit(100);
      setDailyQuota('');
      setMonthlyQuota('');
      loadPlans();
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (plan: Plan) => {
    setEditingId(plan.id);
    setEditDisplayName(plan.displayName);
    setEditRateLimit(plan.rateLimit);
    setEditDailyQuota(plan.dailyQuota?.toString() || '');
    setEditMonthlyQuota(plan.monthlyQuota?.toString() || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleSave = async (planId: string) => {
    setSaving(true);
    try {
      await api.put(`/plans/${planId}`, {
        displayName: editDisplayName,
        rateLimit: editRateLimit,
        dailyQuota: editDailyQuota ? parseInt(editDailyQuota) : null,
        monthlyQuota: editMonthlyQuota ? parseInt(editMonthlyQuota) : null,
      });
      setEditingId(null);
      loadPlans();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (planId: string) => {
    setDeleteError(null);
    try {
      const res = await api.del(`/plans/${planId}`) as { success?: boolean; error?: string };
      if (res && !res.success && res.error) {
        setDeleteError(res.error);
      } else {
        loadPlans();
      }
    } catch {
      setDeleteError('Failed to delete plan.');
    }
  };

  const plans = data?.data || [];
  const sortedPlans = [...plans].sort((a, b) => {
    if (a.name === DEFAULT_PLAN_NAME) return -1;
    if (b.name === DEFAULT_PLAN_NAME) return 1;
    return 0;
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Plans</h1>
          <p className="text-sm text-text-tertiary mt-1">
            Rate limit and quota templates. The default plan applies to API keys with no explicit plan.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-accent-emerald hover:bg-accent-emerald/90 text-white text-sm font-medium rounded-lg"
        >
          + New Plan
        </button>
      </div>

      {deleteError && (
        <div className="mb-4 px-4 py-2 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-300">
          {deleteError}
          <button onClick={() => setDeleteError(null)} className="ml-2 text-red-400 hover:text-red-200">✕</button>
        </div>
      )}

      {showCreate && (
        <div className="bg-bg-secondary border border-[var(--border-color)] rounded-lg p-5 mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-xs text-text-secondary">Name (slug)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="pro-tier"
                className="w-full px-3 py-2 bg-bg-primary border border-[var(--border-color)] rounded-lg text-text-primary text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-text-secondary">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Pro Tier"
                className="w-full px-3 py-2 bg-bg-primary border border-[var(--border-color)] rounded-lg text-text-primary text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-text-secondary">Rate Limit (req/min)</label>
              <input
                type="number"
                value={rateLimit}
                onChange={(e) => setRateLimit(parseInt(e.target.value) || 100)}
                className="w-full px-3 py-2 bg-bg-primary border border-[var(--border-color)] rounded-lg text-text-primary text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-text-secondary">Daily Quota (optional)</label>
              <input
                type="number"
                value={dailyQuota}
                onChange={(e) => setDailyQuota(e.target.value)}
                placeholder="Unlimited"
                className="w-full px-3 py-2 bg-bg-primary border border-[var(--border-color)] rounded-lg text-text-primary text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-text-secondary">Monthly Quota (optional)</label>
              <input
                type="number"
                value={monthlyQuota}
                onChange={(e) => setMonthlyQuota(e.target.value)}
                placeholder="Unlimited"
                className="w-full px-3 py-2 bg-bg-primary border border-[var(--border-color)] rounded-lg text-text-primary text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-text-tertiary text-sm">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={!name || !displayName || creating}
              className="px-4 py-1.5 bg-accent-emerald hover:bg-accent-emerald/90 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className="bg-bg-secondary border border-[var(--border-color)] rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-color)]">
              <th className="px-4 py-2 text-left text-text-secondary font-medium">Name</th>
              <th className="px-4 py-2 text-left text-text-secondary font-medium">Rate Limit</th>
              <th className="px-4 py-2 text-left text-text-secondary font-medium">Daily Quota</th>
              <th className="px-4 py-2 text-left text-text-secondary font-medium">Monthly Quota</th>
              <th className="px-4 py-2 text-left text-text-secondary font-medium">Active Keys</th>
              <th className="px-4 py-2 text-right text-text-secondary font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-text-tertiary">Loading...</td></tr>
            )}
            {!loading && sortedPlans.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-text-tertiary">No plans yet.</td></tr>
            )}
            {sortedPlans.map((plan) => {
              const isDefault = plan.name === DEFAULT_PLAN_NAME;
              const isEditing = editingId === plan.id;

              if (isEditing) {
                return (
                  <tr key={plan.id} className="border-b border-[var(--border-color)] bg-bg-secondary/30">
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={editDisplayName}
                        onChange={(e) => setEditDisplayName(e.target.value)}
                        className="w-full px-2 py-1 bg-bg-primary border border-[var(--border-color)] rounded text-text-primary text-sm"
                      />
                      <div className="text-xs text-text-tertiary font-mono mt-1">{plan.name}</div>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        value={editRateLimit}
                        onChange={(e) => setEditRateLimit(parseInt(e.target.value) || 1)}
                        className="w-20 px-2 py-1 bg-bg-primary border border-[var(--border-color)] rounded text-text-primary text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        value={editDailyQuota}
                        onChange={(e) => setEditDailyQuota(e.target.value)}
                        placeholder="∞"
                        className="w-24 px-2 py-1 bg-bg-primary border border-[var(--border-color)] rounded text-text-primary text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        value={editMonthlyQuota}
                        onChange={(e) => setEditMonthlyQuota(e.target.value)}
                        placeholder="∞"
                        className="w-24 px-2 py-1 bg-bg-primary border border-[var(--border-color)] rounded text-text-primary text-sm"
                      />
                    </td>
                    <td className="px-4 py-2 text-text-secondary">{plan.activeKeyCount}</td>
                    <td className="px-4 py-2 text-right space-x-2">
                      <button
                        onClick={() => handleSave(plan.id)}
                        disabled={saving || !editDisplayName}
                        className="text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button onClick={cancelEdit} className="text-xs text-text-tertiary hover:text-text-primary">
                        Cancel
                      </button>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={plan.id} className="border-b border-[var(--border-color)]">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-text-primary">{plan.displayName}</span>
                      {isDefault && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent-emerald/20 text-accent-emerald border border-accent-emerald/30 uppercase tracking-wider">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-tertiary font-mono">{plan.name}</div>
                    {isDefault && (
                      <div className="text-[11px] text-text-tertiary mt-0.5">
                        Applied to API keys with no explicit plan
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-text-secondary">{plan.rateLimit}/min</td>
                  <td className="px-4 py-2 text-text-secondary">{plan.dailyQuota?.toLocaleString() || '∞'}</td>
                  <td className="px-4 py-2 text-text-secondary">{plan.monthlyQuota?.toLocaleString() || '∞'}</td>
                  <td className="px-4 py-2 text-text-secondary">{plan.activeKeyCount}</td>
                  <td className="px-4 py-2 text-right space-x-2">
                    <button
                      onClick={() => startEdit(plan)}
                      className="text-xs text-accent-emerald hover:text-accent-emerald/80"
                    >
                      Edit
                    </button>
                    {!isDefault && (
                      <button
                        onClick={() => handleDelete(plan.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                        title={plan.activeKeyCount > 0 ? 'Cannot delete: active keys exist' : 'Delete plan'}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
