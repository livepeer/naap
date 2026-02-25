import React from 'react';
import { Copy, RotateCw, Edit3, Trash2 } from 'lucide-react';
import { Badge } from '@naap/ui';
import type { DeveloperApiKey } from '@naap/types';

interface ApiKeyTableProps {
  keys: DeveloperApiKey[];
  onCopyKey: (key: DeveloperApiKey) => void;
  onRotateKey: (key: DeveloperApiKey) => void;
  onRenameKey: (key: DeveloperApiKey) => void;
  onRevokeKey: (key: DeveloperApiKey) => void;
  onViewDetails: (key: DeveloperApiKey) => void;
}

export const ApiKeyTable: React.FC<ApiKeyTableProps> = ({
  keys,
  onCopyKey,
  onRotateKey,
  onRenameKey,
  onRevokeKey,
  onViewDetails,
}) => {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return 'Never used';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays} days ago`;
  };

  if (keys.length === 0) {
    return null;
  }

  return (
    <div className="glass-card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left text-xs font-bold text-text-secondary uppercase tracking-widest py-4 px-6">
              Project
            </th>
            <th className="text-left text-xs font-bold text-text-secondary uppercase tracking-widest py-4 px-4">
              Model
            </th>
            <th className="text-left text-xs font-bold text-text-secondary uppercase tracking-widest py-4 px-4">
              Provider
            </th>
            <th className="text-left text-xs font-bold text-text-secondary uppercase tracking-widest py-4 px-4">
              Created
            </th>
            <th className="text-left text-xs font-bold text-text-secondary uppercase tracking-widest py-4 px-4">
              Status
            </th>
            <th className="text-left text-xs font-bold text-text-secondary uppercase tracking-widest py-4 px-4">
              Last Used
            </th>
            <th className="text-right text-xs font-bold text-text-secondary uppercase tracking-widest py-4 px-6">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr
              key={key.id}
              className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
              onClick={() => onViewDetails(key)}
            >
              <td className="py-4 px-6">
                <div>
                  <p className="font-medium text-text-primary">{key.projectName}</p>
                  <p className="text-xs font-mono text-text-secondary mt-0.5">{key.keyHash}</p>
                </div>
              </td>
              <td className="py-4 px-4">
                <span className="text-text-primary text-sm">{key.modelName}</span>
              </td>
              <td className="py-4 px-4">
                <span className="text-text-primary text-sm">{key.providerDisplayName || '—'}</span>
              </td>
              <td className="py-4 px-4">
                <span className="text-text-secondary text-sm">{formatDate(key.createdAt)}</span>
              </td>
              <td className="py-4 px-4">
                <Badge variant={key.status === 'active' ? 'emerald' : 'rose'}>
                  {key.status}
                </Badge>
              </td>
              <td className="py-4 px-4">
                <span className="text-text-secondary text-sm">{formatTimeAgo(key.lastUsedAt)}</span>
              </td>
              <td className="py-4 px-6">
                <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onCopyKey(key)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-text-secondary hover:text-text-primary"
                    title="Copy key hash"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    onClick={() => onRotateKey(key)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-text-secondary hover:text-text-primary"
                    title="Rotate key"
                    disabled={key.status === 'revoked'}
                  >
                    <RotateCw size={16} />
                  </button>
                  <button
                    onClick={() => onRenameKey(key)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-text-secondary hover:text-text-primary"
                    title="Rename project"
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    onClick={() => onRevokeKey(key)}
                    className="p-2 hover:bg-accent-rose/10 rounded-lg transition-colors text-text-secondary hover:text-accent-rose"
                    title="Revoke key"
                    disabled={key.status === 'revoked'}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
