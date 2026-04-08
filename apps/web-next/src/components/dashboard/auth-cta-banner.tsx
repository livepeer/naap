'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

const DISMISSED_KEY = 'naap_cta_dismissed';

export function AuthCTABanner() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const wasDismissed = sessionStorage.getItem(DISMISSED_KEY) === '1';
    setDismissed(wasDismissed);
    setReady(true);
  }, []);

  if (!ready || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(DISMISSED_KEY, '1');
  };

  return (
    <div className="relative flex flex-col gap-3 px-4 py-3 rounded-lg bg-muted/50 border border-border/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p className="min-w-0 text-[13px] text-muted-foreground">
        You&apos;re viewing the live Livepeer network. Sign in to manage orchestrators, deploy pipelines, and access your wallet.
      </p>
      <div className="flex flex-wrap items-center gap-2 shrink-0 sm:justify-end">
        <Link
          href="/login"
          className="px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Sign In
        </Link>
        <Link
          href="/register"
          className="px-3 py-1.5 text-[13px] font-medium bg-foreground text-background rounded-lg hover:opacity-90 transition-opacity"
        >
          Create Account
        </Link>
        <button
          onClick={handleDismiss}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
