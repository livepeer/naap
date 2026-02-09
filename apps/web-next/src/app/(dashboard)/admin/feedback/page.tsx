'use client';

/**
 * Admin Feedback Management Page
 *
 * Features:
 * - View all feedback with search & filter
 * - Update status (open → investigating → roadmap → released → closed)
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
  Loader2,
  AlertTriangle,
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
  Search as SearchIcon,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

const statusOptions: { value: FeedbackStatus; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string }[] = [
  { value: 'open', label: 'Open', icon: Clock, color: 'text-blue-500 bg-blue-500/10 border-blue-500/30' },
  { value: 'investigating', label: 'Investigating', icon: SearchIcon, color: 'text-amber-500 bg-amber-500/10 border-amber-500/30' },
  { value: 'roadmap', label: 'Roadmap', icon: Map, color: 'text-purple-500 bg-purple-500/10 border-purple-500/30' },
  { value: 'released', label: 'Released', icon: Rocket, color: 'text-green-500 bg-green-500/10 border-green-500/30' },
  { value: 'closed', label: 'Closed', icon: XCircle, color: 'text-muted-foreground bg-muted border-border' },
];

const typeIcons: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  bug: Bug,
  feature: Lightbulb,
  general: MessageSquare,
};

function getStatusOption(status: FeedbackStatus) {
  return statusOptions.find((o) => o.value === status) ?? statusOptions[0];
}

// ── Component ────────────────────────────────────────────────────────────────

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

  // ── Redirect non-admins ──────────────────────────────────────────

  useEffect(() => {
    if (!isAdmin) {
      router.push('/dashboard');
    }
  }, [isAdmin, router]);

  // ── Load feedback ────────────────────────────────────────────────

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

  // ── Load config ──────────────────────────────────────────────────

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

  // ── Update feedback ──────────────────────────────────────────────

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

  // ── Save config ──────────────────────────────────────────────────

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

  // ── Handle search on Enter ───────────────────────────────────────

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setPage(1);
      loadFeedbacks();
    }
  };

  if (!isAdmin) return null;

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <AdminNav />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="w-6 h-6" />
            Feedback Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Review, triage, and track all user feedback
          </p>
        </div>
        <button
          onClick={() => setShowConfig(true)}
          className="flex items-center gap-2 px-4 py-2 bg-muted rounded-lg hover:bg-muted/80 transition-all text-sm"
        >
          <Settings2 size={16} />
          Configure Links
        </button>
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
              className={`flex flex-col items-center p-3 rounded-xl border transition-all ${
                isActive ? `${opt.color} border-current` : 'border-border bg-card hover:bg-muted/50'
              }`}
            >
              <Icon size={16} className={isActive ? undefined : 'text-muted-foreground'} />
              <span className="text-xl font-bold mt-1">{count}</span>
              <span className="text-xs text-muted-foreground">{opt.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => { setStatusFilter('all'); setPage(1); }}
          className={`flex flex-col items-center p-3 rounded-xl border transition-all ${
            statusFilter === 'all' ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted/50'
          }`}
        >
          <Filter size={16} className={statusFilter === 'all' ? 'text-primary' : 'text-muted-foreground'} />
          <span className="text-xl font-bold mt-1">{stats.total}</span>
          <span className="text-xs text-muted-foreground">All</span>
        </button>
      </div>

      {/* Filters bar */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search title, description, or email..."
            className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="all">All Types</option>
          <option value="bug">Bug Reports</option>
          <option value="feature">Feature Requests</option>
          <option value="general">General Feedback</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : feedbacks.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No feedback found</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Title</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Release</th>
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
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusOpt.color}`}>
                        <StatusIcon size={12} />
                        {statusOpt.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground capitalize">
                        <TypeIcon size={14} />
                        {fb.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-sm truncate max-w-xs block">{fb.title}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {fb.user?.displayName || fb.userEmail || 'Unknown'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(fb.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {fb.releaseTag ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-green-500/10 text-green-500">{fb.releaseTag}</span>
                      ) : (
                        <span className="text-muted-foreground/50">–</span>
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
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 border border-border rounded-lg text-sm disabled:opacity-50 hover:bg-muted transition-all"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 border border-border rounded-lg text-sm disabled:opacity-50 hover:bg-muted transition-all"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── Detail Modal ──────────────────────────────────────────────── */}
      {selectedFeedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setSelectedFeedback(null)}>
          <div
            className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-lg font-bold">Feedback Detail</h3>
              <button onClick={() => setSelectedFeedback(null)} className="p-1 hover:bg-muted rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Title & Type */}
              <div>
                <span className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground capitalize">{selectedFeedback.type}</span>
                <h4 className="text-xl font-semibold mt-2">{selectedFeedback.title}</h4>
              </div>

              {/* Description */}
              <div className="p-4 bg-muted/50 rounded-xl">
                <p className="text-sm whitespace-pre-wrap">{selectedFeedback.description}</p>
              </div>

              {/* Meta */}
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span>By: <span className="text-foreground">{selectedFeedback.user?.displayName || selectedFeedback.userEmail || 'Unknown'}</span></span>
                <span>Email: <span className="text-foreground">{selectedFeedback.userEmail || '–'}</span></span>
                <span>Created: <span className="text-foreground">{new Date(selectedFeedback.createdAt).toLocaleString()}</span></span>
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium mb-2">Status</label>
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
                <label className="block text-sm font-medium mb-2">Release Tag</label>
                <input
                  type="text"
                  value={editReleaseTag}
                  onChange={(e) => setEditReleaseTag(e.target.value)}
                  placeholder="e.g. v1.2.0"
                  className="w-full bg-background border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              {/* Admin Note */}
              <div>
                <label className="block text-sm font-medium mb-2">Admin Note (internal)</label>
                <textarea
                  value={editAdminNote}
                  onChange={(e) => setEditAdminNote(e.target.value)}
                  rows={3}
                  placeholder="Internal notes for the team..."
                  className="w-full bg-background border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
              <button
                onClick={() => setSelectedFeedback(null)}
                className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-all"
              >
                Cancel
              </button>
              <button
                onClick={saveDetail}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Config Modal ──────────────────────────────────────────────── */}
      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowConfig(false)}>
          <div
            className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-lg mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Settings2 size={18} />
                Feedback Config
              </h3>
              <button onClick={() => setShowConfig(false)} className="p-1 hover:bg-muted rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div>
                <label className="block text-sm font-medium mb-2">GitHub Issues URL</label>
                <div className="flex items-center gap-2">
                  <ExternalLink size={16} className="text-muted-foreground shrink-0" />
                  <input
                    type="url"
                    value={configData.githubIssueUrl}
                    onChange={(e) => setConfigData((c) => ({ ...c, githubIssueUrl: e.target.value }))}
                    placeholder="https://github.com/org/repo/issues"
                    className="flex-1 bg-background border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Discord Invite URL</label>
                <div className="flex items-center gap-2">
                  <ExternalLink size={16} className="text-muted-foreground shrink-0" />
                  <input
                    type="url"
                    value={configData.discordUrl}
                    onChange={(e) => setConfigData((c) => ({ ...c, discordUrl: e.target.value }))}
                    placeholder="https://discord.gg/your-server"
                    className="flex-1 bg-background border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
              <button
                onClick={() => setShowConfig(false)}
                className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-all"
              >
                Cancel
              </button>
              <button
                onClick={saveConfig}
                disabled={savingConfig}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
              >
                {savingConfig ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save Config
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
