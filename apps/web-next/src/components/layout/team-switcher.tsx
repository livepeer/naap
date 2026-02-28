'use client';

/**
 * Team Switcher Component
 * Allows users to switch between personal workspace and team contexts.
 * Sleek, modern design with glassmorphism effects.
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
  Loader2
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { usePlugins } from '@/contexts/plugin-context';
import { useEvents } from '@/contexts/shell-context';

interface Team {
  id: string;
  name: string;
  avatarUrl: string | null;
  _count?: { members: number };
}

export function TeamSwitcher() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { refreshPlugins } = usePlugins();
  const eventBus = useEvents();
  const [isOpen, setIsOpen] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
    const unsubscribe = eventBus.on('team:created', () => {
      loadTeams();
    });
    return unsubscribe;
  }, [eventBus, loadTeams]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleSelectTeam(team: Team | null) {
    if (switching) return;

    if ((team === null && currentTeam === null) ||
      (team && currentTeam && team.id === currentTeam.id)) {
      setIsOpen(false);
      return;
    }

    setIsOpen(false);
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

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={switching}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-xl
          bg-muted/30 border border-border/50
          hover:bg-muted/50 transition-all text-sm
          disabled:opacity-50
          ${isOpen ? 'bg-muted/50 ring-1 ring-primary/20' : ''}
        `}
      >
        {switching ? (
          <>
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
            <span className="text-muted-foreground hidden sm:inline">Switching...</span>
          </>
        ) : currentTeam ? (
          <>
            <div className="w-5 h-5 rounded-md bg-primary/20 flex items-center justify-center">
              <Users size={12} className="text-primary" />
            </div>
            <span className="max-w-[100px] truncate hidden sm:inline font-medium">{currentTeam.name}</span>
          </>
        ) : (
          <>
            <div className="w-5 h-5 rounded-md bg-muted flex items-center justify-center">
              <User size={12} className="text-muted-foreground" />
            </div>
            <span className="text-muted-foreground hidden sm:inline">Personal</span>
          </>
        )}
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Glassmorphism container */}
          <div className="bg-card/95 backdrop-blur-xl border border-border/50 rounded-2xl shadow-xl shadow-black/10">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border/50">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Workspaces
              </p>
            </div>

            {/* Options */}
            <div className="p-2 max-h-72 overflow-y-auto">
              {/* Personal Workspace */}
              <button
                onClick={() => handleSelectTeam(null)}
                className={`
                  w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl transition-all
                  ${!currentTeam
                    ? 'bg-primary/10 text-foreground'
                    : 'hover:bg-muted/80 text-muted-foreground hover:text-foreground'
                  }
                `}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center shadow-sm">
                    <User size={16} className="text-white" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium text-sm">Personal</p>
                    <p className="text-xs text-muted-foreground">Your workspace</p>
                  </div>
                </div>
                {!currentTeam && (
                  <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <Check size={12} className="text-primary-foreground" />
                  </div>
                )}
              </button>

              {/* Teams */}
              {teams.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50">
                  {teams.map(team => (
                    <button
                      key={team.id}
                      onClick={() => handleSelectTeam(team)}
                      className={`
                        w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl transition-all
                        ${currentTeam?.id === team.id
                          ? 'bg-primary/10 text-foreground'
                          : 'hover:bg-muted/80 text-muted-foreground hover:text-foreground'
                        }
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center overflow-hidden">
                          {team.avatarUrl ? (
                            <img src={team.avatarUrl} alt="" className="w-9 h-9 object-cover" />
                          ) : (
                            <Users size={16} className="text-muted-foreground" />
                          )}
                        </div>
                        <div className="text-left min-w-0">
                          <p className="font-medium text-sm truncate max-w-[140px]">{team.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {team._count?.members || 0} member{(team._count?.members || 0) !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                      {currentTeam?.id === team.id && (
                        <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                          <Check size={12} className="text-primary-foreground" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {loading && (
                <div className="py-6 text-center">
                  <Loader2 size={20} className="animate-spin text-muted-foreground mx-auto" />
                  <p className="text-xs text-muted-foreground mt-2">Loading teams...</p>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-2 border-t border-border/50 bg-muted/30">
              <button
                onClick={() => {
                  setIsOpen(false);
                  router.push('/teams');
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg transition-all"
              >
                <Plus size={16} />
                <span>Create New Team</span>
              </button>
              <button
                onClick={() => {
                  setIsOpen(false);
                  router.push('/teams');
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg transition-all"
              >
                <Settings size={16} />
                <span>Manage Teams</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TeamSwitcher;
