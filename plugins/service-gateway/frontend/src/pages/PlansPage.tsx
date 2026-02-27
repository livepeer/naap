/**
 * PlansPage — Manage rate limit / quota plans.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { useGatewayApi, useAsync } from '../hooks/useGatewayApi';
import { TeamGuard } from '../components/TeamGuard';

interface Plan {
  id: string;
  name: string;
  displayName: string;
  rateLimit: number;
  dailyQuota: number | null;
  monthlyQuota: number | null;
  activeKeyCount: number;
}

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

  const handleDelete = async (planId: string) => {
    try {
      await api.del(`/plans/${planId}`);
      loadPlans();
    } catch (err) {
      // Plan may have active keys
    }
  };

  const plans = data?.data || [];

  return (
    <TeamGuard>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-100">Plans</h1>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
          >
            + New Plan
          </button>
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5 mb-6 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs text-gray-400">Name (slug)</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  placeholder="free-tier"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-200 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs text-gray-400">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Free Tier"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-200 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs text-gray-400">Rate Limit (req/min)</label>
                <input
                  type="number"
                  value={rateLimit}
                  onChange={(e) => setRateLimit(parseInt(e.target.value) || 100)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-200 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs text-gray-400">Daily Quota (optional)</label>
                <input
                  type="number"
                  value={dailyQuota}
                  onChange={(e) => setDailyQuota(e.target.value)}
                  placeholder="Unlimited"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-200 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs text-gray-400">Monthly Quota (optional)</label>
                <input
                  type="number"
                  value={monthlyQuota}
                  onChange={(e) => setMonthlyQuota(e.target.value)}
                  placeholder="Unlimited"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-200 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-gray-400 text-sm">Cancel</button>
              <button
                onClick={handleCreate}
                disabled={!name || !displayName || creating}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        )}

        {/* Plans Table */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="px-4 py-2 text-left text-gray-400 font-medium">Name</th>
                <th className="px-4 py-2 text-left text-gray-400 font-medium">Rate Limit</th>
                <th className="px-4 py-2 text-left text-gray-400 font-medium">Daily Quota</th>
                <th className="px-4 py-2 text-left text-gray-400 font-medium">Monthly Quota</th>
                <th className="px-4 py-2 text-left text-gray-400 font-medium">Active Keys</th>
                <th className="px-4 py-2 text-right text-gray-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
              )}
              {!loading && plans.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No plans. Create one to set rate limits.</td></tr>
              )}
              {plans.map((plan) => (
                <tr key={plan.id} className="border-b border-gray-700/50">
                  <td className="px-4 py-2">
                    <div className="text-gray-200">{plan.displayName}</div>
                    <div className="text-xs text-gray-500 font-mono">{plan.name}</div>
                  </td>
                  <td className="px-4 py-2 text-gray-300">{plan.rateLimit}/min</td>
                  <td className="px-4 py-2 text-gray-300">{plan.dailyQuota?.toLocaleString() || '∞'}</td>
                  <td className="px-4 py-2 text-gray-300">{plan.monthlyQuota?.toLocaleString() || '∞'}</td>
                  <td className="px-4 py-2 text-gray-300">{plan.activeKeyCount}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleDelete(plan.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                      title={plan.activeKeyCount > 0 ? 'Cannot delete: active keys exist' : 'Delete plan'}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </TeamGuard>
  );
};
