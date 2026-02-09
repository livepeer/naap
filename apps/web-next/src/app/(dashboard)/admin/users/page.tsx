'use client';

/**
 * Admin User Management Page
 * View and manage all users in the system.
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Search,
  Shield,
  User,
  Crown,
  MoreVertical,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Mail,
  Calendar
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { AdminNav } from '@/components/admin/AdminNav';

interface SystemUser {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  walletAddress: string | null;
  roles: string[];
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  _count?: { teamMemberships: number };
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { hasRole } = useAuth();
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('all');

  const isAdmin = hasRole('system:admin');

  useEffect(() => {
    if (!isAdmin) {
      router.push('/dashboard');
      return;
    }
    loadUsers();
  }, [isAdmin]);

  async function loadUsers() {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/admin/users');
      const data = await res.json();
      if (data.success) {
        setUsers(data.data.users || []);
      } else {
        setError(data.error?.message || 'Failed to load users');
      }
    } catch (err) {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      !searchQuery ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.walletAddress?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesRole = 
      selectedRole === 'all' ||
      user.roles.some(r => r.includes(selectedRole));

    return matchesSearch && matchesRole;
  });

  const getRoleIcon = (roles: string[]) => {
    if (roles.includes('system:admin')) return <Crown className="w-4 h-4 text-yellow-500" />;
    if (roles.some(r => r.includes(':admin'))) return <Shield className="w-4 h-4 text-blue-500" />;
    return <User className="w-4 h-4 text-gray-500" />;
  };

  const getRoleBadges = (roles: string[]) => {
    return roles.slice(0, 3).map(role => (
      <span 
        key={role}
        className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary"
      >
        {role.replace('system:', '').replace(':admin', ' Admin')}
      </span>
    ));
  };

  if (!isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <AdminNav />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6" />
            User Management
          </h1>
          <p className="text-muted-foreground mt-1">
            View and manage all users in the system
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          {users.length} total users
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg mb-6 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by email, name, or wallet..."
            className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <select
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value)}
          className="px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="all">All Roles</option>
          <option value="system:admin">System Admin</option>
          <option value=":admin">Plugin Admin</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Roles
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Joined
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Teams
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No users found</p>
                </td>
              </tr>
            ) : (
              filteredUsers.map(user => (
                <tr key={user.id} className="hover:bg-muted/30">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        {user.avatarUrl ? (
                          <img src={user.avatarUrl} alt="" className="w-10 h-10 rounded-full" />
                        ) : (
                          getRoleIcon(user.roles)
                        )}
                      </div>
                      <div>
                        <div className="font-medium">
                          {user.displayName || 'No Name'}
                        </div>
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
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {getRoleBadges(user.roles)}
                      {user.roles.length > 3 && (
                        <span className="px-2 py-0.5 text-xs text-muted-foreground">
                          +{user.roles.length - 3} more
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {user.emailVerified ? (
                      <span className="flex items-center gap-1 text-green-500 text-sm">
                        <CheckCircle2 className="w-4 h-4" />
                        Verified
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-muted-foreground text-sm">
                        <XCircle className="w-4 h-4" />
                        Unverified
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(user.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {user._count?.teamMemberships || 0}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="p-2 hover:bg-muted rounded-lg transition-colors">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
