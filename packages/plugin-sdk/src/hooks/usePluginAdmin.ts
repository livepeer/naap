/**
 * usePluginAdmin Hook
 * 
 * Provides plugin admin functionality for managing user roles within a plugin.
 * Simple for plugin developers - just pass the plugin name.
 */

import { useState, useEffect, useCallback } from 'react';

export interface PluginUser {
  id: string;
  displayName: string;
  roles: string[];
}

export interface PluginRole {
  id: string;
  name: string;
  displayName: string;
  description?: string;
}

export interface UsePluginAdminResult {
  /** Users with roles in this plugin */
  users: PluginUser[];
  /** Available roles for this plugin */
  roles: PluginRole[];
  /** Loading state */
  loading: boolean;
  /** Error if any */
  error: Error | null;
  /** Assign a role to a user */
  assignRole: (userId: string, roleName: string) => Promise<void>;
  /** Revoke a role from a user */
  revokeRole: (userId: string, roleName: string) => Promise<void>;
  /** Refresh data */
  refresh: () => Promise<void>;
  /** Check if current operation is in progress */
  isAssigning: boolean;
}

/**
 * Hook for plugin admin functionality
 * 
 * @example
 * ```tsx
 * function PluginSettings() {
 *   const { users, roles, assignRole, revokeRole, loading } = usePluginAdmin('my-plugin');
 *   
 *   if (loading) return <Spinner />;
 *   
 *   return (
 *     <UserList 
 *       users={users} 
 *       roles={roles}
 *       onAssign={assignRole}
 *       onRevoke={revokeRole}
 *     />
 *   );
 * }
 * ```
 */
export function usePluginAdmin(pluginName: string): UsePluginAdminResult {
  const [users, setUsers] = useState<PluginUser[]>([]);
  const [roles, setRoles] = useState<PluginRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [usersRes, rolesRes] = await Promise.all([
        fetch(`/api/v1/plugins/${pluginName}/admin/users`, {
          credentials: 'include',
        }),
        fetch(`/api/v1/plugins/${pluginName}/admin/roles`, {
          credentials: 'include',
        }),
      ]);

      if (!usersRes.ok) {
        const err = await usersRes.json();
        throw new Error(err.error || 'Failed to fetch users');
      }

      if (!rolesRes.ok) {
        const err = await rolesRes.json();
        throw new Error(err.error || 'Failed to fetch roles');
      }

      const usersData = await usersRes.json();
      const rolesData = await rolesRes.json();

      setUsers(usersData);
      setRoles(rolesData);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [pluginName]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const assignRole = useCallback(async (userId: string, roleName: string) => {
    try {
      setIsAssigning(true);
      setError(null);

      const response = await fetch(
        `/api/v1/plugins/${pluginName}/admin/users/${userId}/roles`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ roleName }),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to assign role');
      }

      // Refresh data after successful assignment
      await fetchData();
    } catch (e) {
      setError(e as Error);
      throw e;
    } finally {
      setIsAssigning(false);
    }
  }, [pluginName, fetchData]);

  const revokeRole = useCallback(async (userId: string, roleName: string) => {
    try {
      setIsAssigning(true);
      setError(null);

      const response = await fetch(
        `/api/v1/plugins/${pluginName}/admin/users/${userId}/roles/${encodeURIComponent(roleName)}`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to revoke role');
      }

      // Refresh data after successful revocation
      await fetchData();
    } catch (e) {
      setError(e as Error);
      throw e;
    } finally {
      setIsAssigning(false);
    }
  }, [pluginName, fetchData]);

  return {
    users,
    roles,
    loading,
    error,
    assignRole,
    revokeRole,
    refresh: fetchData,
    isAssigning,
  };
}
