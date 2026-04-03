/**
 * AlertsPanel - Alert history list with bell icon + unread badge
 */

import React, { useState } from 'react';

interface AlertHistoryItem {
  id: string;
  message: string;
  data: string | null;
  readAt: string | null;
  createdAt: string;
  alert?: { type: string; orchestratorAddr: string | null };
}

interface AlertsPanelProps {
  history: AlertHistoryItem[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onConfigure: () => void;
  isLoading: boolean;
}

const ALERT_ICONS: Record<string, string> = {
  reward_cut_change: 'text-amber-400',
  missed_reward: 'text-rose-400',
  deactivation: 'text-rose-500',
  unbonding_ready: 'text-emerald-400',
};

export const AlertsPanel: React.FC<AlertsPanelProps> = ({
  history,
  unreadCount,
  onMarkRead,
  onConfigure,
  isLoading,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
        aria-label={`Alerts${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <svg className="w-5 h-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto rounded-xl bg-bg-secondary border border-white/10 shadow-2xl z-50">
          <div className="flex items-center justify-between p-3 border-b border-white/10">
            <h4 className="text-sm font-semibold text-text-primary">Alerts</h4>
            <button
              onClick={onConfigure}
              className="text-xs text-purple-400 hover:text-purple-300"
            >
              Configure
            </button>
          </div>

          {isLoading ? (
            <div className="p-4 text-center text-text-muted text-sm">Loading...</div>
          ) : history.length === 0 ? (
            <div className="p-4 text-center text-text-muted text-sm">No alerts yet</div>
          ) : (
            <div className="divide-y divide-white/5">
              {history.map(item => (
                <div
                  key={item.id}
                  className={`p-3 hover:bg-white/5 transition-colors ${!item.readAt ? 'bg-white/[0.02]' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                      !item.readAt ? 'bg-purple-500' : 'bg-transparent'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary leading-snug">{item.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] uppercase tracking-wide font-medium ${
                          ALERT_ICONS[item.alert?.type || ''] || 'text-text-muted'
                        }`}>
                          {item.alert?.type?.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] text-text-muted">
                          {new Date(item.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    {!item.readAt && (
                      <button
                        onClick={() => onMarkRead(item.id)}
                        className="text-[10px] text-text-muted hover:text-text-primary flex-shrink-0"
                        aria-label="Mark as read"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
