import React, { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import type { GatewayError } from '../lib/types';

interface Props {
  jobId: string | null;
  sendControl: (jobId: string, message: Record<string, unknown>) => Promise<any>;
}

const DEFAULT_MESSAGE = JSON.stringify({ type: 'ping' }, null, 2);

export const ControlPanel: React.FC<Props> = ({ jobId, sendControl }) => {
  const [text, setText] = useState(DEFAULT_MESSAGE);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!jobId) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const parsed = JSON.parse(text);
      const res = await sendControl(jobId, parsed);
      setResult(`Sent OK — ${JSON.stringify(res)}`);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Invalid JSON');
      } else {
        setError((err as GatewayError).message || 'Send failed');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-zinc-200">Control Message</h3>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!jobId}
        rows={3}
        className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs font-mono text-zinc-200 placeholder-zinc-500 resize-none focus:outline-none focus:border-amber-500 disabled:opacity-50"
        placeholder='{"type": "ping"}'
      />

      <div className="flex items-center gap-2">
        <button
          onClick={handleSend}
          disabled={!jobId || sending}
          className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 text-white text-xs font-medium rounded transition-colors"
        >
          {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          Send
        </button>

        {result && <span className="text-xs text-emerald-400 truncate">{result}</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
};
