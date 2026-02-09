/**
 * PluginAdminPanel Component
 * 
 * Pre-built admin panel for plugin user/role management.
 * Drop-in component - just pass the plugin name.
 */

import { useState } from 'react';
import { usePluginAdmin, type PluginUser } from '../hooks/usePluginAdmin';

interface PluginAdminPanelProps {
  /** Plugin name (e.g., 'gateway-manager') */
  pluginName: string;
  /** Optional title override */
  title?: string;
  /** Optional class name for styling */
  className?: string;
}

/**
 * Pre-built admin panel for managing plugin user access
 * 
 * @example
 * ```tsx
 * import { PluginAdminPanel } from '@naap/plugin-sdk';
 * 
 * function GatewaySettings() {
 *   return <PluginAdminPanel pluginName="gateway-manager" />;
 * }
 * ```
 */
export function PluginAdminPanel({ 
  pluginName, 
  title,
  className = '',
}: PluginAdminPanelProps) {
  const { 
    users, 
    roles, 
    loading, 
    error, 
    assignRole, 
    revokeRole,
    isAssigning,
  } = usePluginAdmin(pluginName);

  const [selectedUser, setSelectedUser] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);

  const handleAssign = async () => {
    if (!selectedUser || !selectedRole) return;
    
    try {
      setActionError(null);
      await assignRole(selectedUser, selectedRole);
      setSelectedUser('');
      setSelectedRole('');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to assign role');
    }
  };

  const handleRevoke = async (userId: string, roleName: string) => {
    try {
      setActionError(null);
      await revokeRole(userId, roleName);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to revoke role');
    }
  };

  // Format role name for display (remove plugin prefix)
  const formatRoleName = (roleName: string) => {
    const prefix = `${pluginName}:`;
    return roleName.startsWith(prefix) 
      ? roleName.slice(prefix.length) 
      : roleName;
  };

  if (loading) {
    return (
      <div className={`p-4 ${className}`}>
        <div className="animate-pulse">
          <div className="h-6 bg-gray-700 rounded w-48 mb-4"></div>
          <div className="h-24 bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-4 ${className}`}>
        <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4">
          <h3 className="text-red-400 font-medium">Error Loading Admin Panel</h3>
          <p className="text-red-300 text-sm mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 ${className}`}>
      <h2 className="text-xl font-bold mb-4">
        {title || 'User Access Management'}
      </h2>

      {/* Action Error */}
      {actionError && (
        <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-3 mb-4">
          <p className="text-red-300 text-sm">{actionError}</p>
        </div>
      )}

      {/* Add User Role Form */}
      <div className="bg-gray-800/50 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Assign Role to User</h3>
        <div className="flex gap-3 flex-wrap">
          <select
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm min-w-[200px]"
          >
            <option value="">Select user...</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>

          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm min-w-[200px]"
          >
            <option value="">Select role...</option>
            {roles.map((role) => (
              <option key={role.name} value={role.name}>
                {formatRoleName(role.name)} - {role.displayName}
              </option>
            ))}
          </select>

          <button
            onClick={handleAssign}
            disabled={!selectedUser || !selectedRole || isAssigning}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-2 rounded text-sm font-medium transition-colors"
          >
            {isAssigning ? 'Assigning...' : 'Assign Role'}
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">User</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Roles</th>
              <th className="text-right py-3 px-4 text-sm font-medium text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-gray-500">
                  No users with roles for this plugin yet.
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  formatRoleName={formatRoleName}
                  onRevoke={handleRevoke}
                  isAssigning={isAssigning}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Available Roles Reference */}
      <div className="mt-6 bg-gray-800/30 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Available Roles</h3>
        <div className="flex flex-wrap gap-2">
          {roles.map((role) => (
            <div
              key={role.name}
              className="bg-gray-700/50 px-3 py-1 rounded-full text-sm"
              title={role.description}
            >
              <span className="text-gray-300">{formatRoleName(role.name)}</span>
              <span className="text-gray-500 ml-1">({role.displayName})</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// User row component
interface UserRowProps {
  user: PluginUser;
  formatRoleName: (name: string) => string;
  onRevoke: (userId: string, roleName: string) => void;
  isAssigning: boolean;
}

function UserRow({ user, formatRoleName, onRevoke, isAssigning }: UserRowProps) {
  return (
    <tr className="border-b border-gray-700/50 hover:bg-gray-800/30">
      <td className="py-3 px-4">
        <span className="font-medium">{user.displayName}</span>
      </td>
      <td className="py-3 px-4">
        <div className="flex flex-wrap gap-1">
          {user.roles.map((role) => (
            <span
              key={role}
              className="inline-flex items-center bg-blue-900/30 text-blue-300 px-2 py-0.5 rounded text-xs"
            >
              {formatRoleName(role)}
            </span>
          ))}
        </div>
      </td>
      <td className="py-3 px-4 text-right">
        <div className="flex justify-end gap-1 flex-wrap">
          {user.roles.map((role) => (
            <button
              key={role}
              onClick={() => onRevoke(user.id, role)}
              disabled={isAssigning}
              className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-900/30 disabled:opacity-50"
            >
              Remove {formatRoleName(role)}
            </button>
          ))}
        </div>
      </td>
    </tr>
  );
}

export default PluginAdminPanel;
