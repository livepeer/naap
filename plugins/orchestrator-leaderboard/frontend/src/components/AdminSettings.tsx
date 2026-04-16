import React, { useState } from 'react';
import { Settings, RefreshCw, Clock, Database } from 'lucide-react';
import { useAuthService } from '@naap/plugin-sdk';
import { useDatasetConfig } from '../hooks/useDatasetConfig';

const INTERVAL_OPTIONS = [
  { value: 1, label: '1 hour' },
  { value: 4, label: '4 hours' },
  { value: 8, label: '8 hours' },
  { value: 12, label: '12 hours' },
] as const;

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatRefreshedBy(by: string | null): string {
  if (!by) return '—';
  if (by === 'cron') return 'Scheduled (cron)';
  if (by.startsWith('admin:')) return 'Admin (manual)';
  return by;
}

export const AdminSettings: React.FC = () => {
  const auth = useAuthService();
  const isAdmin = auth.hasRole('system:admin');

  const {
    config,
    isLoading,
    error,
    updateInterval,
    refreshNow,
    isRefreshing,
    lastRefreshResult,
  } = useDatasetConfig();

  const [isOpen, setIsOpen] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  if (!isAdmin) return null;

  return (
    <div className="mb-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        style={{
          color: 'var(--text-supporting)',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
        }}
      >
        <Settings size={14} />
        Dataset Settings
        <span
          className="ml-1 transition-transform"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          ▾
        </span>
      </button>

      {isOpen && (
        <div
          className="mt-3 p-4 rounded-xl"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
          }}
        >
          {isLoading ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Loading config…
            </p>
          ) : error && !config ? (
            <p className="text-sm" style={{ color: 'var(--accent-rose)' }}>
              {error}
            </p>
          ) : config ? (
            <div className="space-y-4">
              {/* Refresh Interval */}
              <div>
                <label
                  className="block text-xs font-medium mb-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <Clock size={12} className="inline mr-1" />
                  Refresh Interval
                </label>
                <div className="flex gap-2 flex-wrap">
                  {INTERVAL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={async () => {
                        setUpdateError(null);
                        try {
                          await updateInterval(opt.value);
                        } catch (e) {
                          setUpdateError(
                            e instanceof Error ? e.message : 'Update failed',
                          );
                        }
                      }}
                      className="px-3 py-1.5 text-xs font-medium rounded-full border transition-all cursor-pointer"
                      style={
                        config.refreshIntervalHours === opt.value
                          ? {
                              background: 'rgba(30, 153, 96, 0.15)',
                              color: 'var(--accent-emerald)',
                              borderColor: 'rgba(30, 153, 96, 0.3)',
                            }
                          : {
                              background: 'var(--bg-tertiary)',
                              color: 'var(--text-secondary)',
                              borderColor: 'var(--border-color)',
                            }
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {updateError && (
                  <p className="text-xs mt-1" style={{ color: 'var(--accent-rose)' }}>
                    {updateError}
                  </p>
                )}
              </div>

              {/* Last Refresh Info */}
              <div className="flex items-center gap-4 flex-wrap text-xs" style={{ color: 'var(--text-supporting)' }}>
                <span className="flex items-center gap-1">
                  <Database size={12} />
                  Last refresh: {formatRelativeTime(config.lastRefreshedAt)}
                </span>
                <span>By: {formatRefreshedBy(config.lastRefreshedBy)}</span>
                {lastRefreshResult && (
                  <span style={{ color: 'var(--accent-emerald)' }}>
                    {lastRefreshResult.capabilities} capabilities, {lastRefreshResult.orchestrators} orchestrators
                  </span>
                )}
              </div>

              {/* Refresh Now */}
              <button
                onClick={async () => {
                  setUpdateError(null);
                  try {
                    await refreshNow();
                  } catch (e) {
                    setUpdateError(
                      e instanceof Error ? e.message : 'Refresh failed',
                    );
                  }
                }}
                disabled={isRefreshing}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                style={{
                  background: 'var(--accent-emerald)',
                  color: '#fff',
                }}
              >
                <RefreshCw
                  size={12}
                  className={isRefreshing ? 'animate-spin' : ''}
                />
                {isRefreshing ? 'Refreshing…' : 'Refresh Now'}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
