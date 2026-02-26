'use client';

/**
 * WorkspaceSwitcher — Linear-style unified control.
 *
 * Sits at the top of the sidebar and combines:
 *   • Workspace / team identity (primary label)
 *   • Team switching (personal ↔ team contexts)
 *   • Account actions (settings, theme, sign out)
 *
 * Replaces the separate TeamSwitcher + user avatar pattern.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  ChevronDown,
  User,
  Plus,
  Check,
  Settings,
  Loader2,
  LogOut,
  Moon,
  Sun,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { usePlugins } from '@/contexts/plugin-context';
import { useEvents, useShell } from '@/contexts/shell-context';

interface Team {
  id: string;
  name: string;
  avatarUrl: string | null;
  _count?: { members: number };
}

export function WorkspaceSwitcher({ isOpen }: { isOpen: boolean }) {
  const router = useRouter();
  const { isAuthenticated, user, logout } = useAuth();
  const { refreshPlugins } = usePlugins();
  const eventBus = useEvents();
  const { theme } = useShell();

  const [menuOpen, setMenuOpen] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Data loading ──────────────────────────────────────

  const loadTeams = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/teams', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setTeams(data.data.teams || []);
      }
    } catch (err) {
      console.error('Failed to load teams:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCurrentTeam = useCallback(async (teamId: string) => {
    try {
      const res = await fetch(`/api/v1/teams/${teamId}`, { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setCurrentTeam(data.data.team);
      } else {
        localStorage.removeItem('naap_current_team');
        setCurrentTeam(null);
      }
    } catch (err) {
      console.error('Failed to load current team:', err);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadTeams();
      const savedTeamId = localStorage.getItem('naap_current_team');
      if (savedTeamId) {
        loadCurrentTeam(savedTeamId);
      }
    }
  }, [isAuthenticated, loadTeams, loadCurrentTeam]);

  useEffect(() => {
    const unsubscribe = eventBus.on('team:created', () => { loadTeams(); });
    return unsubscribe;
  }, [eventBus, loadTeams]);

  // ── Click-outside dismiss ─────────────────────────────

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Team switching ────────────────────────────────────

  async function handleSelectTeam(team: Team | null) {
    if (switching) return;
    if ((team === null && !currentTeam) || (team && currentTeam?.id === team.id)) {
      setMenuOpen(false);
      return;
    }

    setMenuOpen(false);
    setSwitching(true);
    try {
      if (team) {
        localStorage.setItem('naap_current_team', team.id);
      } else {
        localStorage.removeItem('naap_current_team');
      }
      setCurrentTeam(team);
      eventBus.emit('team:change', { teamId: team?.id || null, team });
      await refreshPlugins();
      router.refresh();
    } catch (err) {
      console.error('Failed to switch team:', err);
    } finally {
      setSwitching(false);
    }
  }

  if (!isAuthenticated) return null;

  // Derive the display name: team name > "Personal" workspace
  const workspaceName = currentTeam?.name || 'Personal';
  const initials = workspaceName[0].toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      {/* ── Trigger ──────────────────────────────────── */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        disabled={switching}
        className="flex items-center gap-2 min-w-0 px-1 py-1 rounded-md hover:bg-muted/50 transition-colors disabled:opacity-50"
      >
        {/* Workspace icon */}
        <div className="w-6 h-6 flex-shrink-0 rounded-md bg-primary/20 flex items-center justify-center">
          {switching ? (
            <Loader2 size={12} className="animate-spin text-primary" />
          ) : currentTeam ? (
            currentTeam.avatarUrl ? (
              <img src={currentTeam.avatarUrl} alt="" className="w-6 h-6 rounded-md object-cover" />
            ) : (
              <Users size={12} className="text-primary" />
            )
          ) : user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="w-6 h-6 rounded-md object-cover" />
          ) : (
            <span className="text-[10px] font-bold text-primary">{initials}</span>
          )}
        </div>

        {isOpen && (
          <>
            <span className="text-[13px] font-semibold text-foreground truncate max-w-[130px]">
              {switching ? 'Switching...' : workspaceName}
            </span>
            <ChevronDown
              size={12}
              className={`text-muted-foreground shrink-0 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
            />
          </>
        )}
      </button>

      {/* ── Dropdown ─────────────────────────────────── */}
      {menuOpen && (
        <div className="absolute left-0 top-full mt-1 w-64 z-50 animate-in fade-in slide-in-from-top-1 duration-100">
          <div className="bg-popover border border-border rounded-lg shadow-xl shadow-black/20 overflow-hidden">

            {/* Account header */}
            <div className="px-3 py-2.5 border-b border-border/50">
              <p className="text-[13px] font-medium text-foreground truncate">
                {user?.displayName || user?.email || 'User'}
              </p>
              {user?.email && user?.displayName && (
                <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
              )}
            </div>

            {/* Workspace list */}
            <div className="p-1.5 max-h-52 overflow-y-auto">
              <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                Workspaces
              </p>

              {/* Personal */}
              <button
                onClick={() => handleSelectTeam(null)}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md transition-colors text-left ${
                  !currentTeam
                    ? 'bg-muted/60 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-5 h-5 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <User size={11} className="text-muted-foreground" />
                  </div>
                  <span className="text-[13px] truncate">Personal</span>
                </div>
                {!currentTeam && <Check size={14} className="text-primary shrink-0" />}
              </button>

              {/* Teams */}
              {teams.map(team => (
                <button
                  key={team.id}
                  onClick={() => handleSelectTeam(team)}
                  className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md transition-colors text-left ${
                    currentTeam?.id === team.id
                      ? 'bg-muted/60 text-foreground'
                      : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-5 h-5 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                      {team.avatarUrl ? (
                        <img src={team.avatarUrl} alt="" className="w-5 h-5 object-cover" />
                      ) : (
                        <Users size={11} className="text-muted-foreground" />
                      )}
                    </div>
                    <span className="text-[13px] truncate">{team.name}</span>
                  </div>
                  {currentTeam?.id === team.id && <Check size={14} className="text-primary shrink-0" />}
                </button>
              ))}

              {loading && (
                <div className="py-3 text-center">
                  <Loader2 size={14} className="animate-spin text-muted-foreground mx-auto" />
                </div>
              )}

              <button
                onClick={() => { setMenuOpen(false); router.push('/teams'); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
              >
                <Plus size={14} className="shrink-0" />
                <span className="text-[13px]">Create team</span>
              </button>
            </div>

            {/* Account actions */}
            <div className="p-1.5 border-t border-border/50 space-y-0.5">
              <button
                onClick={() => { setMenuOpen(false); router.push('/settings'); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
              >
                <Settings size={14} className="shrink-0" />
                <span className="text-[13px]">Settings</span>
              </button>
              <button
                onClick={() => { theme.toggle(); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
              >
                {theme.mode === 'dark' ? <Sun size={14} className="shrink-0" /> : <Moon size={14} className="shrink-0" />}
                <span className="text-[13px]">{theme.mode === 'dark' ? 'Light mode' : 'Dark mode'}</span>
              </button>
              <button
                onClick={() => { setMenuOpen(false); logout(); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
              >
                <LogOut size={14} className="shrink-0" />
                <span className="text-[13px]">Sign out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorkspaceSwitcher;
