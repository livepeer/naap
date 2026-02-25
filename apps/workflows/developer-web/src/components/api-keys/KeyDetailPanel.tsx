import React from 'react';
import { motion } from 'framer-motion';
import { X, Copy, RotateCw, Edit3, Trash2, Clock, Activity, BarChart3 } from 'lucide-react';
import { Badge } from '@naap/ui';
import type { DeveloperApiKey, UsageRecord } from '@naap/types';

interface KeyDetailPanelProps {
  apiKey: DeveloperApiKey;
  usageRecords: UsageRecord[];
  onClose: () => void;
  onCopy: () => void;
  onRotate: () => void;
  onRename: () => void;
  onRevoke: () => void;
}

export const KeyDetailPanel: React.FC<KeyDetailPanelProps> = ({
  apiKey,
  usageRecords,
  onClose,
  onCopy,
  onRotate,
  onRename,
  onRevoke,
}) => {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Calculate usage stats
  const todayUsage = usageRecords.find((r) => {
    const today = new Date().toISOString().split('T')[0];
    return r.date === today;
  });

  const weekUsage = usageRecords.slice(-7).reduce(
    (acc, r) => ({
      sessions: acc.sessions + r.sessions,
      outputMinutes: acc.outputMinutes + r.outputMinutes,
      estimatedCost: acc.estimatedCost + r.estimatedCost,
    }),
    { sessions: 0, outputMinutes: 0, estimatedCost: 0 }
  );

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed right-0 top-0 h-full w-[450px] bg-bg-secondary border-l border-white/10 z-50 overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-text-primary">{apiKey.projectName}</h2>
            <p className="text-sm font-mono text-text-secondary mt-1">{apiKey.keyHash}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
            <X size={20} className="text-text-secondary" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={apiKey.status === 'active' ? 'emerald' : 'rose'}>
            {apiKey.status.toUpperCase()}
          </Badge>
          <span className="text-xs text-text-secondary">
            Created {formatDate(apiKey.createdAt)}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
        {/* Key Details */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-text-secondary uppercase tracking-widest">
            Key Details
          </h3>
          <div className="space-y-3">
            <div className="p-4 bg-bg-tertiary/50 rounded-xl">
              <p className="text-xs text-text-secondary mb-1">Model</p>
              <p className="font-medium text-text-primary">{apiKey.modelName}</p>
            </div>
            <div className="p-4 bg-bg-tertiary/50 rounded-xl">
              <p className="text-xs text-text-secondary mb-1">Provider</p>
              <p className="font-medium text-text-primary">{apiKey.providerDisplayName || '—'}</p>
            </div>
            <div className="p-4 bg-bg-tertiary/50 rounded-xl">
              <p className="text-xs text-text-secondary mb-1">Last Used</p>
              <p className="font-medium text-text-primary">
                {apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : 'Never used'}
              </p>
            </div>
          </div>
        </div>

        {/* Quick Usage Stats */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-text-secondary uppercase tracking-widest">
            Usage Summary
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 bg-bg-tertiary/50 rounded-xl">
              <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
                <Activity size={12} />
                <span>Today</span>
              </div>
              <p className="text-lg font-mono font-bold text-text-primary">
                {todayUsage?.sessions || 0}
              </p>
              <p className="text-xs text-text-secondary">sessions</p>
            </div>
            <div className="p-4 bg-bg-tertiary/50 rounded-xl">
              <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
                <Clock size={12} />
                <span>Today</span>
              </div>
              <p className="text-lg font-mono font-bold text-text-primary">
                {todayUsage?.outputMinutes.toFixed(1) || '0.0'}
              </p>
              <p className="text-xs text-text-secondary">minutes</p>
            </div>
            <div className="p-4 bg-bg-tertiary/50 rounded-xl">
              <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
                <BarChart3 size={12} />
                <span>This Week</span>
              </div>
              <p className="text-lg font-mono font-bold text-text-primary">
                {weekUsage.sessions}
              </p>
              <p className="text-xs text-text-secondary">sessions</p>
            </div>
            <div className="p-4 bg-bg-tertiary/50 rounded-xl">
              <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
                <BarChart3 size={12} />
                <span>This Week</span>
              </div>
              <p className="text-lg font-mono font-bold text-accent-emerald">
                ${weekUsage.estimatedCost.toFixed(2)}
              </p>
              <p className="text-xs text-text-secondary">estimated</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-text-secondary uppercase tracking-widest">
            Actions
          </h3>
          <div className="space-y-2">
            <button
              onClick={onCopy}
              className="w-full flex items-center gap-3 p-4 bg-bg-tertiary/50 rounded-xl hover:bg-bg-tertiary transition-colors text-left"
            >
              <Copy size={18} className="text-accent-blue" />
              <div>
                <p className="font-medium text-text-primary">Copy Key Hash</p>
                <p className="text-xs text-text-secondary">Copy the masked key identifier</p>
              </div>
            </button>
            <button
              onClick={onRotate}
              disabled={apiKey.status === 'revoked'}
              className="w-full flex items-center gap-3 p-4 bg-bg-tertiary/50 rounded-xl hover:bg-bg-tertiary transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCw size={18} className="text-accent-amber" />
              <div>
                <p className="font-medium text-text-primary">Rotate Key</p>
                <p className="text-xs text-text-secondary">Generate a new secret key</p>
              </div>
            </button>
            <button
              onClick={onRename}
              className="w-full flex items-center gap-3 p-4 bg-bg-tertiary/50 rounded-xl hover:bg-bg-tertiary transition-colors text-left"
            >
              <Edit3 size={18} className="text-text-secondary" />
              <div>
                <p className="font-medium text-text-primary">Rename Project</p>
                <p className="text-xs text-text-secondary">Update the project name</p>
              </div>
            </button>
            <button
              onClick={onRevoke}
              disabled={apiKey.status === 'revoked'}
              className="w-full flex items-center gap-3 p-4 bg-accent-rose/5 border border-accent-rose/20 rounded-xl hover:bg-accent-rose/10 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={18} className="text-accent-rose" />
              <div>
                <p className="font-medium text-accent-rose">Revoke Key</p>
                <p className="text-xs text-text-secondary">Permanently disable this key</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
