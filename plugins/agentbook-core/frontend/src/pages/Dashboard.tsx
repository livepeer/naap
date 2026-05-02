import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, FilePlus2, Camera, MessageSquare, RefreshCw } from 'lucide-react';
import { useDashboardOverview } from './dashboard/hooks/useDashboardOverview';
import { useDashboardActivity } from './dashboard/hooks/useDashboardActivity';
import { ForwardView } from './dashboard/ForwardView';
import { AttentionPanel } from './dashboard/AttentionPanel';
import { ThisMonthStrip } from './dashboard/ThisMonthStrip';
import { ActivityFeed } from './dashboard/ActivityFeed';
import { QuickActionsBar } from './dashboard/QuickActionsBar';
import { OnboardingHero } from './dashboard/OnboardingHero';
import type { AgentSummary } from './dashboard/types';

const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={`animate-pulse rounded-2xl bg-muted/40 ${className}`} />
);

const DesktopHeaderActions: React.FC = () => (
  <div className="hidden lg:flex items-center gap-2">
    <a href="/agentbook/invoices/new" className="text-sm font-medium px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-1.5">
      <FilePlus2 className="w-4 h-4" /> New invoice
    </a>
    <a href="/agentbook/expenses/new" className="text-sm font-medium px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground flex items-center gap-1.5">
      <Camera className="w-4 h-4" /> Snap
    </a>
    <a href="/agentbook/agents" className="text-sm font-medium px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground flex items-center gap-1.5">
      <MessageSquare className="w-4 h-4" /> Ask
    </a>
  </div>
);

const Kebab: React.FC<{ onRefresh: () => void; showTelegramHint: boolean }> = ({ onRefresh, showTelegramHint }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} aria-label="More" className="p-2 rounded-lg hover:bg-muted">
        <MoreHorizontal className="w-5 h-5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-card border border-border rounded-xl shadow-lg p-2 z-50">
          <button onClick={() => { setOpen(false); onRefresh(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-muted rounded-lg flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <a href="/agentbook/telegram" className="w-full block px-3 py-2 text-sm hover:bg-muted rounded-lg">
            Share to Telegram
          </a>
          {showTelegramHint && (
            <a href="/agentbook/telegram" className="block px-3 py-2 mt-1 text-xs text-primary bg-primary/5 rounded-lg">
              ☀️ Get a 7am summary — connect Telegram
            </a>
          )}
        </div>
      )}
    </div>
  );
};

export const DashboardPage: React.FC = () => {
  const { data, error, loading, refetch } = useDashboardOverview();
  const { items: activity, loading: actLoading, loadMore } = useDashboardActivity(10);
  const [summary, setSummary] = useState<AgentSummary | null>(null);

  // Pull-to-refresh (mobile)
  const startY = useRef<number | null>(null);
  const [pulling, setPulling] = useState(false);
  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0) startY.current = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (startY.current == null) return;
      if (e.touches[0].clientY - startY.current > 80) setPulling(true);
    };
    const onTouchEnd = () => {
      if (pulling) refetch();
      startY.current = null;
      setPulling(false);
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [pulling, refetch]);

  // Fetch agent summary once data is in
  useEffect(() => {
    if (!data) return;
    const overdueCount = data.attention.filter(a => a.id.startsWith('overdue:')).length;
    const overdueAmountCents = data.attention.filter(a => a.id.startsWith('overdue:')).reduce((s, a) => s + (a.amountCents || 0), 0);
    const taxItem = data.attention.find(a => a.id === 'tax');
    const taxDaysOut = taxItem ? data.nextMoments.find(m => m.kind === 'tax')?.daysOut ?? null : null;

    const params = new URLSearchParams({
      overdueCount: String(overdueCount),
      overdueAmountCents: String(overdueAmountCents),
      ...(taxDaysOut !== null ? { taxDaysOut: String(taxDaysOut) } : {}),
    });

    fetch(`/api/v1/agentbook-core/dashboard/agent-summary?${params}`)
      .then(r => r.json())
      .then(j => { if (j?.success) setSummary(j.data); })
      .catch(() => { /* fallback rendered by panel */ });
  }, [data]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  if (error && !data) {
    return (
      <div className="px-4 py-6 max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">AgentBook</h1>
          <DesktopHeaderActions />
        </header>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center justify-between">
          <p className="text-sm text-red-700 dark:text-red-300">Couldn't reach AgentBook.</p>
          <button onClick={refetch} className="text-sm font-medium text-primary px-3 py-1.5 rounded-lg hover:bg-primary/10">Retry</button>
        </div>
        <QuickActionsBar />
      </div>
    );
  }

  // Brand-new tenant
  if (data?.isBrandNew) {
    return (
      <div className="px-4 py-6 max-w-7xl mx-auto pb-32 lg:pb-6">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{greeting}</h1>
          </div>
          <Kebab onRefresh={refetch} showTelegramHint={false} />
        </header>
        <OnboardingHero hasBank={false} hasInvoice={false} hasReceipt={false} />
        <QuickActionsBar />
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-7xl mx-auto pb-32 lg:pb-6">
      {pulling && <div className="text-center text-sm text-muted-foreground mb-2">Refreshing…</div>}
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">{greeting}</h1>
        </div>
        <div className="flex items-center gap-2">
          <DesktopHeaderActions />
          {/* Hint always shown in V1; safe because tapping it routes to the
              telegram settings page where users can verify or disconnect. */}
          <Kebab onRefresh={refetch} showTelegramHint={true} />
        </div>
      </header>

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2">
          {loading || !data ? (
            <Skeleton className="h-48 sm:h-64" />
          ) : (
            <ForwardView cashTodayCents={data.cashToday} projection={data.projection} moments={data.nextMoments} />
          )}
        </div>
        <div>
          {loading || !data ? (
            <Skeleton className="h-48 sm:h-64" />
          ) : (
            <AttentionPanel items={data.attention} summary={summary} />
          )}
        </div>
      </div>

      {data && data.monthMtd && (
        <div className="mb-4">
          <ThisMonthStrip mtd={data.monthMtd} prev={data.monthPrev} />
        </div>
      )}

      <ActivityFeed items={activity} loading={actLoading} onLoadMore={loadMore} />

      <QuickActionsBar />
    </div>
  );
};
