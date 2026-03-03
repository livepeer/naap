'use client';

/**
 * Admin Feedback Management Page
 *
 * Features:
 * - View all feedback with search & filter
 * - Update status (open -> investigating -> roadmap -> released -> closed)
 * - Set release tag, admin note
 * - Configure GitHub issue link + Discord link
 * - Stats overview
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { AdminNav } from '@/components/admin/AdminNav';
import {
  MessageSquare,
  Search,
  Filter,
  Clock,
  Map,
  Rocket,
  XCircle,
  Bug,
  Lightbulb,
  Settings2,
  Save,
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  AlertTriangle,
  Search as SearchIcon,
} from 'lucide-react';
import { Button, Input, Textarea, Label, Modal, Badge, Select } from '@naap/ui';

// -- Types

type FeedbackStatus = 'open' | 'investigating' | 'roadmap' | 'released' | 'closed';

interface FeedbackUser {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface FeedbackItem {
  id: string;
  type: string;
  title: string;
  description: string;
  status: FeedbackStatus;
  releaseTag: string | null;
  adminNote: string | null;
  userEmail: string | null;
  user: FeedbackUser;
  createdAt: string;
  updatedAt: string;
}

interface FeedbackStats {
  total: number;
  open: number;
  investigating: number;
  roadmap: number;
  released: number;
  closed: number;
}

interface FeedbackConfig {
  githubIssueUrl: string;
  discordUrl: string;
}

// -- Helpers

const statusOptions: { value: FeedbackStatus; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string; badgeVariant: 'blue' | 'amber' | 'secondary' | 'emerald' | 'rose' }[] = [
  { value: 'open', label: 'Open', icon: Clock, color: 'text-blue-500 bg-blue-500/10 border-blue-500/30', badgeVariant: 'blue' },
  { value: 'investigating', label: 'Investigating', icon: SearchIcon, color: 'text-amber-500 bg-amber-500/10 border-amber-500/30', badgeVariant: 'amber' },
  { value: 'roadmap', label: 'Roadmap', icon: Map, color: 'text-purple-500 bg-purple-500/10 border-purple-500/30', badgeVariant: 'secondary' },
  { value: 'released', label: 'Released', icon: Rocket, color: 'text-green-500 bg-green-500/10 border-green-500/30', badgeVariant: 'emerald' },
  { value: 'closed', label: 'Closed', icon: XCircle, color: 'text-muted-foreground bg-muted border-border', badgeVariant: 'secondary' },
];

const typeIcons: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  bug: Bug,
  feature: Lightbulb,
  general: MessageSquare,
};

function getStatusOption(status: FeedbackStatus) {
  return statusOptions.find((o) => o.value === status) ?? statusOptions[0];
}

// -- Component

export default function AdminFeedbackPage() {
  const router = useRouter();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('system:admin');

  // Data state
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [stats, setStats] = useState<FeedbackStats>({ total: 0, open: 0, investigating: 0, roadmap: 0, released: 0, closed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 20;

  // Detail modal
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null);
  const [editStatus, setEditStatus] = useState<FeedbackStatus>('open');
  const [editReleaseTag, setEditReleaseTag] = useState('');
  const [editAdminNote, setEditAdminNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Config modal
  const [showConfig, setShowConfig] = useState(false);
  const [configData, setConfigData] = useState<FeedbackConfig>({ githubIssueUrl: '', discordUrl: '' });
  const [savingConfig, setSavingConfig] = useState(false);

  // -- Redirect non-admins

  useEffect(() => {
    if (!isAdmin) {
      router.push('/dashboard');
    }
  }, [isAdmin, router]);

  // -- Load feedback

  const loadFeedbacks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/v1/admin/feedback?${params.toString()}`);
      const data = await res.json();

      if (data.success) {
        setFeedbacks(data.data.feedbacks || []);
        setStats(data.data.stats || stats);
        setTotalPages(data.meta?.totalPages || 1);
      } else {
        setError(data.error?.message || 'Failed to load feedback');
      }
    } catch {
      setError('Failed to load feedback');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, typeFilter, searchQuery]);

  useEffect(() => {
    if (isAdmin) loadFeedbacks();
  }, [isAdmin, loadFeedbacks]);

  // -- Load config

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/feedback/config');
      const data = await res.json();
      if (data.success && data.data.config) {
        setConfigData({
          githubIssueUrl: data.data.config.githubIssueUrl || '',
          discordUrl: data.data.config.discordUrl || '',
        });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadConfig();
  }, [isAdmin, loadConfig]);

  // -- Update feedback

  const openDetail = (fb: FeedbackItem) => {
    setSelectedFeedback(fb);
    setEditStatus(fb.status);
    setEditReleaseTag(fb.releaseTag || '');
    setEditAdminNote(fb.adminNote || '');
  };

  const saveDetail = async () => {
    if (!selectedFeedback) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/feedback/${selectedFeedback.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: editStatus,
          releaseTag: editReleaseTag || null,
          adminNote: editAdminNote || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedFeedback(null);
        loadFeedbacks();
      } else {
        setError(data.error?.message || 'Failed to update feedback');
      }
    } catch {
      setError('Failed to update feedback');
    } finally {
      setSaving(false);
    }
  };

  // -- Save config

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      const res = await fetch('/api/v1/admin/feedback/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configData),
      });
      const data = await res.json();
      if (data.success) {
        setShowConfig(false);
      } else {
        setError(data.error?.message || 'Failed to save config');
      }
    } catch {
      setError('Failed to save config');
    } finally {
      setSavingConfig(false);
    }
  };

  // -- Handle search on Enter

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setPage(1);
      loadFeedbacks();
    }
  };

  if (!isAdmin) return null;

  // -- Render

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <AdminNav />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Feedback Management
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Review, triage, and track all user feedback
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<Settings2 size={16} />}
          onClick={() => setShowConfig(true)}
        >
          Configure Links
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={16} /></button>
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        {statusOptions.map((opt) => {
          const Icon = opt.icon;
          const count = stats[opt.value] ?? 0;
          const isActive = statusFilter === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => { setStatusFilter(isActive ? 'all' : opt.value); setPage(1); }}
              className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
                isActive ? `${opt.color} border-current` : 'border-border bg-card hover:bg-muted/50'
              }`}
            >
              <Icon size={16} className={isActive ? undefined : 'text-muted-foreground'} />
              <span className="text-lg font-bold mt-1">{count}</span>
              <span className="text-xs text-muted-foreground">{opt.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => { setStatusFilter('all'); setPage(1); }}
          className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
            statusFilter === 'all' ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted/50'
          }`}
        >
          <Filter size={16} className={statusFilter === 'all' ? 'text-primary' : 'text-muted-foreground'} />
          <span className="text-lg font-bold mt-1">{stats.total}</span>
          <span className="text-xs text-muted-foreground">All</span>
        </button>
      </div>

      {/* Filters bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            icon={<Search className="w-4 h-4" />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search title, description, or email..."
          />
        </div>
        <Select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
        >
          <option value="all">All Types</option>
          <option value="bug">Bug Reports</option>
          <option value="feature">Feature Requests</option>
          <option value="general">General Feedback</option>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-5 w-5 animate-spin text-muted-foreground border-2 border-current border-t-transparent rounded-full" />
          </div>
        ) : feedbacks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No feedback found</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Type</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Title</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">User</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Release</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {feedbacks.map((fb) => {
                const statusOpt = getStatusOption(fb.status);
                const StatusIcon = statusOpt.icon;
                const TypeIcon = typeIcons[fb.type] || MessageSquare;
                return (
                  <tr
                    key={fb.id}
                    onClick={() => openDetail(fb)}
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <Badge variant={statusOpt.badgeVariant}>
                        <span className="inline-flex items-center gap-1">
                          <StatusIcon size={12} />
                          {statusOpt.label}
                        </span>
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground capitalize">
                        <TypeIcon size={14} />
                        {fb.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-sm truncate max-w-xs block">{fb.title}</span>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">
                      {fb.user?.displayName || fb.userEmail || 'Unknown'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(fb.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 text-sm">
                      {fb.releaseTag ? (
                        <Badge variant="emerald">{fb.releaseTag}</Badge>
                      ) : (
                        <span className="text-muted-foreground/50">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              icon={<ChevronLeft size={16} />}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              icon={<ChevronRight size={16} />}
            />
          </div>
        </div>
      )}

      {/* -- Detail Modal */}
      <Modal
        isOpen={!!selectedFeedback}
        onClose={() => setSelectedFeedback(null)}
        title="Feedback Detail"
        size="xl"
      >
        {selectedFeedback && (
          <div className="space-y-4">
            {/* Title & Type */}
            <div>
              <Badge variant="secondary" className="capitalize">{selectedFeedback.type}</Badge>
              <h4 className="text-base font-semibold mt-2">{selectedFeedback.title}</h4>
            </div>

            {/* Description */}
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm whitespace-pre-wrap">{selectedFeedback.description}</p>
            </div>

            {/* Meta */}
            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span>By: <span className="text-foreground">{selectedFeedback.user?.displayName || selectedFeedback.userEmail || 'Unknown'}</span></span>
              <span>Email: <span className="text-foreground">{selectedFeedback.userEmail || '-'}</span></span>
              <span>Created: <span className="text-foreground">{new Date(selectedFeedback.createdAt).toLocaleString()}</span></span>
            </div>

            {/* Status */}
            <div>
              <Label className="mb-1.5 block">Status</Label>
              <div className="flex flex-wrap gap-2">
                {statusOptions.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setEditStatus(opt.value)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-all ${
                        editStatus === opt.value
                          ? `${opt.color} border-current font-medium`
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      <Icon size={14} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Release Tag */}
            <div>
              <Label className="mb-1.5 block">Release Tag</Label>
              <Input
                type="text"
                value={editReleaseTag}
                onChange={(e) => setEditReleaseTag(e.target.value)}
                placeholder="e.g. v1.2.0"
                className="font-mono"
              />
            </div>

            {/* Admin Note */}
            <div>
              <Label className="mb-1.5 block">Admin Note (internal)</Label>
              <Textarea
                value={editAdminNote}
                onChange={(e) => setEditAdminNote(e.target.value)}
                rows={3}
                placeholder="Internal notes for the team..."
                className="resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="ghost"
                onClick={() => setSelectedFeedback(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={saveDetail}
                loading={saving}
                icon={!saving ? <Save size={16} /> : undefined}
              >
                Save Changes
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* -- Config Modal */}
      <Modal
        isOpen={showConfig}
        onClose={() => setShowConfig(false)}
        title="Feedback Config"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">GitHub Issues URL</Label>
            <div className="flex items-center gap-2">
              <ExternalLink size={16} className="text-muted-foreground shrink-0" />
              <Input
                type="url"
                value={configData.githubIssueUrl}
                onChange={(e) => setConfigData((c) => ({ ...c, githubIssueUrl: e.target.value }))}
                placeholder="https://github.com/org/repo/issues"
                className="flex-1"
              />
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">Discord Invite URL</Label>
            <div className="flex items-center gap-2">
              <ExternalLink size={16} className="text-muted-foreground shrink-0" />
              <Input
                type="url"
                value={configData.discordUrl}
                onChange={(e) => setConfigData((c) => ({ ...c, discordUrl: e.target.value }))}
                placeholder="https://discord.gg/your-server"
                className="flex-1"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="ghost"
              onClick={() => setShowConfig(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={saveConfig}
              loading={savingConfig}
              icon={!savingConfig ? <Save size={16} /> : undefined}
            >
              Save Config
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
