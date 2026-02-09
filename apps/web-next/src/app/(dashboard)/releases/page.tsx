'use client';

import React, { useState, useEffect } from 'react';
import { History, Tag, Calendar, GitBranch, ExternalLink, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

interface Release {
  id: string;
  version: string;
  name: string;
  description: string;
  releaseDate: string;
  type: 'major' | 'minor' | 'patch';
  changelog: string[];
  breaking?: string[];
  deprecated?: string[];
}

export default function ReleasesPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRelease, setExpandedRelease] = useState<string | null>(null);

  useEffect(() => {
    loadReleases();
  }, []);

  const loadReleases = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/releases');
      if (res.ok) {
        const data = await res.json();
        setReleases(data.data?.releases || data.releases || getMockReleases());
      } else {
        setReleases(getMockReleases());
      }
    } catch (error) {
      console.error('Failed to load releases:', error);
      setReleases(getMockReleases());
    } finally {
      setLoading(false);
    }
  };

  const getMockReleases = (): Release[] => [
    {
      id: '1',
      version: '2.5.0',
      name: 'Enhanced Plugin System',
      description: 'Major improvements to the plugin architecture with better performance and new APIs.',
      releaseDate: '2026-02-01',
      type: 'minor',
      changelog: [
        'New plugin management UI in Settings',
        'Improved plugin loading performance',
        'Added plugin configuration support',
        'Enhanced team plugin management',
        'New marketplace filtering options',
      ],
    },
    {
      id: '2',
      version: '2.4.0',
      name: 'Team Workspaces',
      description: 'Introducing team workspaces for better collaboration and organization.',
      releaseDate: '2026-01-15',
      type: 'minor',
      changelog: [
        'Team workspace switcher',
        'Team-specific plugin installations',
        'Role-based access control for teams',
        'Team settings and configuration',
        'Improved member management',
      ],
    },
    {
      id: '3',
      version: '2.3.2',
      name: 'Bug Fixes',
      description: 'Various bug fixes and stability improvements.',
      releaseDate: '2026-01-10',
      type: 'patch',
      changelog: [
        'Fixed sidebar navigation issues',
        'Resolved authentication edge cases',
        'Improved error handling',
        'Performance optimizations',
      ],
    },
    {
      id: '4',
      version: '2.3.0',
      name: 'Next.js Migration',
      description: 'Complete migration to Next.js 15 with App Router for better performance and developer experience.',
      releaseDate: '2025-12-20',
      type: 'minor',
      changelog: [
        'Migrated to Next.js 15 App Router',
        'Unified database architecture',
        'Improved server-side rendering',
        'New component library',
        'Enhanced theming system',
      ],
      breaking: [
        'Plugin remote URLs must be updated',
        'API endpoints moved to /api/v1/*',
      ],
    },
    {
      id: '5',
      version: '2.0.0',
      name: 'NaaP 2.0',
      description: 'Major release with completely redesigned architecture and new features.',
      releaseDate: '2025-11-01',
      type: 'major',
      changelog: [
        'Complete UI redesign',
        'New plugin architecture',
        'Multi-tenancy support',
        'Enhanced security features',
        'New admin dashboard',
      ],
      breaking: [
        'Breaking changes to plugin API',
        'Database schema migration required',
        'New authentication flow',
      ],
      deprecated: [
        'Legacy plugin format',
        'v1 API endpoints',
      ],
    },
  ];

  const getTypeColor = (type: Release['type']) => {
    switch (type) {
      case 'major':
        return 'bg-red-500/10 text-red-500 border-red-500/20';
      case 'minor':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'patch':
        return 'bg-green-500/10 text-green-500 border-green-500/20';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <History className="h-8 w-8 text-primary" />
            Release Notes
          </h1>
          <p className="text-muted-foreground mt-1">
            Track changes and updates to NaaP
          </p>
        </div>
        <a
          href="https://github.com/livepeer/NaaP/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 bg-muted rounded-lg hover:bg-muted/80 transition-all text-sm"
        >
          <GitBranch size={16} />
          View on GitHub
          <ExternalLink size={14} />
        </a>
      </div>

      {/* Current Version */}
      {releases.length > 0 && (
        <div className="p-6 bg-primary/5 border border-primary/20 rounded-xl">
          <div className="flex items-center gap-3 mb-2">
            <Tag className="text-primary" size={20} />
            <span className="text-sm font-medium text-primary">Current Version</span>
          </div>
          <h2 className="text-3xl font-bold">{releases[0].version}</h2>
          <p className="text-muted-foreground mt-1">{releases[0].name}</p>
        </div>
      )}

      {/* Release List */}
      <div className="space-y-4">
        {releases.map((release) => {
          const isExpanded = expandedRelease === release.id;
          
          return (
            <div
              key={release.id}
              className="bg-card border border-border rounded-xl overflow-hidden"
            >
              <button
                onClick={() => setExpandedRelease(isExpanded ? null : release.id)}
                className="w-full p-6 text-left hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xl font-bold">{release.version}</span>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getTypeColor(release.type)}`}>
                        {release.type}
                      </span>
                    </div>
                    <h3 className="font-medium mb-1">{release.name}</h3>
                    <p className="text-sm text-muted-foreground">{release.description}</p>
                    <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                      <Calendar size={14} />
                      {formatDate(release.releaseDate)}
                    </div>
                  </div>
                  <div className="ml-4 p-2">
                    {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="px-6 pb-6 border-t border-border pt-4 space-y-4">
                  {/* Changelog */}
                  <div>
                    <h4 className="font-medium mb-2">Changes</h4>
                    <ul className="space-y-1">
                      {release.changelog.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <span className="text-primary mt-1">•</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Breaking Changes */}
                  {release.breaking && release.breaking.length > 0 && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                      <h4 className="font-medium text-red-500 mb-2">Breaking Changes</h4>
                      <ul className="space-y-1">
                        {release.breaking.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-red-400">
                            <span className="mt-1">⚠️</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Deprecated */}
                  {release.deprecated && release.deprecated.length > 0 && (
                    <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                      <h4 className="font-medium text-amber-500 mb-2">Deprecated</h4>
                      <ul className="space-y-1">
                        {release.deprecated.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-amber-400">
                            <span className="mt-1">📦</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
