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
import { Button, Input, Textarea, Label, Modal } from '@naap/ui';

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
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold">Teams</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Manage your teams and collaborate with others
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => setShowCreateModal(true)}
        >
          Create Team
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {teams.length === 0 ? (
        <div className="text-center py-8 bg-muted/50 rounded-lg">
          <Users className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-sm font-medium mb-1">No teams yet</h3>
          <p className="text-[13px] text-muted-foreground mb-4">
            Create a team to start collaborating with others
          </p>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setShowCreateModal(true)}
          >
            Create Your First Team
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {teams.map(team => {
            const role = team.membership?.role || 'member';
            return (
              <div
                key={team.id}
                onClick={() => router.push(`/teams/${team.id}`)}
                className="flex items-center justify-between p-3 bg-card border border-border rounded-lg hover:border-border/80 cursor-pointer transition-colors duration-fast"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center">
                    {team.avatarUrl ? (
                      <img src={team.avatarUrl} alt={team.name} className="w-10 h-10 rounded-md" />
                    ) : (
                      <Users className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-medium">{team.name}</h3>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
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
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
            );
          })}
        </div>
      )}

      {/* Create Team Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Team"
        size="md"
      >
        <form onSubmit={handleCreateTeam} className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Team Name</Label>
            <Input
              type="text"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="My Team"
              required
            />
          </div>

          <div>
            <Label className="mb-1.5 block">Description (optional)</Label>
            <Textarea
              value={newTeamDescription}
              onChange={(e) => setNewTeamDescription(e.target.value)}
              rows={3}
              placeholder="A brief description of your team"
              className="resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowCreateModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={creating}
            >
              Create Team
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
