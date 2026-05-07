'use client';

/**
 * Admin User Management Page
 * View and manage all users — change roles and suspend/activate accounts.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Shield,
  User,
  Crown,
  MoreVertical,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Mail,
  Calendar,
  Search,
  ShieldCheck,
  Ban,
  Play,
  X,
} from 'lucide-react';
import { Button, Input, Select, Badge } from '@naap/ui';
import { useAuth } from '@/contexts/auth-context';
import { AdminNav } from '@/components/admin/AdminNav';
import { getCsrfToken } from '@/lib/api/csrf-client';

interface SystemRole {
  id: string;
  name: string;
  displayName: string | null;
  scope: string | null;
}

interface SystemUser {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  walletAddress: string | null;
  roles: string[];
  emailVerified: boolean;
  suspended: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  _count?: { teamMemberships: number };
}

type ModalState =
  | { type: 'none' }
  | { type: 'role'; user: SystemUser }
  | { type: 'suspend'; user: SystemUser }
  | { type: 'activate'; user: SystemUser };

export default function AdminUsersPage() {
  const router = useRouter();
  const { hasRole, user: currentUser } = useAuth();
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [allRoles, setAllRoles] = useState<SystemRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [actionLoading, setActionLoading] = useState(false);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAdmin = hasRole('system:admin');

  useEffect(() => {
    if (!isAdmin) {
      router.push('/dashboard');
      return;
    }
    loadData();
  }, [isAdmin]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [usersRes, rolesRes] = await Promise.all([
        fetch('/api/v1/admin/users', { credentials: 'include' }),
        fetch('/api/v1/admin/roles', { credentials: 'include' }),
      ]);
      const usersData = await usersRes.json();
      const rolesData = await rolesRes.json();

      if (usersData.success) setUsers(usersData.data.users || []);
      else setError(usersData.error?.message || 'Failed to load users');

      if (rolesData.success) setAllRoles(rolesData.data.roles || []);
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  const isSelf = useCallback(
    (userId: string) => currentUser?.id === userId,
    [currentUser]
  );

  const isRoot = (user: SystemUser) => user.roles.includes('system:root');

  const filteredUsers = users.filter(user => {
    const matchesSearch =
      !searchQuery ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.walletAddress?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesRole =
      selectedRole === 'all' ||
      (selectedRole === 'suspended'
        ? user.suspended
        : user.roles.some(r => r.includes(selectedRole)));

    return matchesSearch && matchesRole;
  });

  const getRoleIcon = (roles: string[]) => {
    if (roles.includes('system:admin')) return <Crown className="w-4 h-4 text-yellow-500" />;
    if (roles.some(r => r.includes(':admin'))) return <Shield className="w-4 h-4 text-blue-500" />;
    return <User className="w-4 h-4 text-gray-500" />;
  };

  const getRoleBadges = (roles: string[]) => {
    return roles.slice(0, 3).map(role => (
      <Badge key={role} variant="blue">
        {role.replace('system:', '').replace(':admin', ' Admin')}
      </Badge>
    ));
  };

  if (!isAdmin) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-5 w-5 animate-spin text-muted-foreground border-2 border-current border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <AdminNav />
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="w-5 h-5" />
            User Management
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage user roles and account status
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          {users.length} total users
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1">
          <Input
            icon={<Search className="w-4 h-4" />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by email, name, or wallet..."
          />
        </div>
        <Select
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value)}
        >
          <option value="all">All Roles</option>
          <option value="system:admin">System Admin</option>
          <option value=":admin">Plugin Admin</option>
          <option value="viewer">Viewer</option>
          <option value="suspended">Suspended</option>
        </Select>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">User</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Roles</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Joined</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Teams</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  <Users className="w-8 h-8 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No users found</p>
                </td>
              </tr>
            ) : (
              filteredUsers.map(user => (
                <tr key={user.id} className={`hover:bg-muted/30 ${user.suspended ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center">
                        {user.avatarUrl ? (
                          <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-md" />
                        ) : (
                          getRoleIcon(user.roles)
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{user.displayName || 'No Name'}</div>
                        <div className="text-sm text-muted-foreground flex items-center gap-1">
                          {user.email ? (
                            <>
                              <Mail className="w-3 h-3" />
                              {user.email}
                            </>
                          ) : user.walletAddress ? (
                            <span className="font-mono text-xs">
                              {user.walletAddress.slice(0, 6)}...{user.walletAddress.slice(-4)}
                            </span>
                          ) : (
                            'No email'
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {getRoleBadges(user.roles)}
                      {user.roles.length > 3 && (
                        <span className="px-2 py-0.5 text-xs text-muted-foreground">
                          +{user.roles.length - 3} more
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {user.suspended ? (
                      <span className="flex items-center gap-1 text-destructive text-sm" title={user.suspendedReason || undefined}>
                        <Ban className="w-4 h-4" />
                        Suspended
                      </span>
                    ) : user.emailVerified ? (
                      <span className="flex items-center gap-1 text-green-500 text-sm">
                        <CheckCircle2 className="w-4 h-4" />
                        Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-muted-foreground text-sm">
                        <XCircle className="w-4 h-4" />
                        Unverified
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(user.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-sm">
                    {user._count?.teamMemberships || 0}
                  </td>
                  <td className="px-4 py-2.5 text-right relative">
                    {!isSelf(user.id) && !isRoot(user) ? (
                      <div className="relative inline-block" ref={openDropdown === user.id ? dropdownRef : undefined}>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<MoreVertical className="w-4 h-4" />}
                          onClick={() => setOpenDropdown(openDropdown === user.id ? null : user.id)}
                        />
                        {openDropdown === user.id && (
                          <div className="absolute right-0 top-full mt-1 w-48 bg-popover border border-border rounded-lg shadow-lg z-50 py-1">
                            <button
                              className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2"
                              onClick={() => {
                                setOpenDropdown(null);
                                setModal({ type: 'role', user });
                              }}
                            >
                              <ShieldCheck className="w-4 h-4" />
                              Change Role
                            </button>
                            {user.suspended ? (
                              <button
                                className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2 text-green-500"
                                onClick={() => {
                                  setOpenDropdown(null);
                                  setModal({ type: 'activate', user });
                                }}
                              >
                                <Play className="w-4 h-4" />
                                Activate User
                              </button>
                            ) : (
                              <button
                                className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2 text-destructive"
                                onClick={() => {
                                  setOpenDropdown(null);
                                  setModal({ type: 'suspend', user });
                                }}
                              >
                                <Ban className="w-4 h-4" />
                                Suspend User
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {isSelf(user.id) ? 'You' : 'Root'}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modal.type === 'role' && (
        <RoleChangeModal
          user={modal.user}
          allRoles={allRoles}
          loading={actionLoading}
          onClose={() => setModal({ type: 'none' })}
          onSubmit={async (roleNames) => {
            setActionLoading(true);
            setError(null);
            try {
              const csrfToken = await getCsrfToken();
              const res = await fetch(`/api/v1/admin/users/${modal.user.id}/role`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({ roles: roleNames }),
              });
              const data = await res.json();
              if (!data.success) {
                setError(data.error?.message || 'Failed to change role');
              } else {
                await loadData();
              }
            } catch {
              setError('Failed to change role');
            } finally {
              setActionLoading(false);
              setModal({ type: 'none' });
            }
          }}
        />
      )}

      {(modal.type === 'suspend' || modal.type === 'activate') && (
        <SuspendModal
          user={modal.user}
          action={modal.type}
          loading={actionLoading}
          onClose={() => setModal({ type: 'none' })}
          onSubmit={async (reason) => {
            setActionLoading(true);
            setError(null);
            try {
              const csrfToken = await getCsrfToken();
              const res = await fetch(`/api/v1/admin/users/${modal.user.id}/suspend`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({
                  action: modal.type === 'suspend' ? 'suspend' : 'activate',
                  reason,
                }),
              });
              const data = await res.json();
              if (!data.success) {
                setError(data.error?.message || 'Failed to update user status');
              } else {
                await loadData();
              }
            } catch {
              setError('Failed to update user status');
            } finally {
              setActionLoading(false);
              setModal({ type: 'none' });
            }
          }}
        />
      )}
    </div>
  );
}

function useDialogA11y(onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const prev = document.activeElement as HTMLElement | null;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable[0]?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !dialog) return;
      const elems = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (elems.length === 0) return;
      const first = elems[0];
      const last = elems[elems.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      prev?.focus();
    };
  }, [onClose]);

  return dialogRef;
}

function RoleChangeModal({
  user,
  allRoles,
  loading,
  onClose,
  onSubmit,
}: {
  user: SystemUser;
  allRoles: SystemRole[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (roles: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(user.roles));
  const dialogRef = useDialogA11y(onClose);

  const toggle = (roleName: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(roleName)) next.delete(roleName);
      else next.add(roleName);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-dialog-title"
        className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-md p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="role-dialog-title" className="text-base font-semibold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            Change Roles
          </h2>
          <button onClick={onClose} aria-label="Close dialog" className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Updating roles for <span className="font-medium text-foreground">{user.displayName || user.email || 'Unknown'}</span>
        </p>
        <div className="max-h-64 overflow-y-auto space-y-1 mb-4">
          {allRoles.map(role => (
            <label
              key={role.id}
              className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(role.name)}
                onChange={() => toggle(role.name)}
                className="rounded border-border"
              />
              <div>
                <div className="text-sm font-medium">{role.displayName || role.name}</div>
                <div className="text-xs text-muted-foreground">{role.name}</div>
              </div>
            </label>
          ))}
        </div>
        {selected.size === 0 && (
          <p className="text-xs text-destructive mb-2">At least one role must be selected.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={loading}
            disabled={selected.size === 0 || loading}
            onClick={() => onSubmit(Array.from(selected))}
          >
            Save Roles
          </Button>
        </div>
      </div>
    </div>
  );
}

function SuspendModal({
  user,
  action,
  loading,
  onClose,
  onSubmit,
}: {
  user: SystemUser;
  action: 'suspend' | 'activate';
  loading: boolean;
  onClose: () => void;
  onSubmit: (reason?: string) => void;
}) {
  const [reason, setReason] = useState('');
  const isSuspend = action === 'suspend';
  const dialogRef = useDialogA11y(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="suspend-dialog-title"
        className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-md p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="suspend-dialog-title" className="text-base font-semibold flex items-center gap-2">
            {isSuspend ? <Ban className="w-5 h-5 text-destructive" /> : <Play className="w-5 h-5 text-green-500" />}
            {isSuspend ? 'Suspend User' : 'Activate User'}
          </h2>
          <button onClick={onClose} aria-label="Close dialog" className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          {isSuspend ? (
            <>
              Are you sure you want to suspend{' '}
              <span className="font-medium text-foreground">{user.displayName || user.email || 'this user'}</span>?
              They will be logged out immediately and unable to sign in.
            </>
          ) : (
            <>
              Re-activate{' '}
              <span className="font-medium text-foreground">{user.displayName || user.email || 'this user'}</span>?
              They will be able to sign in again.
            </>
          )}
        </p>
        {isSuspend && (
          <div className="mb-4">
            <label className="text-sm font-medium mb-1 block">Reason (optional)</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Terms of service violation"
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={isSuspend ? 'destructive' : 'primary'}
            size="sm"
            loading={loading}
            disabled={loading}
            onClick={() => onSubmit(isSuspend ? reason || undefined : undefined)}
          >
            {isSuspend ? 'Suspend' : 'Activate'}
          </Button>
        </div>
      </div>
    </div>
  );
}
