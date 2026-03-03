import React from 'react';
import { Plus, Copy, CheckCircle } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { TokenTable } from '../components/TokenTable';
import { listTokens, createToken, revokeToken, type ApiToken } from '../lib/api';
import { useNotify } from '@naap/plugin-sdk';

export const ApiTokens: React.FC = () => {
  const notify = useNotify();
  const [tokens, setTokens] = React.useState<ApiToken[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);
  const [newToken, setNewToken] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // Create form state
  const [name, setName] = React.useState('');
  const [scopes, setScopes] = React.useState<string[]>(['read', 'publish']);
  const [expiresInDays, setExpiresInDays] = React.useState<number | undefined>(undefined);
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    loadTokens();
  }, []);

  const loadTokens = async () => {
    try {
      const data = await listTokens();
      setTokens(data);
    } catch (error) {
      console.error('Failed to load tokens:', error);
      notify.error('Failed to load tokens');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      notify.error('Token name is required');
      return;
    }

    setCreating(true);
    try {
      const result = await createToken({ name, scopes, expiresInDays });
      setNewToken(result.token);
      setShowCreate(false);
      // Reset form fields
      setName('');
      setScopes(['read', 'publish']);
      setExpiresInDays(undefined);
      loadTokens();
      notify.success('Token created successfully');
    } catch (error) {
      console.error('Failed to create token:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to create token';
      notify.error(errorMsg);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (tokenId: string) => {
    if (!confirm('Are you sure you want to revoke this token? This action cannot be undone.')) return;

    try {
      await revokeToken(tokenId);
      notify.success('Token revoked');
      loadTokens();
    } catch (error) {
      console.error('Failed to revoke token:', error);
      notify.error('Failed to revoke token');
    }
  };

  const copyToken = () => {
    if (newToken) {
      navigator.clipboard.writeText(newToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const toggleScope = (scope: string) => {
    setScopes(prev => 
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="API Tokens"
        subtitle="Manage API tokens for publishing via CLI or CI/CD"
        actions={
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Create Token
          </button>
        }
      />

      {/* New Token Display */}
      {newToken && (
        <div className="glass-card p-4 border-accent-emerald/50">
          <div className="flex items-start gap-4">
            <div className="p-1.5 bg-accent-emerald/20 rounded-md">
              <CheckCircle className="w-4 h-4 text-accent-emerald" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-text-primary mb-1.5">Token Created Successfully</h3>
              <p className="text-sm text-text-secondary mb-4">
                Copy this token now. You won't be able to see it again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-1.5 bg-bg-tertiary rounded-lg font-mono text-sm break-all">
                  {newToken}
                </code>
                <button onClick={copyToken} className="btn-secondary flex items-center gap-2">
                  {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <button
              onClick={() => setNewToken(null)}
              className="text-text-secondary hover:text-text-primary"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Create Token Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="glass-card p-4 w-full max-w-md">
            <h2 className="text-sm font-semibold text-text-primary mb-3">Create API Token</h2>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Token Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., CI/CD Token"
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Scopes
                </label>
                <div className="flex flex-wrap gap-2">
                  {['read', 'publish', 'admin'].map((scope) => (
                    <button
                      key={scope}
                      onClick={() => toggleScope(scope)}
                      className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                        scopes.includes(scope)
                          ? 'bg-accent-emerald text-white'
                          : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'
                      }`}
                    >
                      {scope}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Expires In (days)
                </label>
                <input
                  type="number"
                  value={expiresInDays || ''}
                  onChange={(e) => setExpiresInDays(e.target.value ? parseInt(e.target.value) : undefined)}
                  placeholder="Leave empty for no expiration"
                  className="input-field"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setShowCreate(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleCreate} className="btn-primary" disabled={creating}>
                {creating ? 'Creating...' : 'Create Token'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Token List */}
      {loading ? (
        <div className="glass-card p-8 text-center">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current text-text-secondary mx-auto"></div>
          <p className="mt-4 text-text-secondary">Loading tokens...</p>
        </div>
      ) : (
        <TokenTable tokens={tokens} onRevoke={handleRevoke} />
      )}
    </div>
  );
};
