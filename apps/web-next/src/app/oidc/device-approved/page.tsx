'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, ShieldCheck, ShieldX } from 'lucide-react';
import { csrfFetch } from '@/lib/api/csrf-client';

type Phase = 'loading' | 'consent' | 'approving' | 'ok' | 'err' | 'denied';

export default function DeviceApprovedPage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [userCode, setUserCode] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const started = useRef(false);

  // Step 1: fetch the pending user_code for display
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/v1/auth/pymthouse-device-approve', {
          method: 'GET',
          credentials: 'include',
        });
        const json = (await r.json().catch(() => ({}))) as {
          data?: { userCode?: string };
          error?: { message?: string };
        };
        if (cancelled) return;
        if (r.ok && json.data?.userCode) {
          setUserCode(json.data.userCode);
          setPhase('consent');
          return;
        }
        setPhase('err');
        setMessage(json.error?.message || `Request failed (${r.status})`);
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

  // Step 2: user clicks Approve — POST to confirm
  async function handleApprove() {
    setPhase('approving');
    try {
      const r = await csrfFetch('/api/v1/auth/pymthouse-device-approve', {
        method: 'POST',
      });
      const json = (await r.json().catch(() => ({}))) as {
        success?: boolean;
        error?: { message?: string };
      };
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
      setPhase('err');
      setMessage(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  function handleDeny() {
    setPhase('denied');
  }

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center px-4">
      {phase === 'loading' && (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Loading device approval…</p>
        </div>
      )}

      {phase === 'consent' && (
        <div className="max-w-md w-full text-center space-y-6">
          <ShieldCheck className="h-10 w-10 text-foreground mx-auto" />
          <div className="space-y-2">
            <h1 className="text-lg font-semibold text-foreground">Approve device sign-in</h1>
            <p className="text-sm text-muted-foreground">
              A device is requesting access to your NaaP account. Confirm the code below matches
              what is shown on your device before approving.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/50 px-6 py-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              Device code
            </p>
            <p className="text-2xl font-mono font-bold tracking-widest text-foreground">
              {userCode}
            </p>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleDeny}
              className="px-5 py-2 rounded-md border border-border text-sm font-medium text-foreground hover:bg-muted/60 transition-colors"
            >
              Deny
            </button>
            <button
              onClick={() => void handleApprove()}
              className="px-5 py-2 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Approve
            </button>
          </div>
        </div>
      )}

      {phase === 'approving' && (
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

      {phase === 'denied' && (
        <div className="max-w-md text-center space-y-3">
          <ShieldX className="h-10 w-10 text-muted-foreground mx-auto" />
          <h1 className="text-lg font-medium text-foreground">Device sign-in denied</h1>
          <p className="text-sm text-muted-foreground">
            The request was not approved. Your account has not been accessed.
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
