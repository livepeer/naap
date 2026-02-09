'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useShell } from '@/contexts/shell-context';
import {
  MessageSquare,
  Send,
  Bug,
  Lightbulb,
  ThumbsUp,
  Loader2,
  ExternalLink,
  Clock,
  Search as SearchIcon,
  Map,
  Rocket,
  XCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

type FeedbackType = 'bug' | 'feature' | 'general';
type FeedbackStatus = 'open' | 'investigating' | 'roadmap' | 'released' | 'closed';

interface FeedbackItem {
  id: string;
  type: FeedbackType;
  title: string;
  description: string;
  status: FeedbackStatus;
  releaseTag: string | null;
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

const statusConfig: Record<FeedbackStatus, { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string }> = {
  open: { label: 'Open', icon: Clock, color: 'text-blue-500 bg-blue-500/10' },
  investigating: { label: 'Investigating', icon: SearchIcon, color: 'text-amber-500 bg-amber-500/10' },
  roadmap: { label: 'On Roadmap', icon: Map, color: 'text-purple-500 bg-purple-500/10' },
  released: { label: 'Released', icon: Rocket, color: 'text-green-500 bg-green-500/10' },
  closed: { label: 'Closed', icon: XCircle, color: 'text-muted-foreground bg-muted' },
};

const feedbackTypeConfig = [
  { id: 'bug' as const, icon: Bug, label: 'Bug Report', desc: 'Report an issue or problem' },
  { id: 'feature' as const, icon: Lightbulb, label: 'Feature Request', desc: 'Suggest a new feature' },
  { id: 'general' as const, icon: MessageSquare, label: 'General Feedback', desc: 'Share your thoughts' },
];

export default function FeedbackPage() {
  const { user, isAuthenticated } = useAuth();
  const { notifications } = useShell();

  const [feedbackType, setFeedbackType] = useState<FeedbackType>('general');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [stats, setStats] = useState<FeedbackStats>({ total: 0, open: 0, investigating: 0, roadmap: 0, released: 0, closed: 0 });
  const [config, setConfig] = useState<FeedbackConfig>({ githubIssueUrl: '', discordUrl: '' });
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(true);

  const loadFeedbacks = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/feedback');
      const data = await res.json();
      if (data.success) {
        setFeedbacks(data.data.feedbacks || []);
        setStats(data.data.stats || stats);
        if (data.data.config) setConfig(data.data.config);
      }
    } catch {
      // silently fail, data will show empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeedbacks();
  }, [loadFeedbacks]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      notifications.error('Please fill in all required fields');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: feedbackType,
          title: title.trim(),
          description: description.trim(),
        }),
      });

      if (res.ok) {
        setSubmitted(true);
        notifications.success('Thank you for your feedback!');
        setTitle('');
        setDescription('');
        // Refresh list
        loadFeedbacks();
      } else {
        notifications.error('Failed to submit feedback. Please try again.');
      }
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      notifications.error('Failed to submit feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Stats summary cards ───────────────────────────────────────────

  const statCards = [
    { label: 'Total', value: stats.total, color: 'text-foreground bg-muted' },
    { label: 'Open', value: stats.open, color: statusConfig.open.color },
    { label: 'Investigating', value: stats.investigating, color: statusConfig.investigating.color },
    { label: 'Roadmap', value: stats.roadmap, color: statusConfig.roadmap.color },
    { label: 'Released', value: stats.released, color: statusConfig.released.color },
    { label: 'Closed', value: stats.closed, color: statusConfig.closed.color },
  ];

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Feedback</h1>
        <p className="text-muted-foreground mt-1">
          Help us improve NaaP by sharing your thoughts
        </p>
      </div>

      {/* External Links */}
      {(config.githubIssueUrl || config.discordUrl) && (
        <div className="flex flex-wrap gap-4">
          {config.githubIssueUrl && (
            <a
              href={config.githubIssueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-muted rounded-lg hover:bg-muted/80 transition-all text-sm"
            >
              <ExternalLink size={16} />
              View GitHub Issues
            </a>
          )}
          {config.discordUrl && (
            <a
              href={config.discordUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-muted rounded-lg hover:bg-muted/80 transition-all text-sm"
            >
              <ExternalLink size={16} />
              Join Discord
            </a>
          )}
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="flex flex-col items-center p-3 rounded-xl border border-border bg-card"
          >
            <span className={`text-2xl font-bold ${card.color.split(' ')[0]}`}>
              {loading ? '–' : card.value}
            </span>
            <span className="text-xs text-muted-foreground mt-1">{card.label}</span>
          </div>
        ))}
      </div>

      {/* Submit Form */}
      {submitted ? (
        <div className="text-center py-12 px-6 bg-card border border-border rounded-xl">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center">
            <ThumbsUp size={32} className="text-primary" />
          </div>
          <h2 className="text-xl font-bold mb-2">Thank You!</h2>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Your feedback has been submitted. We appreciate you helping us improve.
          </p>
          <button
            onClick={() => setSubmitted(false)}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold hover:bg-primary/90 transition-all"
          >
            Submit Another
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-6 space-y-6">
          {/* Feedback Type */}
          <div>
            <label className="block text-sm font-medium mb-3">Feedback Type</label>
            <div className="grid grid-cols-3 gap-3">
              {feedbackTypeConfig.map((type) => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setFeedbackType(type.id)}
                    className={`p-4 rounded-xl border transition-all text-left ${
                      feedbackType === type.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-muted/50 hover:border-muted-foreground/30'
                    }`}
                  >
                    <Icon size={24} className={feedbackType === type.id ? 'text-primary' : 'text-muted-foreground'} />
                    <p className="font-medium mt-2 text-sm">{type.label}</p>
                    <p className="text-xs text-muted-foreground mt-1">{type.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-2">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief summary of your feedback"
              className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-2">Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                feedbackType === 'bug'
                  ? 'Please describe the bug, steps to reproduce, expected vs actual behavior...'
                  : feedbackType === 'feature'
                  ? 'Describe the feature you would like to see and how it would help you...'
                  : 'Share your thoughts, suggestions, or general feedback...'
              }
              rows={6}
              className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors resize-none"
              required
            />
          </div>

          {/* User Info */}
          {isAuthenticated && user?.email && (
            <div className="p-4 bg-muted/50 rounded-xl">
              <p className="text-sm text-muted-foreground">
                Submitting as: <span className="text-foreground font-medium">{user.email}</span>
              </p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !title.trim() || !description.trim()}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-primary text-primary-foreground rounded-xl font-bold hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send size={20} />
                Submit Feedback
              </>
            )}
          </button>
        </form>
      )}

      {/* Feedback History */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/30 transition-all"
        >
          <h2 className="text-lg font-semibold">Your Feedback History</h2>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            {stats.total} item{stats.total !== 1 ? 's' : ''}
            {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </button>

        {showHistory && (
          <div className="border-t border-border">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : feedbacks.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p>No feedback submitted yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {feedbacks.map((fb) => {
                  const statusCfg = statusConfig[fb.status] || statusConfig.open;
                  const StatusIcon = statusCfg.icon;
                  return (
                    <div key={fb.id} className="px-6 py-4 hover:bg-muted/20 transition-all">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>
                              <StatusIcon size={12} />
                              {statusCfg.label}
                              {fb.status === 'released' && fb.releaseTag && (
                                <span className="ml-1">{fb.releaseTag}</span>
                              )}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground capitalize">
                              {fb.type}
                            </span>
                          </div>
                          <h3 className="font-medium truncate">{fb.title}</h3>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{fb.description}</p>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(fb.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
