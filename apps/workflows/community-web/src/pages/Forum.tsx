import React, { useState } from 'react';
import { Users, Plus, Search, MessageSquare, ThumbsUp, Clock } from 'lucide-react';
import { Card, Badge } from '@naap/ui';
import type { ForumPost } from '@naap/types';

const mockPosts: ForumPost[] = [
  { id: 'post-1', author: 'lp_operator.eth', title: 'Best practices for multi-GPU orchestrator setup', content: 'Looking for advice on configuring NVLink for optimal job distribution...', tags: ['infrastructure', 'gpu'], upvotes: 42, commentCount: 15, createdAt: '2024-01-15T10:30:00Z', category: 'Infrastructure' },
  { id: 'post-2', author: 'ai_dev.lens', title: 'New Flux.1 model performance benchmarks', content: 'Ran some tests comparing Flux.1 performance across different GPU types...', tags: ['ai-workloads', 'benchmarks'], upvotes: 38, commentCount: 22, createdAt: '2024-01-14T15:45:00Z', category: 'AI Workloads' },
  { id: 'post-3', author: 'governance_dao', title: 'Proposal: Adjust ticketing win probability', content: 'Discussion thread for LIP-XXX regarding the ticketing system changes...', tags: ['governance', 'proposals'], upvotes: 67, commentCount: 45, createdAt: '2024-01-13T08:20:00Z', category: 'Governance' },
  { id: 'post-4', author: 'network_analyst', title: 'Weekly network statistics - Jan 2024', content: 'Summary of network performance metrics for the past week...', tags: ['analytics', 'reports'], upvotes: 29, commentCount: 8, createdAt: '2024-01-12T12:00:00Z', category: 'General' },
];

const categoryColors = { General: 'secondary', Infrastructure: 'blue', Governance: 'amber', 'AI Workloads': 'emerald' } as const;

export const ForumPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const filteredPosts = mockPosts.filter((post) => {
    const matchesSearch = post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || post.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-outfit font-bold text-text-primary">Community Forum</h1>
          <p className="text-text-secondary mt-1">Discuss, share, and collaborate with the Livepeer community</p>
        </div>
        <button className="flex items-center gap-2 px-6 py-3 bg-accent-emerald text-white rounded-xl font-bold shadow-lg shadow-accent-emerald/20 hover:bg-accent-emerald/90 transition-all">
          <Plus size={18} /> New Post
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
          <input type="text" placeholder="Search discussions..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg-secondary border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:border-accent-blue" />
        </div>
        <div className="flex bg-bg-secondary border border-white/10 rounded-xl p-1">
          {['all', 'General', 'Infrastructure', 'Governance', 'AI Workloads'].map((cat) => (
            <button key={cat} onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${categoryFilter === cat ? 'bg-accent-blue text-white' : 'text-text-secondary hover:text-text-primary'}`}>
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {filteredPosts.map((post) => (
          <Card key={post.id} className="hover:border-accent-blue/30 transition-all cursor-pointer">
            <div className="flex items-start gap-4">
              <div className="flex flex-col items-center gap-1 min-w-[60px]">
                <button className="p-2 hover:bg-accent-emerald/10 rounded-lg transition-all">
                  <ThumbsUp size={18} className="text-text-secondary hover:text-accent-emerald" />
                </button>
                <span className="font-mono font-bold text-text-primary">{post.upvotes}</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={categoryColors[post.category as keyof typeof categoryColors]}>{post.category}</Badge>
                  <span className="text-xs text-text-secondary">by {post.author}</span>
                  <span className="text-xs text-text-secondary flex items-center gap-1"><Clock size={12} />{formatDate(post.createdAt)}</span>
                </div>
                <h3 className="text-lg font-bold text-text-primary hover:text-accent-blue transition-colors mb-2">{post.title}</h3>
                <p className="text-sm text-text-secondary line-clamp-2 mb-3">{post.content}</p>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1 text-text-secondary text-sm">
                    <MessageSquare size={14} /> {post.commentCount} comments
                  </div>
                  <div className="flex gap-1">
                    {post.tags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 bg-bg-tertiary rounded text-xs text-text-secondary">{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {filteredPosts.length === 0 && (
        <Card className="text-center py-16">
          <Users size={48} className="mx-auto mb-4 text-text-secondary opacity-30" />
          <h3 className="text-lg font-bold text-text-primary mb-2">No posts found</h3>
          <p className="text-text-secondary">Start a new discussion or try a different search</p>
        </Card>
      )}
    </div>
  );
};

export default ForumPage;
