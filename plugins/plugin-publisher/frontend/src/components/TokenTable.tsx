import React from 'react';
import { Key, Trash2, Clock, CheckCircle } from 'lucide-react';
import type { ApiToken } from '../lib/api';

interface TokenTableProps {
  tokens: ApiToken[];
  onRevoke: (tokenId: string) => void;
}

export const TokenTable: React.FC<TokenTableProps> = ({ tokens, onRevoke }) => {
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (tokens.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <Key className="w-8 h-8 text-text-secondary mx-auto mb-4" />
        <h3 className="text-sm font-semibold text-text-primary mb-2">No API Tokens</h3>
        <p className="text-text-secondary">
          Create an API token to publish plugins via CLI or CI/CD.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card overflow-hidden">
      <table className="w-full">
        <thead className="bg-bg-tertiary/50">
          <tr>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
              Token
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
              Scopes
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
              Last Used
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
              Expires
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
              Status
            </th>
            <th className="px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {tokens.map((token) => (
            <tr key={token.id} className="hover:bg-bg-tertiary/30 transition-colors">
              <td className="px-4 py-3">
                <div>
                  <div className="font-medium text-text-primary">{token.name}</div>
                  <div className="text-sm text-text-secondary font-mono">
                    {token.tokenPrefix}...
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {token.scopes.map((scope) => (
                    <span key={scope} className="badge badge-info">
                      {scope}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-text-secondary">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {formatDate(token.lastUsedAt)}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-text-secondary">
                {token.expiresAt ? formatDate(token.expiresAt) : 'Never'}
              </td>
              <td className="px-4 py-3">
                {token.revokedAt ? (
                  <span className="badge badge-error">Revoked</span>
                ) : (
                  <span className="badge badge-success flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Active
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                {!token.revokedAt && (
                  <button
                    onClick={() => onRevoke(token.id)}
                    className="p-1.5 rounded-md hover:bg-accent-rose/20 text-accent-rose transition-colors"
                    title="Revoke token"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
