'use client';

import { useEffect, useRef, useState } from 'react';
import type { DashboardData, DashboardOrchestrator } from '@naap/plugin-sdk';
import { useDashboardQuery } from '@/hooks/useDashboardQuery';
import { OrchestratorTableCard } from '@/components/dashboard/orchestrator-table';
import { Clock, ChevronsUpDown, Loader2 } from 'lucide-react';
import {
  DEFAULT_OVERVIEW_TIMEFRAME,
  OVERVIEW_TIMEFRAME_OPTIONS,
  OVERVIEW_TIMEFRAME_VALUES,
} from '@/lib/dashboard/overview-timeframe';

const TIMEFRAME_KEY = 'naap_dashboard_timeframe';

const CATALOG_PRICING_QUERY = /* GraphQL */ `
  query OrchestratorPageData {
    pipelineCatalog { id name models regions }
    pricing { pipeline model unit price avgWeiPerUnit pixelsPerUnit outputPerDollar capacity }
  }
`;

export default function OrchestratorsPage() {
  const [timeframe, setTimeframe] = useState<string>(DEFAULT_OVERVIEW_TIMEFRAME);
  const [prefsReady, setPrefsReady] = useState(false);
  const [orchestrators, setOrchestrators] = useState<DashboardOrchestrator[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(TIMEFRAME_KEY);
    if (stored && OVERVIEW_TIMEFRAME_VALUES.includes(stored)) setTimeframe(stored);
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ period: timeframe });
    void fetch(`/api/v1/dashboard/orchestrators?${qs.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: unknown = await res.json();
        if (!Array.isArray(body)) throw new Error('Invalid response');
        return body as DashboardOrchestrator[];
      })
      .then((rows) => { if (!cancelled) { setOrchestrators(rows); setLoading(false); } })
      .catch(() => { if (!cancelled) { setOrchestrators([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [prefsReady, timeframe]);

  const { data: rtData } = useDashboardQuery<Pick<DashboardData, 'pipelineCatalog' | 'pricing'>>(
    CATALOG_PRICING_QUERY,
    undefined,
    { skip: !prefsReady },
  );

  const handleTimeframeChange = (tf: string) => {
    setTimeframe(tf);
    localStorage.setItem(TIMEFRAME_KEY, tf);
  };

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <h1 className="text-base font-semibold text-foreground sm:text-lg">Orchestrators</h1>
          <p className="text-[13px] text-muted-foreground">Active orchestrators on the network</p>
        </div>
        <TimeframeSelector value={timeframe} onChange={handleTimeframeChange} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <OrchestratorTableCard
          data={orchestrators}
          catalog={rtData?.pipelineCatalog}
          pricing={rtData?.pricing ?? []}
        />
      )}
    </div>
  );
}

function TimeframeSelector({ value, onChange }: { value: string; onChange: (tf: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = OVERVIEW_TIMEFRAME_OPTIONS.find((o) => o.value === value) ?? OVERVIEW_TIMEFRAME_OPTIONS[0];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/30 border border-border hover:bg-muted/50 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select timeframe"
      >
        <Clock className="w-3 h-3 text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground">{selected.label}</span>
        <ChevronsUpDown className="w-3 h-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 rounded-md bg-card border border-border shadow-lg z-50" role="listbox">
          {OVERVIEW_TIMEFRAME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full px-3 py-2 text-left text-xs transition-colors first:rounded-t-md last:rounded-b-md ${value === opt.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}
              role="option"
              aria-selected={value === opt.value}
            >
              <div className="font-medium">{opt.label}</div>
              <div className="text-[10px] opacity-70">{opt.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
