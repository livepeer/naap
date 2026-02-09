/**
 * Remote Signer Token Display Component
 * Shows the JWT token for use with go-livepeer remote signer
 */

'use client';

import { useState, useEffect } from 'react';
import { Copy, Check, RefreshCw, Key, ExternalLink, AlertCircle, Clock } from 'lucide-react';
import { getRemoteSignerToken, clearRemoteSignerToken, type RemoteSignerToken } from '@/lib/api/siwe';

export function RemoteSignerTokenDisplay() {
  const [token, setToken] = useState<RemoteSignerToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [showFullToken, setShowFullToken] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    loadToken();
  }, []);

  const loadToken = () => {
    const storedToken = getRemoteSignerToken();
    setToken(storedToken);
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleRefresh = () => {
    // Trigger re-authentication by redirecting to login
    clearRemoteSignerToken();
    setToken(null);
    window.location.href = '/login';
  };

  const formatExpiry = (expiresAt: string) => {
    const expiry = new Date(expiresAt);
    const now = new Date();
    const diffMs = expiry.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffMs < 0) {
      return <span className="text-destructive">Expired</span>;
    } else if (diffHours < 1) {
      return <span className="text-amber-500">Expires in {diffMinutes} minutes</span>;
    } else {
      return <span className="text-muted-foreground">Expires in {diffHours}h {diffMinutes}m</span>;
    }
  };

  // Prevent SSR mismatch
  if (!mounted) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="space-y-4">
        <div className="p-6 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-500 mb-1">No Remote Signer Token</p>
              <p className="text-sm text-muted-foreground">
                You need to sign in with Ethereum to get a JWT token for the remote signer.
              </p>
            </div>
          </div>
        </div>

        <a
          href="/login"
          className="flex items-center justify-center gap-2 w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
        >
          <Key size={18} />
          Sign In With Ethereum
        </a>
      </div>
    );
  }

  const isExpiringSoon = new Date(token.expiresAt).getTime() - Date.now() < 60 * 60 * 1000; // < 1 hour
  const isExpired = new Date(token.expiresAt) < new Date();

  return (
    <div className="space-y-4">
      {/* Token Info Card */}
      <div className="p-4 bg-gradient-to-br from-primary/5 to-blue-500/5 border border-primary/20 rounded-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            {/* Wallet Address */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Key size={14} className="text-primary" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Wallet Address
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="font-mono text-sm font-medium">
                  {token.address}
                </code>
                <button
                  onClick={() => handleCopy(token.address)}
                  className="p-1 hover:bg-muted rounded transition-colors"
                  title="Copy address"
                >
                  {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-muted-foreground" />}
                </button>
              </div>
            </div>

            {/* Expiration */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Clock size={14} className="text-primary" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Expiration
                </span>
              </div>
              <div className="text-sm">
                {formatExpiry(token.expiresAt)}
              </div>
            </div>
          </div>

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            className={`p-2 rounded-lg transition-all ${
              isExpiringSoon
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
            title="Refresh token"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {/* Warning if expiring soon */}
      {(isExpiringSoon || isExpired) && (
        <div className={`p-4 border rounded-xl ${
          isExpired
            ? 'bg-destructive/10 border-destructive/20'
            : 'bg-amber-500/10 border-amber-500/20'
        }`}>
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className={isExpired ? 'text-destructive' : 'text-amber-500'} />
            <div>
              <p className={`font-medium mb-1 ${isExpired ? 'text-destructive' : 'text-amber-500'}`}>
                {isExpired ? 'Token Expired' : 'Token Expiring Soon'}
              </p>
              <p className="text-sm text-muted-foreground">
                {isExpired
                  ? 'Your JWT token has expired. Click the refresh button above to sign in again.'
                  : 'Your JWT token will expire soon. Consider refreshing it to avoid interruption.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* JWT Token Display */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-muted-foreground">
            JWT Token for Remote Signer
          </label>
          <button
            onClick={() => setShowFullToken(!showFullToken)}
            className="text-xs text-primary hover:underline"
          >
            {showFullToken ? 'Hide' : 'Show'} Full Token
          </button>
        </div>

        <div className="relative group">
          <div className="bg-muted/50 border border-border rounded-lg p-4 font-mono text-xs break-all">
            {showFullToken ? token.jwt : `${token.jwt.substring(0, 40)}...${token.jwt.substring(token.jwt.length - 40)}`}
          </div>
          <button
            onClick={() => handleCopy(token.jwt)}
            className="absolute top-2 right-2 p-2 bg-background border border-border rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-muted"
            title="Copy JWT token"
          >
            {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} className="text-muted-foreground" />}
          </button>
        </div>
      </div>

      {/* Usage Instructions */}
      <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
            <ExternalLink size={20} className="text-blue-500" />
          </div>
          <div className="flex-1 text-sm">
            <p className="font-medium mb-2">Using with Offchain Gateway</p>
            <p className="text-muted-foreground mb-3">
              Use this JWT token to authenticate API calls to the go-livepeer remote signer:
            </p>
            <div className="bg-background/50 rounded-lg p-3 font-mono text-xs overflow-x-auto">
              <div className="text-muted-foreground mb-1"># Set token as environment variable</div>
              <div>export JWT_TOKEN=&quot;your_token_here&quot;</div>
              <div className="mt-2 text-muted-foreground"># Call remote signer</div>
              <div>curl -X POST http://localhost:8081/sign-orchestrator-info \</div>
              <div>  -H &quot;Authorization: Bearer $JWT_TOKEN&quot; \</div>
              <div>  -H &quot;Content-Type: application/json&quot;</div>
            </div>
          </div>
        </div>
      </div>

      {/* Documentation Link */}
      <div className="text-center">
        <a
          href="https://github.com/livepeer/go-livepeer/blob/master/doc/remote-signer.md"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ExternalLink size={14} />
          Remote Signer Documentation
        </a>
      </div>
    </div>
  );
}
