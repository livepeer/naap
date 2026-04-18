'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

type Phase = 'loading' | 'ok' | 'err';

export default function DeviceApprovedPage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState<string>('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/v1/auth/pymthouse-device-approve', {
          method: 'POST',
          credentials: 'include',
        });
        const json = (await r.json().catch(() => ({}))) as {
          success?: boolean;
          error?: { message?: string };
        };
        if (cancelled) return;
        if (r.ok && json.success !== false) {
          setPhase('ok');
          return;
        }
        setPhase('err');
        setMessage(
          json.error?.message ||
            (typeof json === 'object' && json && 'message' in json
              ? String((json as { message?: unknown }).message)
              : '') ||
            `Request failed (${r.status})`,
        );
      } catch (e) {
        if (!cancelled) {
          setPhase('err');
          setMessage(e instanceof Error ? e.message : 'Unknown error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center px-4">
      {phase === 'loading' && (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Completing device sign-in…</p>
        </div>
      )}
      {phase === 'ok' && (
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-lg font-medium text-foreground">Device approved</h1>
          <p className="text-sm text-muted-foreground">
            You can return to your terminal or SDK — it should pick up the token automatically.
          </p>
          <Link href="/dashboard" className="inline-block text-sm text-foreground underline">
            Go to dashboard
          </Link>
        </div>
      )}
      {phase === 'err' && (
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-lg font-medium text-destructive">Could not complete device sign-in</h1>
          <p className="text-sm text-muted-foreground break-words">{message}</p>
          <Link href="/dashboard" className="inline-block text-sm text-foreground underline">
            Go to dashboard
          </Link>
        </div>
      )}
    </div>
  );
}
