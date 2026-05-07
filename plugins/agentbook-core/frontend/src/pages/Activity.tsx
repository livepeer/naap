import React, { useEffect, useState, useCallback } from 'react';
import { Activity, User, Bot, Clock, Filter, ChevronDown, ChevronRight } from 'lucide-react';

const API = '/api/v1/agentbook-core';

interface AuditEvent {
  id: string;
  tenantId: string;
  actor: string;
  source: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

const ACTOR_ICON: Record<string, React.ReactNode> = {
  user: <User className="w-4 h-4 text-blue-500" />,
  bot: <Bot className="w-4 h-4 text-purple-500" />,
  cron: <Clock className="w-4 h-4 text-amber-500" />,
  api: <Activity className="w-4 h-4 text-gray-500" />,
};

function actorPrefix(actor: string): string {
  // user:<id> → 'user'; bot/cron/api → as-is
  return actor.split(':')[0];
}

function formatJson(v: unknown): string {
  if (v === null || v === undefined) return '—';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export const ActivityPage: React.FC = () => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [actor, setActor] = useState<string>('');
  const [action, setAction] = useState<string>('');
  const [entityType, setEntityType] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (actor) params.set('actor', actor);
    if (action) params.set('action', action);
    if (entityType) params.set('entityType', entityType);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    params.set('limit', '100');

    try {
      const res = await fetch(`${API}/audit-events?${params.toString()}`);
      const data = await res.json();
      if (data.success) setEvents(data.data || []);
    } finally {
      setLoading(false);
    }
  }, [actor, action, entityType, startDate, endDate]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Activity className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-semibold">Activity log</h1>
      </header>
      <p className="text-sm text-muted-foreground">
        Every change to your books is recorded here — who did it, where it
        happened, and exactly what changed. Useful for "when did we mark
        this paid?" or "who edited that expense?".
      </p>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Filter className="w-4 h-4" /> Filters
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Actor</label>
            <select
              className="w-full border rounded px-2 py-1.5 bg-background"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
            >
              <option value="">Any</option>
              <option value="user">User</option>
              <option value="bot">Bot</option>
              <option value="cron">Cron</option>
              <option value="api">API</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Action</label>
            <input
              className="w-full border rounded px-2 py-1.5 bg-background"
              placeholder="e.g. invoice.create"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Entity type</label>
            <input
              className="w-full border rounded px-2 py-1.5 bg-background"
              placeholder="e.g. AbInvoice"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Start date</label>
            <input
              type="date"
              className="w-full border rounded px-2 py-1.5 bg-background"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">End date</label>
            <input
              type="date"
              className="w-full border rounded px-2 py-1.5 bg-background"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Loading activity…</div>
      ) : events.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          No activity yet for these filters.
        </div>
      ) : (
        <div className="rounded-lg border bg-card divide-y">
          {events.map((e) => {
            const isOpen = expanded.has(e.id);
            return (
              <div key={e.id} className="px-4 py-3 text-sm">
                <button
                  type="button"
                  className="w-full flex items-start gap-3 text-left"
                  onClick={() => toggle(e.id)}
                >
                  <span className="mt-0.5">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </span>
                  <span className="mt-0.5">{ACTOR_ICON[actorPrefix(e.actor)] || ACTOR_ICON.api}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">{e.action}</code>
                      <span className="text-muted-foreground text-xs">{e.entityType}</span>
                      <span className="text-muted-foreground text-xs">·</span>
                      <span className="text-muted-foreground text-xs">{e.source}</span>
                      <span className="text-muted-foreground text-xs">·</span>
                      <span className="text-muted-foreground text-xs">{e.actor}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(e.createdAt).toLocaleString()} · entity{' '}
                      <code className="font-mono">{e.entityId}</code>
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="mt-3 ml-7 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">Before</div>
                      <pre className="text-xs bg-muted rounded p-2 overflow-x-auto">{formatJson(e.before)}</pre>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">After</div>
                      <pre className="text-xs bg-muted rounded p-2 overflow-x-auto">{formatJson(e.after)}</pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
