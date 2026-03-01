import React, { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, CheckCircle2 } from 'lucide-react';
import type { HealthResponse, GatewayError } from '../lib/types';

interface Props {
  health: () => Promise<HealthResponse>;
  children: React.ReactNode;
}

type SetupState = 'checking' | 'ok' | 'not-configured' | 'error';

export const ConnectorSetup: React.FC<Props> = ({ health, children }) => {
  const [state, setState] = useState<SetupState>('checking');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        await health();
        if (mounted) setState('ok');
      } catch (err) {
        if (!mounted) return;
        const ge = err as GatewayError;
        if (ge.status === 404 || ge.status === 502) {
          setState('not-configured');
          setErrorMsg(ge.message);
        } else {
          setState('error');
          setErrorMsg(ge.message || 'Unknown error');
        }
      }
    };
    check();
    return () => {
      mounted = false;
    };
  }, [health]);

  if (state === 'checking') {
    return (
      <div className="flex items-center justify-center h-full text-zinc-400 gap-2">
        <Loader2 size={20} className="animate-spin" />
        <span className="text-sm">Checking connector...</span>
      </div>
    );
  }

  if (state === 'ok') {
    return <>{children}</>;
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="max-w-md w-full bg-zinc-800/50 border border-zinc-700 rounded-lg p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle size={24} className="text-amber-400 shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-zinc-200">Connector Not Ready</h2>
            <p className="text-xs text-zinc-400 mt-1">
              The <code className="text-amber-300">livepeer-gateway</code> connector needs to be
              created and published before this plugin can work.
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="text-xs text-red-400 bg-red-950/30 border border-red-900 rounded px-3 py-2 font-mono">
            {errorMsg}
          </div>
        )}

        <div className="text-xs text-zinc-400 space-y-2">
          <p className="font-medium text-zinc-300">Setup steps:</p>
          <ol className="list-decimal list-inside space-y-1.5">
            <li>
              Go to{' '}
              <a
                href="/gateway"
                className="text-amber-400 hover:underline inline-flex items-center gap-0.5"
              >
                Service Gateway <ExternalLink size={10} />
              </a>
            </li>
            <li>Click "New Connector" and choose the <strong>Livepeer Lightweight Gateway</strong> template</li>
            <li>(Optional) Configure the <code>api-key</code> secret if your gateway requires authentication</li>
            <li>Complete the wizard and <strong>Publish</strong> the connector</li>
            <li>Return here — the page will auto-detect the connector</li>
          </ol>
        </div>

        <button
          onClick={() => {
            setState('checking');
            setTimeout(async () => {
              try {
                await health();
                setState('ok');
              } catch {
                setState('not-configured');
              }
            }, 500);
          }}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded transition-colors"
        >
          <CheckCircle2 size={14} />
          Retry Connection
        </button>
      </div>
    </div>
  );
};
