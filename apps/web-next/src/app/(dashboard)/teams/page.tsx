'use client';

/**
 * Team List Page
 * Displays all teams the user is a member of.
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Plus,
  ChevronRight,
  Crown,
  Shield,
  User,
  Eye,
  Package,
  Loader2
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useEvents } from '@/contexts/shell-context';

interface Team {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  membership?: { role: string };
  _count?: { members: number; pluginInstalls: number };
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  owner: <Crown className="w-4 h-4 text-yellow-500" />,
  admin: <Shield className="w-4 h-4 text-blue-500" />,
  member: <User className="w-4 h-4 text-gray-500" />,
  viewer: <Eye className="w-4 h-4 text-gray-400" />,
};

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export default function TeamListPage() {
  const router = useRouter();
  const { } = useAuth();
  const eventBus = useEvents();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDescription, setNewTeamDescription] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadTeams();
  }, []);

  async function loadTeams() {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/teams', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setTeams(data.data.teams || []);
      } else {
        setError(data.error?.message || 'Failed to load teams');
      }
    } catch (err) {
      setError('Failed to load teams');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!newTeamName.trim()) return;

    // Generate slug from name
    const slug = newTeamName.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    try {
      setCreating(true);
      const res = await fetch('/api/v1/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newTeamName.trim(),
          slug,
          description: newTeamDescription.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreateModal(false);
        setNewTeamName('');
        setNewTeamDescription('');
        loadTeams();
        // Emit event to notify TeamSwitcher to refresh its list
        eventBus.emit('team:created', { team: data.data?.team || data.team });
      } else {
        setError(data.error?.message || 'Failed to create team');
      }
    } catch (err) {
      setError('Failed to create team');
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Teams</h1>
          <p className="text-muted-foreground mt-1">
            Manage your teams and collaborate with others
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Team
        </button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {teams.length === 0 ? (
        <div className="text-center py-12 bg-muted/50 rounded-xl">
          <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No teams yet</h3>
          <p className="text-muted-foreground mb-4">
            Create a team to start collaborating with others
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Your First Team
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {teams.map(team => {
            const role = team.membership?.role || 'member';
            return (
              <div
                key={team.id}
                onClick={() => router.push(`/teams/${team.id}`)}
                className="flex items-center justify-between p-4 bg-card border border-border rounded-xl hover:border-primary/50 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    {team.avatarUrl ? (
                      <img src={team.avatarUrl} alt={team.name} className="w-12 h-12 rounded-lg" />
                    ) : (
                      <Users className="w-6 h-6 text-primary" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-medium">{team.name}</h3>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        {ROLE_ICONS[role]}
                        {ROLE_LABELS[role]}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {team._count?.members || 0} members
                      </span>
                      <span className="flex items-center gap-1">
                        <Package className="w-3 h-3" />
                        {team._count?.pluginInstalls || 0} plugins
                      </span>
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </div>
            );
          })}
        </div>
      )}

      {/* Create Team Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md m-4 shadow-xl">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              Create Team
            </h2>

            <form onSubmit={handleCreateTeam} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Team Name</label>
                <input
                  type="text"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="My Team"
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description (optional)</label>
                <textarea
                  value={newTeamDescription}
                  onChange={(e) => setNewTeamDescription(e.target.value)}
                  rows={3}
                  placeholder="A brief description of your team"
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create Team
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
