'use client';

/**
 * Team Settings Page
 * Configure team settings, transfer ownership, or delete team.
 */

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Settings,
  ArrowLeft,
  Trash2,
  AlertTriangle,
  Loader2,
  Crown
} from 'lucide-react';

interface Team {
  id: string;
  name: string;
  description: string | null;
  membership?: { role: string };
}

interface TeamMember {
  id: string;
  userId: string;
  role: string;
  user: {
    displayName: string | null;
    email: string | null;
  };
}

export default function TeamSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const teamId = params.teamId as string;
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [myRole, setMyRole] = useState<string>('member');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Danger zone
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [newOwnerId, setNewOwnerId] = useState('');
  const [transferring, setTransferring] = useState(false);

  const isOwner = myRole === 'owner';

  useEffect(() => {
    if (teamId) {
      loadTeamData();
    }
  }, [teamId]);

  async function loadTeamData() {
    try {
      setLoading(true);
      const [teamRes, membersRes] = await Promise.all([
        fetch(`/api/v1/teams/${teamId}`, { credentials: 'include' }),
        fetch(`/api/v1/teams/${teamId}/members`, { credentials: 'include' }),
      ]);
      
      const teamData = await teamRes.json();
      const membersData = await membersRes.json();
      
      if (teamData.success) {
        setTeam(teamData.data.team);
        // membership is at data level, not inside team
        setMyRole(teamData.data.membership?.role || teamData.data.team.membership?.role || 'member');
        setName(teamData.data.team.name);
        setDescription(teamData.data.team.description || '');
      } else {
        setError(teamData.error?.message || 'Failed to load team');
      }
      
      if (membersData.success) {
        setMembers((membersData.data.members || []).filter((m: TeamMember) => m.role !== 'owner'));
      }
    } catch (err) {
      setError('Failed to load team');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/v1/teams/${teamId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage('Team settings saved successfully');
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setError(data.error?.message || 'Failed to save settings');
      }
    } catch (err) {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleteConfirmText !== team?.name) return;

    try {
      setDeleting(true);
      await fetch(`/api/v1/teams/${teamId}`, { method: 'DELETE', credentials: 'include' });
      router.push('/teams');
    } catch (err) {
      setError('Failed to delete team');
      setDeleting(false);
    }
  }

  async function handleTransferOwnership() {
    if (!newOwnerId) return;

    try {
      setTransferring(true);
      const res = await fetch(`/api/v1/teams/${teamId}/transfer-ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newOwnerId }),
      });
      const data = await res.json();
      if (data.success) {
        setShowTransferModal(false);
        loadTeamData();
      } else {
        setError(data.error?.message || 'Failed to transfer ownership');
      }
    } catch (err) {
      setError('Failed to transfer ownership');
    } finally {
      setTransferring(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!team || myRole === 'member' || myRole === 'viewer') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button
          onClick={() => router.push('/teams')}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Teams
        </button>
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg">
          {error || 'You do not have permission to access team settings'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button
        onClick={() => router.push(`/teams/${teamId}`)}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to {team.name}
      </button>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="bg-green-500/10 text-green-500 px-4 py-3 rounded-lg mb-6">
          {successMessage}
        </div>
      )}

      {/* General Settings */}
      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
          <Settings className="w-5 h-5" />
          General Settings
        </h2>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Team Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>

      {/* Danger Zone - Owner Only */}
      {isOwner && (
        <div className="bg-card border border-destructive/50 rounded-xl p-6">
          <h2 className="text-lg font-bold flex items-center gap-2 text-destructive mb-4">
            <AlertTriangle className="w-5 h-5" />
            Danger Zone
          </h2>

          <div className="space-y-4">
            {/* Transfer Ownership */}
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div>
                <h3 className="font-medium">Transfer Ownership</h3>
                <p className="text-sm text-muted-foreground">
                  Transfer this team to another member
                </p>
              </div>
              <button
                onClick={() => setShowTransferModal(true)}
                className="px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Transfer
              </button>
            </div>

            {/* Delete Team */}
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div>
                <h3 className="font-medium">Delete Team</h3>
                <p className="text-sm text-muted-foreground">
                  Permanently delete this team and all its data
                </p>
              </div>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors"
              >
                Delete Team
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md m-4 shadow-xl">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Delete Team
            </h2>

            <p className="text-muted-foreground mb-4">
              This action cannot be undone. This will permanently delete the team
              <strong className="text-foreground"> {team.name}</strong>.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">
                Type <strong>{team.name}</strong> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-destructive/50"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmText('');
                }}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirmText !== team.name || deleting}
                className="flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors disabled:opacity-50"
              >
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete Team
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Ownership Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md m-4 shadow-xl">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Crown className="w-5 h-5 text-yellow-500" />
              Transfer Ownership
            </h2>

            <p className="text-muted-foreground mb-4">
              Select a member to become the new owner of this team. You will become an admin.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">New Owner</label>
              <select
                value={newOwnerId}
                onChange={(e) => setNewOwnerId(e.target.value)}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Select a member</option>
                {members.map(member => (
                  <option key={member.id} value={member.userId}>
                    {member.user.displayName || member.user.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowTransferModal(false);
                  setNewOwnerId('');
                }}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleTransferOwnership}
                disabled={!newOwnerId || transferring}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {transferring && <Loader2 className="w-4 h-4 animate-spin" />}
                Transfer Ownership
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
