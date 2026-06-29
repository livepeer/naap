'use client';

/**
 * Admin — Per-Team Feature Flag Overrides
 *
 * Enable/disable a feature flag for a SINGLE team without changing the
 * platform-wide default. Pick a team (searchable), then for each flag set a
 * per-team override ON / OFF, or clear it to inherit the global value. Shows the
 * effective value and provenance (inherited vs overridden) for every flag.
 *
 * Guarded by `system:admin`. Purely additive: a team with no overrides behaves
 * exactly as the global flags dictate.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Flag,
  Loader2,
  Search,
  CheckCircle2,
  AlertTriangle,
  Users as UsersIcon,
} from 'lucide-react';
import { Input } from '@naap/ui';
import { useAuth } from '@/contexts/auth-context';
import { AdminNav } from '@/components/admin/AdminNav';
import { getCsrfToken } from '@/lib/api/csrf-client';
import { invalidateFeatureFlags } from '@/hooks/use-feature-flags';

interface TeamRow {
  id: string;
  name: string;
  slug: string;
  overrideCount: number;
}

interface FlagRow {
  key: string;
  description: string | null;
  globalEnabled: boolean;
  override: boolean | null;
  effective: boolean;
  source: 'override' | 'inherited';
  updatedBy: string | null;
  updatedAt: string | null;
}

type OverrideState = 'on' | 'off' | 'inherit';

function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AdminFeatureFlagsPage() {
  const router = useRouter();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('system:admin');

  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [teamSearch, setTeamSearch] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<TeamRow | null>(null);
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingFlags, setLoadingFlags] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  // Identifies the latest flag load so a slow response for a previously selected
  // team can never overwrite the flags shown for the team the admin is now on.
  const flagsRequestRef = useRef(0);

  useEffect(() => {
    if (!isAdmin) router.push('/dashboard');
  }, [isAdmin, router]);

  const loadTeams = useCallback(async (q: string) => {
    try {
      setLoadingTeams(true);
      const url = q
        ? `/api/v1/admin/feature-flag-overrides/teams?q=${encodeURIComponent(q)}`
        : '/api/v1/admin/feature-flag-overrides/teams';
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      if (data.success) setTeams(data.data.teams);
      else setFeedback({ type: 'error', message: data.error?.message || 'Failed to load teams' });
    } catch {
      setFeedback({ type: 'error', message: 'Failed to load teams' });
    } finally {
      setLoadingTeams(false);
    }
  }, []);

  const loadFlags = useCallback(async (teamId: string) => {
    const requestId = ++flagsRequestRef.current;
    const isStale = () => requestId !== flagsRequestRef.current;
    try {
      setLoadingFlags(true);
      const res = await fetch(
        `/api/v1/admin/feature-flag-overrides?teamId=${encodeURIComponent(teamId)}`,
        { credentials: 'include' },
      );
      const data = await res.json();
      // A newer team selection superseded this request — drop its result so it
      // can't clobber the active team's flags or feedback.
      if (isStale()) return;
      if (data.success) setFlags(data.data.flags);
      else setFeedback({ type: 'error', message: data.error?.message || 'Failed to load flags' });
    } catch {
      if (isStale()) return;
      setFeedback({ type: 'error', message: 'Failed to load flags' });
    } finally {
      if (!isStale()) setLoadingFlags(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadTeams('');
  }, [isAdmin, loadTeams]);

  // Debounced team search.
  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(() => loadTeams(teamSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [teamSearch, isAdmin, loadTeams]);

  function selectTeam(team: TeamRow) {
    setSelectedTeam(team);
    setFeedback(null);
    loadFlags(team.id);
  }

  async function applyOverride(flag: FlagRow, next: OverrideState) {
    if (!selectedTeam) return;
    setSavingKey(flag.key);
    setFeedback(null);
    try {
      const csrfToken = await getCsrfToken();
      const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken };
      let res: Response;
      if (next === 'inherit') {
        res = await fetch('/api/v1/admin/feature-flag-overrides', {
          method: 'DELETE',
          credentials: 'include',
          headers,
          body: JSON.stringify({ teamId: selectedTeam.id, key: flag.key }),
        });
      } else {
        res = await fetch('/api/v1/admin/feature-flag-overrides', {
          method: 'PUT',
          credentials: 'include',
          headers,
          body: JSON.stringify({ teamId: selectedTeam.id, key: flag.key, enabled: next === 'on' }),
        });
      }
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Update failed');

      await loadFlags(selectedTeam.id);
      // Reflect the new override count in the team list.
      loadTeams(teamSearch.trim());
      invalidateFeatureFlags();
      setFeedback({
        type: 'success',
        message:
          next === 'inherit'
            ? `Cleared override for "${flag.key}" — now inherits global`
            : `Set "${flag.key}" ${next.toUpperCase()} for ${selectedTeam.name}`,
      });
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Update failed' });
    } finally {
      setSavingKey(null);
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <AdminNav />

      <div className="mb-6">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Flag size={20} />
          Per-Team Feature Flags
        </h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Enable or disable a flag for a single team without changing the platform-wide default.
          Clear an override to inherit the global value.
        </p>
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 px-4 py-3 rounded-lg mb-4 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-500'
              : 'bg-destructive/10 text-destructive'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 size={16} />
          ) : (
            <AlertTriangle size={16} />
          )}
          <span className="text-sm">{feedback.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Team picker */}
        <div className="md:col-span-1">
          <div className="mb-3">
            <Input
              icon={<Search className="w-4 h-4" />}
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
              placeholder="Search teams..."
            />
          </div>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {loadingTeams ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : teams.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <UsersIcon className="w-7 h-7 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No teams found</p>
              </div>
            ) : (
              <ul className="divide-y divide-border max-h-[60vh] overflow-y-auto">
                {teams.map((team) => (
                  <li key={team.id}>
                    <button
                      onClick={() => selectTeam(team)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-muted/40 transition-colors ${
                        selectedTeam?.id === team.id ? 'bg-muted/60' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{team.name}</div>
                          <div className="text-[11px] text-muted-foreground font-mono truncate">
                            {team.slug}
                          </div>
                        </div>
                        {team.overrideCount > 0 && (
                          <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                            {team.overrideCount}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Flags for the selected team */}
        <div className="md:col-span-2">
          {!selectedTeam ? (
            <div className="flex flex-col items-center justify-center h-64 bg-muted/30 rounded-lg text-muted-foreground">
              <Flag className="w-8 h-8 mb-3 opacity-50" />
              <p className="text-sm">Select a team to manage its feature flag overrides</p>
            </div>
          ) : loadingFlags ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground mb-1">
                Managing <span className="font-medium text-foreground">{selectedTeam.name}</span>
              </div>
              {flags.map((flag) => {
                const state: OverrideState =
                  flag.override === null ? 'inherit' : flag.override ? 'on' : 'off';
                return (
                  <div
                    key={flag.key}
                    className="p-4 bg-card border border-border rounded-lg"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{humanizeKey(flag.key)}</p>
                          {flag.source === 'override' ? (
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
                              Overridden
                            </span>
                          ) : (
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              Inherited
                            </span>
                          )}
                          <span
                            className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                              flag.effective
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {flag.effective ? 'Effective: ON' : 'Effective: OFF'}
                          </span>
                        </div>
                        {flag.description && (
                          <p className="text-[13px] text-muted-foreground mt-1">{flag.description}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground/70 mt-1 font-mono">
                          {flag.key} · global default: {flag.globalEnabled ? 'ON' : 'OFF'}
                        </p>
                      </div>
                      <SegmentedControl
                        value={state}
                        disabled={savingKey === flag.key}
                        onChange={(next) => applyOverride(flag, next)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SegmentedControl({
  value,
  disabled,
  onChange,
}: {
  value: OverrideState;
  disabled: boolean;
  onChange: (next: OverrideState) => void;
}) {
  const options: { id: OverrideState; label: string }[] = [
    { id: 'on', label: 'On' },
    { id: 'off', label: 'Off' },
    { id: 'inherit', label: 'Inherit' },
  ];
  return (
    <div className="shrink-0 inline-flex rounded-md border border-border overflow-hidden">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled || active}
            onClick={() => onChange(opt.id)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-default ${
              active
                ? opt.id === 'on'
                  ? 'bg-emerald-500 text-white'
                  : opt.id === 'off'
                    ? 'bg-destructive text-white'
                    : 'bg-muted text-foreground'
                : 'bg-transparent text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
