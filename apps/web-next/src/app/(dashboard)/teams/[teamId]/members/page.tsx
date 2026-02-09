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
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !team) {
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
          {error || 'Team not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button
        onClick={() => router.push(`/teams/${teamId}`)}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to {team.name}
      </button>

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Users className="w-5 h-5" />
              Team Members
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {members.length} {members.length === 1 ? 'member' : 'members'}
            </p>
          </div>
          {canInviteMembers && (
            <button
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Invite Member
            </button>
          )}
        </div>

        <div className="space-y-3">
          {members.map(member => (
            <div
              key={member.id}
              className="flex items-center justify-between p-4 bg-muted/50 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  {member.user.avatarUrl ? (
                    <img src={member.user.avatarUrl} alt="" className="w-10 h-10 rounded-full" />
                  ) : (
                    <User className="w-5 h-5 text-primary" />
                  )}
                </div>
                <div>
                  <h3 className="font-medium">
                    {member.user.displayName || member.user.email || 'Unknown User'}
                  </h3>
                  <p className="text-sm text-muted-foreground">{member.user.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  {ROLE_ICONS[member.role]}
                  {canManageMembers && member.role !== 'owner' ? (
                    <select
                      value={member.role}
                      onChange={(e) => handleUpdateRole(member.id, e.target.value)}
                      className="bg-transparent border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <span className="text-sm">{ROLE_LABELS[member.role]}</span>
                  )}
                </div>
                {canManageMembers && member.role !== 'owner' && (
                  <button
                    onClick={() => handleRemoveMember(member.id)}
                    className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md m-4 shadow-xl">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-primary" />
              Invite Team Member
            </h2>

            {inviteError && (
              <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg mb-4 text-sm">
                {inviteError}
              </div>
            )}

            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Email Address</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="member@example.com"
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="admin">Admin - Can manage members and configure plugins</option>
                  <option value="member">Member - Can use plugins</option>
                  <option value="viewer">Viewer - Read-only access</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {inviting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Send Invite
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
