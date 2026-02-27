'use client';

/**
 * Team Members Page
 * Manage team members, invite new members, and set roles.
 */

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Users,
  ArrowLeft,
  Crown,
  Shield,
  User,
  Eye,
  UserPlus,
  Trash2,
  Loader2
} from 'lucide-react';
import { Button, Input, Select, Label, Modal } from '@naap/ui';

interface Team {
  id: string;
  name: string;
  membership?: { role: string };
}

interface TeamMember {
  id: string;
  userId: string;
  role: string;
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
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

export default function TeamMembersPage() {
  const params = useParams();
  const router = useRouter();
  const teamId = params.teamId as string;
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [myRole, setMyRole] = useState<string>('member');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const canManageMembers = myRole === 'owner' || myRole === 'admin';
  const canInviteMembers = myRole === 'owner' || myRole === 'admin';

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
      } else {
        setError(teamData.error?.message || 'Failed to load team');
      }

      if (membersData.success) {
        setMembers(membersData.data.members || []);
      }
    } catch (err) {
      setError('Failed to load team');
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    try {
      setInviting(true);
      setInviteError(null);
      const res = await fetch(`/api/v1/teams/${teamId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowInviteModal(false);
        setInviteEmail('');
        setInviteRole('member');
        loadTeamData();
      } else {
        setInviteError(data.error?.message || 'Failed to invite member');
      }
    } catch (err) {
      setInviteError('Failed to invite member');
    } finally {
      setInviting(false);
    }
  }

  async function handleUpdateRole(memberId: string, role: string) {
    try {
      await fetch(`/api/v1/teams/${teamId}/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role }),
      });
      setMembers(prev =>
        prev.map(m => m.id === memberId ? { ...m, role } : m)
      );
    } catch (err) {
      console.error('Failed to update role:', err);
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!confirm('Are you sure you want to remove this member?')) return;

    try {
      await fetch(`/api/v1/teams/${teamId}/members/${memberId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      setMembers(prev => prev.filter(m => m.id !== memberId));
    } catch (err) {
      console.error('Failed to remove member:', err);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="max-w-4xl mx-auto">
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
          {error || 'Team not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft className="w-4 h-4" />}
        onClick={() => router.push(`/teams/${teamId}`)}
        className="mb-4"
      >
        Back to {team.name}
      </Button>

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-base font-semibold flex items-center gap-2">
              <Users className="w-4 h-4" />
              Team Members
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {members.length} {members.length === 1 ? 'member' : 'members'}
            </p>
          </div>
          {canInviteMembers && (
            <Button
              variant="primary"
              size="sm"
              icon={<UserPlus className="w-4 h-4" />}
              onClick={() => setShowInviteModal(true)}
            >
              Invite Member
            </Button>
          )}
        </div>

        <div className="space-y-2">
          {members.map(member => (
            <div
              key={member.id}
              className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  {member.user.avatarUrl ? (
                    <img src={member.user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
                  ) : (
                    <User className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-medium">
                    {member.user.displayName || member.user.email || 'Unknown User'}
                  </h3>
                  <p className="text-xs text-muted-foreground">{member.user.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2">
                  {ROLE_ICONS[member.role]}
                  {canManageMembers && member.role !== 'owner' ? (
                    <Select
                      value={member.role}
                      onChange={(e) => handleUpdateRole(member.id, e.target.value)}
                      className="h-8 text-xs w-auto"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </Select>
                  ) : (
                    <span className="text-xs">{ROLE_LABELS[member.role]}</span>
                  )}
                </div>
                {canManageMembers && member.role !== 'owner' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveMember(member.id)}
                    className="text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Invite Modal */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title="Invite Team Member"
        size="md"
      >
        {inviteError && (
          <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg mb-4 text-sm">
            {inviteError}
          </div>
        )}

        <form onSubmit={handleInvite} className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Email Address</Label>
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="member@example.com"
              required
            />
          </div>

          <div>
            <Label className="mb-1.5 block">Role</Label>
            <Select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}
            >
              <option value="admin">Admin - Can manage members and configure plugins</option>
              <option value="member">Member - Can use plugins</option>
              <option value="viewer">Viewer - Read-only access</option>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowInviteModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={inviting}
            >
              Send Invite
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
