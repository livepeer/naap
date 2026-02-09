'use client';

/**
 * Member Access Modal
 * Allows team owners/admins to manage member access to team plugins.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Save,
  Loader2,
  AlertCircle,
  Crown,
  Shield,
  User,
  Eye,
  CheckSquare,
  Square,
  Users
} from 'lucide-react';

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

interface MemberAccess {
  memberId: string;
  visible: boolean;
  canUse: boolean;
  canConfigure: boolean;
  hasChanges?: boolean;
}

interface MemberAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamId: string;
  pluginInstallId: string;
  pluginName: string;
  onSaved?: () => void;
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

// Helper to batch API calls with concurrency limit
async function batchRequests<T>(
  items: T[],
  handler: (item: T) => Promise<unknown>,
  concurrency = 5
): Promise<PromiseSettledResult<unknown>[]> {
  const results: PromiseSettledResult<unknown>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(handler));
    results.push(...batchResults);
  }
  return results;
}

export function MemberAccessModal({
  isOpen,
  onClose,
  teamId,
  pluginInstallId,
  pluginName,
  onSaved,
}: MemberAccessModalProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [accessMap, setAccessMap] = useState<Map<string, MemberAccess>>(new Map());
  const [originalAccessMap, setOriginalAccessMap] = useState<Map<string, MemberAccess>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if there are any changes
  const hasChanges = Array.from(accessMap.entries()).some(([memberId, access]) => {
    const original = originalAccessMap.get(memberId);
    return (
      !original ||
      original.visible !== access.visible ||
      original.canUse !== access.canUse ||
      original.canConfigure !== access.canConfigure
    );
  });

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        handleClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasChanges]);

  function handleClose() {
    if (hasChanges) {
      if (!window.confirm('You have unsaved changes. Are you sure you want to close?')) {
        return;
      }
    }
    onClose();
  }

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch team members
      const membersRes = await fetch(`/api/v1/teams/${teamId}/members`, {
        credentials: 'include',
      });
      const membersData = await membersRes.json();

      if (!membersRes.ok) {
        setError(membersData.error?.message || 'Failed to load members');
        return;
      }

      const membersList = membersData.data?.members || [];
      setMembers(membersList);

      // Initialize access map with defaults (all permissions true for existing members)
      const newAccessMap = new Map<string, MemberAccess>();

      // Fetch access for each member with concurrency limit to avoid overwhelming the server
      const accessResults: MemberAccess[] = [];

      await batchRequests(
        membersList,
        async (member: TeamMember) => {
          try {
            const accessRes = await fetch(
              `/api/v1/teams/${teamId}/plugins/members/${member.id}/access`,
              { credentials: 'include' }
            );
            const accessData = await accessRes.json();

            // Find access for this specific plugin
            const pluginAccess = accessData.access?.find(
              (a: { pluginInstallId: string }) => a.pluginInstallId === pluginInstallId
            );

            accessResults.push({
              memberId: member.id,
              visible: pluginAccess?.visible ?? true,
              canUse: pluginAccess?.canUse ?? true,
              canConfigure: pluginAccess?.canConfigure ?? false,
            });
          } catch {
            // Default values if fetch fails
            accessResults.push({
              memberId: member.id,
              visible: true,
              canUse: true,
              canConfigure: false,
            });
          }
        },
        5 // Process 5 members at a time
      );

      accessResults.forEach((access) => {
        newAccessMap.set(access.memberId, access);
      });

      setAccessMap(newAccessMap);
      // Deep clone for original
      setOriginalAccessMap(new Map(Array.from(newAccessMap.entries()).map(
        ([k, v]) => [k, { ...v }]
      )));
    } catch (err) {
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [teamId, pluginInstallId]);

  useEffect(() => {
    if (isOpen && pluginInstallId) {
      loadData();
    }
  }, [isOpen, pluginInstallId, loadData]);

  function updateAccess(
    memberId: string,
    field: 'visible' | 'canUse' | 'canConfigure',
    value: boolean
  ) {
    setAccessMap((prev) => {
      const newMap = new Map(prev);
      const current = newMap.get(memberId);
      if (current) {
        newMap.set(memberId, { ...current, [field]: value });
      }
      return newMap;
    });
  }

  function selectAll(field: 'visible' | 'canUse') {
    setAccessMap((prev) => {
      const newMap = new Map(prev);
      newMap.forEach((access, memberId) => {
        newMap.set(memberId, { ...access, [field]: true });
      });
      return newMap;
    });
  }

  function deselectAll(field: 'visible' | 'canUse') {
    setAccessMap((prev) => {
      const newMap = new Map(prev);
      newMap.forEach((access, memberId) => {
        newMap.set(memberId, { ...access, [field]: false });
      });
      return newMap;
    });
  }

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);

      // Find members with changes and save them
      const savePromises: Promise<Response>[] = [];

      accessMap.forEach((access, memberId) => {
        const original = originalAccessMap.get(memberId);
        const hasChanges =
          !original ||
          original.visible !== access.visible ||
          original.canUse !== access.canUse ||
          original.canConfigure !== access.canConfigure;

        if (hasChanges) {
          savePromises.push(
            fetch(
              `/api/v1/teams/${teamId}/plugins/members/${memberId}/access/${pluginInstallId}`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  visible: access.visible,
                  canUse: access.canUse,
                  canConfigure: access.canConfigure,
                }),
              }
            )
          );
        }
      });

      if (savePromises.length > 0) {
        const results = await Promise.all(savePromises);
        const failed = results.filter((r) => !r.ok);

        if (failed.length > 0) {
          setError(`Failed to update ${failed.length} member(s)`);
          return;
        }
      }

      // Update original map to reflect saved state
      setOriginalAccessMap(new Map(Array.from(accessMap.entries()).map(
        ([k, v]) => [k, { ...v }]
      )));

      onSaved?.();
      onClose();
    } catch {
      setError('Failed to save access settings');
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl max-h-[80vh] flex flex-col bg-card border border-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Users className="w-5 h-5" />
              Member Access: {pluginName}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Control which members can see and use this plugin
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : error && members.length === 0 ? (
            <div className="flex items-center gap-3 p-4 bg-destructive/10 text-destructive rounded-lg">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <>
              {/* Bulk actions */}
              <div className="flex items-center gap-4 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Visible:</span>
                  <button
                    onClick={() => selectAll('visible')}
                    className="text-xs px-2 py-1 border border-border rounded hover:bg-muted transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => deselectAll('visible')}
                    className="text-xs px-2 py-1 border border-border rounded hover:bg-muted transition-colors"
                  >
                    Deselect All
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Can Use:</span>
                  <button
                    onClick={() => selectAll('canUse')}
                    className="text-xs px-2 py-1 border border-border rounded hover:bg-muted transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => deselectAll('canUse')}
                    className="text-xs px-2 py-1 border border-border rounded hover:bg-muted transition-colors"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {/* Table header */}
              <div className="grid grid-cols-[1fr,auto,auto,auto] gap-4 px-4 py-2 bg-muted/50 rounded-t-lg text-sm font-medium text-muted-foreground">
                <div>Member</div>
                <div className="text-center w-20">Visible</div>
                <div className="text-center w-20">Can Use</div>
                <div className="text-center w-20">Configure</div>
              </div>

              {/* Member list */}
              <div className="border border-border rounded-b-lg divide-y divide-border">
                {members.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    No team members found
                  </div>
                ) : (
                  members.map((member) => {
                    const access = accessMap.get(member.id) || {
                      memberId: member.id,
                      visible: true,
                      canUse: true,
                      canConfigure: false,
                    };

                    return (
                      <div
                        key={member.id}
                        className="grid grid-cols-[1fr,auto,auto,auto] gap-4 px-4 py-3 items-center hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            {member.user.avatarUrl ? (
                              <img
                                src={member.user.avatarUrl}
                                alt=""
                                className="w-8 h-8 rounded-full"
                              />
                            ) : (
                              <User className="w-4 h-4 text-primary" />
                            )}
                          </div>
                          <div>
                            <div className="font-medium">
                              {member.user.displayName || member.user.email}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              {ROLE_ICONS[member.role]}
                              <span>{ROLE_LABELS[member.role] || member.role}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-center w-20">
                          <button
                            onClick={() =>
                              updateAccess(member.id, 'visible', !access.visible)
                            }
                            className="p-1 rounded hover:bg-muted transition-colors"
                          >
                            {access.visible ? (
                              <CheckSquare className="w-5 h-5 text-primary" />
                            ) : (
                              <Square className="w-5 h-5 text-muted-foreground" />
                            )}
                          </button>
                        </div>

                        <div className="flex justify-center w-20">
                          <button
                            onClick={() =>
                              updateAccess(member.id, 'canUse', !access.canUse)
                            }
                            className="p-1 rounded hover:bg-muted transition-colors"
                          >
                            {access.canUse ? (
                              <CheckSquare className="w-5 h-5 text-primary" />
                            ) : (
                              <Square className="w-5 h-5 text-muted-foreground" />
                            )}
                          </button>
                        </div>

                        <div className="flex justify-center w-20">
                          <button
                            onClick={() =>
                              updateAccess(
                                member.id,
                                'canConfigure',
                                !access.canConfigure
                              )
                            }
                            className="p-1 rounded hover:bg-muted transition-colors"
                          >
                            {access.canConfigure ? (
                              <CheckSquare className="w-5 h-5 text-primary" />
                            ) : (
                              <Square className="w-5 h-5 text-muted-foreground" />
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {error && members.length > 0 && (
                <div className="mt-4 flex items-center gap-3 p-4 bg-destructive/10 text-destructive rounded-lg">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <p className="mt-4 text-xs text-muted-foreground">
                <strong>Visible:</strong> Member can see the plugin in their sidebar.{' '}
                <strong>Can Use:</strong> Member can interact with the plugin.{' '}
                <strong>Configure:</strong> Member can modify their personal settings.
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Access
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
