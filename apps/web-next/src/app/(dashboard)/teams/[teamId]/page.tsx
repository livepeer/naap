'use client';

/**
 * Team Dashboard Page
 * Overview of a team with plugins and quick actions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Users,
  Settings,
  Package,
  Plus,
  ArrowLeft,
  Crown,
  Shield,
  User,
  Eye,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Loader2,
  Settings2,
  UserCog,
  AlertCircle,
  X,
  User2
} from 'lucide-react';
import { PluginConfigModal } from '@/components/teams/plugin-config-modal';
import { MemberAccessModal } from '@/components/teams/member-access-modal';
import { PersonalConfigModal } from '@/components/teams/personal-config-modal';

interface Team {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  membership?: { role: string };
}

interface TeamPluginInstall {
  id: string;
  enabled: boolean;
  displayName: string;
  version: string;
  deployment?: {
    package: { displayName: string };
    version: { version: string };
  };
}

interface SelectedPlugin {
  id: string;
  name: string;
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

export default function TeamDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const teamId = params.teamId as string;
  const [team, setTeam] = useState<Team | null>(null);
  const [plugins, setPlugins] = useState<TeamPluginInstall[]>([]);
  const [myRole, setMyRole] = useState<string>('member');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Modal states
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [personalConfigModalOpen, setPersonalConfigModalOpen] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<SelectedPlugin | null>(null);

  const canManagePlugins = myRole === 'owner' || myRole === 'admin';
  const canInstallPlugins = myRole === 'owner';

  // Clear action errors after 5 seconds
  useEffect(() => {
    if (!actionError) return;

    const timer = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(timer);
  }, [actionError]);

  function openConfigModal(plugin: TeamPluginInstall) {
    const name = plugin.displayName || plugin.deployment?.package?.displayName || 'Plugin';
    setSelectedPlugin({ id: plugin.id, name });
    setConfigModalOpen(true);
  }

  function openAccessModal(plugin: TeamPluginInstall) {
    const name = plugin.displayName || plugin.deployment?.package?.displayName || 'Plugin';
    setSelectedPlugin({ id: plugin.id, name });
    setAccessModalOpen(true);
  }

  function openPersonalConfigModal(plugin: TeamPluginInstall) {
    const name = plugin.displayName || plugin.deployment?.package?.displayName || 'Plugin';
    setSelectedPlugin({ id: plugin.id, name });
    setPersonalConfigModalOpen(true);
  }

  function closeModals() {
    setConfigModalOpen(false);
    setAccessModalOpen(false);
    setPersonalConfigModalOpen(false);
    setSelectedPlugin(null);
  }

  const loadTeamData = useCallback(async () => {
    try {
      setLoading(true);
      const [teamRes, pluginsRes] = await Promise.all([
        fetch(`/api/v1/teams/${teamId}`, { credentials: 'include' }),
        fetch(`/api/v1/teams/${teamId}/plugins`, { credentials: 'include' }),
      ]);

      const teamData = await teamRes.json();
      const pluginsData = await pluginsRes.json();

      if (teamData.success) {
        setTeam(teamData.data.team);
        // membership is at data level, not inside team
        setMyRole(teamData.data.membership?.role || teamData.data.team.membership?.role || 'member');
      } else {
        setError(teamData.error?.message || 'Failed to load team');
      }

      if (pluginsData.success) {
        const pluginsList = pluginsData.data?.plugins || [];
        setPlugins(pluginsList);
      } else if (pluginsData.plugins) {
        // Fallback for legacy direct response format
        setPlugins(pluginsData.plugins || []);
      }
    } catch {
      setError('Failed to load team');
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (teamId) {
      loadTeamData();
    }
  }, [teamId, loadTeamData]);

  async function handleTogglePlugin(installId: string, enabled: boolean) {
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/teams/${teamId}/plugins/${installId}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || `Failed to ${enabled ? 'enable' : 'disable'} plugin`);
      }

      setPlugins(prev =>
        prev.map(p => p.id === installId ? { ...p, enabled } : p)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle plugin';
      setActionError(message);
    }
  }

  async function handleUninstallPlugin(installId: string) {
    if (!window.confirm('Are you sure you want to uninstall this plugin? This action cannot be undone.')) {
      return;
    }

    setActionError(null);
    try {
      const res = await fetch(`/api/v1/teams/${teamId}/plugins/${installId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || 'Failed to uninstall plugin');
      }

      setPlugins(prev => prev.filter(p => p.id !== installId));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to uninstall plugin';
      setActionError(message);
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
        onClick={() => router.push('/teams')}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Teams
      </button>

      {/* Team Header */}
      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center">
              {team.avatarUrl ? (
                <img src={team.avatarUrl} alt={team.name} className="w-16 h-16 rounded-xl" />
              ) : (
                <Users className="w-8 h-8 text-primary" />
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold">{team.name}</h1>
              <p className="text-muted-foreground">{team.description || 'No description'}</p>
              <div className="flex items-center gap-2 mt-2">
                {ROLE_ICONS[myRole]}
                <span className="text-sm text-muted-foreground">{ROLE_LABELS[myRole]}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push(`/teams/${teamId}/members`)}
              className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
            >
              <Users className="w-4 h-4" />
              Members
            </button>
            {(myRole === 'owner' || myRole === 'admin') && (
              <button
                onClick={() => router.push(`/teams/${teamId}/settings`)}
                className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Team Plugins */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Package className="w-5 h-5" />
            Installed Plugins
          </h2>
          {canInstallPlugins && (
            <button
              onClick={() => router.push(`/marketplace?teamId=${teamId}&teamName=${encodeURIComponent(team.name)}`)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Plugin
            </button>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Manage plugins available to this team. When members switch to this team workspace,
          they will only see enabled plugins installed here.
        </p>

        {actionError && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{actionError}</span>
            <button
              onClick={() => setActionError(null)}
              className="ml-auto p-1 hover:bg-destructive/20 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {plugins.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No plugins installed yet</p>
            {canInstallPlugins && (
              <button
                onClick={() => router.push(`/marketplace?teamId=${teamId}&teamName=${encodeURIComponent(team.name)}`)}
                className="mt-3 text-primary hover:underline"
              >
                Browse Marketplace
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {plugins.map(plugin => {
              const pluginName = plugin.displayName || plugin.deployment?.package?.displayName || 'Plugin';
              const pluginVersion = plugin.version || plugin.deployment?.version?.version || '1.0.0';

              return (
                <div
                  key={plugin.id}
                  className="flex items-center justify-between p-4 bg-muted/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Package className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-medium">{pluginName}</h3>
                      <p className="text-sm text-muted-foreground">
                        v{pluginVersion}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Personal Settings - available to all members */}
                    <button
                      onClick={() => openPersonalConfigModal(plugin)}
                      className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                      title="My Settings (personal overrides)"
                    >
                      <User2 className="w-4 h-4" />
                    </button>
                    {canManagePlugins && (
                      <>
                        <button
                          onClick={() => handleTogglePlugin(plugin.id, !plugin.enabled)}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${
                            plugin.enabled
                              ? 'bg-green-500/10 text-green-500'
                              : 'bg-muted text-muted-foreground'
                          }`}
                          title={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
                        >
                          {plugin.enabled ? (
                            <>
                              <ToggleRight className="w-4 h-4" />
                              Enabled
                            </>
                          ) : (
                            <>
                              <ToggleLeft className="w-4 h-4" />
                              Disabled
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => openConfigModal(plugin)}
                          className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                          title="Configure plugin (team settings)"
                        >
                          <Settings2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openAccessModal(plugin)}
                          className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                          title="Manage member access"
                        >
                          <UserCog className="w-4 h-4" />
                        </button>
                        {myRole === 'owner' && (
                          <button
                            onClick={() => handleUninstallPlugin(plugin.id)}
                            className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            title="Uninstall plugin"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Plugin Configuration Modal */}
      {selectedPlugin && (
        <PluginConfigModal
          isOpen={configModalOpen}
          onClose={closeModals}
          teamId={teamId}
          pluginInstallId={selectedPlugin.id}
          pluginName={selectedPlugin.name}
          onSaved={loadTeamData}
        />
      )}

      {/* Member Access Modal */}
      {selectedPlugin && (
        <MemberAccessModal
          isOpen={accessModalOpen}
          onClose={closeModals}
          teamId={teamId}
          pluginInstallId={selectedPlugin.id}
          pluginName={selectedPlugin.name}
          onSaved={loadTeamData}
        />
      )}

      {/* Personal Config Modal */}
      {selectedPlugin && (
        <PersonalConfigModal
          isOpen={personalConfigModalOpen}
          onClose={closeModals}
          teamId={teamId}
          pluginInstallId={selectedPlugin.id}
          pluginName={selectedPlugin.name}
          onSaved={loadTeamData}
        />
      )}
    </div>
  );
}
