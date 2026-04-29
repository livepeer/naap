import React, { useEffect, useState } from 'react';
import { Send, Key, Loader2, Trash2, RefreshCw, CheckCircle, XCircle, AlertCircle, ExternalLink } from 'lucide-react';

const API = '/api/v1/agentbook-core';

interface BotStatus {
  configured: boolean;
  enabled?: boolean;
  botUsername?: string;
  chatIds?: string[];
  webhookUrl?: string;
  webhookActive?: boolean | null;
  lastError?: string | null;
  instructions?: string;
}

interface SetupResult {
  botUsername: string;
  botName: string;
  webhookRegistered: boolean;
  webhookUrl: string;
  instructions: string;
}

export const TelegramSettingsPage: React.FC = () => {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API}/telegram/status`);
      const d = await res.json();
      if (d.success) setStatus(d.data);
    } catch {
      setError('Could not load Telegram status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  const handleSetup = async () => {
    if (!botToken.trim() || !botToken.includes(':')) {
      setError('Enter a valid bot token (format: 123456789:ABCdef...)');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/telegram/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: botToken.trim() }),
      });
      const d = await res.json();
      if (d.success) {
        const result = d.data as SetupResult;
        setSuccess(`Connected to @${result.botUsername}! ${result.webhookRegistered ? 'Webhook registered.' : 'Webhook needs manual setup — see instructions below.'}`);
        setBotToken('');
        await fetchStatus();
      } else {
        setError(d.error || 'Setup failed');
      }
    } catch {
      setError('Connection failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect your Telegram bot? You can reconnect anytime.')) return;
    setDisconnecting(true);
    try {
      await fetch(`${API}/telegram/disconnect`, { method: 'DELETE' });
      setStatus({ configured: false, instructions: 'Bot disconnected.' });
      setSuccess('Telegram bot disconnected.');
    } catch {
      setError('Could not disconnect. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="px-4 py-5 sm:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Send className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Telegram Bot</h1>
      </div>

      {/* Status alerts */}
      {error && (
        <div className="mb-4 p-3.5 rounded-xl border bg-red-500/10 border-red-500/20 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-4 p-3.5 rounded-xl border bg-green-500/10 border-green-500/20 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
          <p className="text-sm text-green-600">{success}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading...</span>
        </div>
      ) : status?.configured ? (
        /* === Connected State === */
        <div className="space-y-4">
          {/* Bot info card */}
          <div className="bg-card border border-primary rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Send className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold text-lg">@{status.botUsername}</h2>
                  <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-600 rounded-full">Connected</span>
                </div>
              </div>
              <button onClick={() => { fetchStatus(); setError(null); setSuccess(null); }}
                className="p-2 rounded-lg hover:bg-muted transition-colors" title="Refresh status">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-sm">
              {/* Webhook status */}
              <div className="flex items-center gap-2">
                {status.webhookActive === true ? (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                ) : status.webhookActive === false ? (
                  <XCircle className="w-4 h-4 text-red-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                )}
                <span className="text-muted-foreground">Webhook:</span>
                <span className={status.webhookActive === false ? 'text-red-500' : ''}>
                  {status.webhookActive === true ? 'Active' : status.webhookActive === false ? 'Error' : 'Unknown'}
                </span>
              </div>

              {status.lastError && (
                <div className="p-2.5 rounded-lg bg-red-500/10 text-red-600 text-xs">
                  Last error: {status.lastError}
                </div>
              )}

              {/* Connected chats */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Linked chats:</span>
                <span>{(status.chatIds as string[])?.length || 0}</span>
              </div>

              {/* Open in Telegram */}
              {status.botUsername && (
                <a href={`https://t.me/${status.botUsername}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary hover:underline mt-2">
                  Open in Telegram <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>

          {/* How to use */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium mb-3">How to use</h3>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Open <a href={`https://t.me/${status.botUsername}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">@{status.botUsername}</a> in Telegram</li>
              <li>Send <code className="px-1.5 py-0.5 rounded bg-muted text-xs">/start</code> to begin</li>
              <li>Type naturally — "Spent $45 on lunch", "Show my invoices", "Start my tax filing"</li>
              <li>Send receipt photos or tax slips for OCR scanning</li>
              <li>Type <code className="px-1.5 py-0.5 rounded bg-muted text-xs">/help</code> for all commands</li>
            </ol>
          </div>

          {/* Disconnect */}
          <div className="pt-2">
            <button onClick={handleDisconnect} disabled={disconnecting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-red-500/10 text-red-500 text-sm transition-colors">
              {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Disconnect Bot
            </button>
          </div>
        </div>
      ) : (
        /* === Not Connected State === */
        <div className="space-y-4">
          {/* Setup instructions */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="font-semibold mb-4">Connect Your Telegram Bot</h2>
            <ol className="text-sm text-muted-foreground space-y-3 list-decimal list-inside mb-5">
              <li>Open <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">@BotFather</a> in Telegram</li>
              <li>Send <code className="px-1.5 py-0.5 rounded bg-muted text-xs">/newbot</code> and follow the prompts</li>
              <li>Copy the <strong>API token</strong> (looks like <code className="px-1.5 py-0.5 rounded bg-muted text-xs">123456789:ABCdef...</code>)</li>
              <li>Paste it below</li>
            </ol>

            {/* Token input */}
            <div className="space-y-3">
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="password"
                  placeholder="Paste your bot token here"
                  value={botToken}
                  onChange={e => { setBotToken(e.target.value); setError(null); }}
                  onKeyDown={e => e.key === 'Enter' && handleSetup()}
                  className="w-full pl-10 p-3 border border-border rounded-lg bg-background font-mono text-sm"
                />
              </div>
              <button onClick={handleSetup} disabled={saving || !botToken.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 transition-opacity">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {saving ? 'Connecting...' : 'Connect Bot'}
              </button>
            </div>
          </div>

          {/* Why connect */}
          <div className="bg-muted/30 border border-border/50 rounded-xl p-5">
            <h3 className="font-medium mb-3">What can you do with Telegram?</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <span className="text-lg">💬</span>
                <span>Record expenses by typing naturally</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-lg">📸</span>
                <span>Snap receipts &amp; tax slips for OCR</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-lg">🧾</span>
                <span>Create &amp; send invoices</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-lg">📊</span>
                <span>Get financial reports &amp; projections</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-lg">🧾</span>
                <span>File taxes with guided prep</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-lg">🤖</span>
                <span>Multi-step AI planning &amp; automation</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
