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
import { Button, Input, Textarea, Label, Select, Modal } from '@naap/ui';

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
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!team || myRole === 'member' || myRole === 'viewer') {
    return (
      <div className="max-w-2xl mx-auto">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeft className="w-4 h-4" />}
          onClick={() => router.push('/teams')}
          className="mb-4"
        >
          Back to Teams
        </Button>
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">
          {error || 'You do not have permission to access team settings'}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft className="w-4 h-4" />}
        onClick={() => router.push(`/teams/${teamId}`)}
        className="mb-4"
      >
        Back to {team.name}
      </Button>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg mb-4 text-sm">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="bg-green-500/10 text-green-500 px-4 py-3 rounded-lg mb-4 text-sm">
          {successMessage}
        </div>
      )}

      {/* General Settings */}
      <div className="bg-card border border-border rounded-lg p-4 mb-4">
        <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
          <Settings className="w-4 h-4" />
          General Settings
        </h2>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Team Name</Label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <Label className="mb-1.5 block">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={saving}>
              Save Changes
            </Button>
          </div>
        </form>
      </div>

      {/* Danger Zone - Owner Only */}
      {isOwner && (
        <div className="bg-card border border-destructive/30 rounded-lg p-4">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-destructive mb-4">
            <AlertTriangle className="w-4 h-4" />
            Danger Zone
          </h2>

          <div className="space-y-3">
            {/* Transfer Ownership */}
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <h3 className="text-sm font-medium">Transfer Ownership</h3>
                <p className="text-xs text-muted-foreground">
                  Transfer this team to another member
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowTransferModal(true)}
              >
                Transfer
              </Button>
            </div>

            {/* Delete Team */}
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <h3 className="text-sm font-medium">Delete Team</h3>
                <p className="text-xs text-muted-foreground">
                  Permanently delete this team and all its data
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete Team
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setDeleteConfirmText('');
        }}
        title="Delete Team"
        size="sm"
      >
        <p className="text-sm text-muted-foreground mb-4">
          This action cannot be undone. This will permanently delete the team
          <strong className="text-foreground"> {team.name}</strong>.
        </p>

        <div className="mb-4">
          <Label className="mb-1.5 block">
            Type <strong>{team.name}</strong> to confirm
          </Label>
          <Input
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            error={false}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setShowDeleteConfirm(false);
              setDeleteConfirmText('');
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteConfirmText !== team.name}
            loading={deleting}
          >
            Delete Team
          </Button>
        </div>
      </Modal>

      {/* Transfer Ownership Modal */}
      <Modal
        isOpen={showTransferModal}
        onClose={() => {
          setShowTransferModal(false);
          setNewOwnerId('');
        }}
        title="Transfer Ownership"
        size="sm"
      >
        <p className="text-sm text-muted-foreground mb-4">
          Select a member to become the new owner of this team. You will become an admin.
        </p>

        <div className="mb-4">
          <Label className="mb-1.5 block">New Owner</Label>
          <Select
            value={newOwnerId}
            onChange={(e) => setNewOwnerId(e.target.value)}
          >
            <option value="">Select a member</option>
            {members.map(member => (
              <option key={member.id} value={member.userId}>
                {member.user.displayName || member.user.email}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setShowTransferModal(false);
              setNewOwnerId('');
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleTransferOwnership}
            disabled={!newOwnerId}
            loading={transferring}
          >
            Transfer Ownership
          </Button>
        </div>
      </Modal>
    </div>
  );
}
