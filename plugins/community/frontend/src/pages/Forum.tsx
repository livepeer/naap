import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Search, MessageSquare, ThumbsUp, Clock, CheckCircle, TrendingUp, HelpCircle, Megaphone, Sparkles, Trophy, Tag, Loader2 } from 'lucide-react';
import { Card, Badge } from '@naap/ui';
import { fetchPosts, fetchLeaderboard, fetchTags, votePost, removeVote, checkVoted, isUserLoggedIn, getCurrentUser, type Post, type LeaderboardEntry, type Tag as TagType } from '../api/client';
import { CreatePostModal } from '../components/CreatePostModal';

const CATEGORIES = [
  { value: 'all', label: 'All', icon: null },
  { value: 'GENERAL', label: 'General', icon: null },
  { value: 'ORCHESTRATORS', label: 'Orchestrators', icon: null },
  { value: 'TRANSCODERS', label: 'Transcoders', icon: null },
  { value: 'AI_PIPELINES', label: 'AI Pipelines', icon: null },
  { value: 'GOVERNANCE', label: 'Governance', icon: null },
  { value: 'TROUBLESHOOTING', label: 'Troubleshooting', icon: null },
];

const POST_TYPE_ICONS: Record<string, React.ReactNode> = {
  QUESTION: <HelpCircle size={14} />,
  DISCUSSION: <MessageSquare size={14} />,
  ANNOUNCEMENT: <Megaphone size={14} />,
  SHOWCASE: <Sparkles size={14} />,
};

const POST_TYPE_COLORS: Record<string, string> = {
  QUESTION: 'blue',
  DISCUSSION: 'secondary',
  ANNOUNCEMENT: 'amber',
  SHOWCASE: 'emerald',
};

const LEVEL_COLORS: Record<number, string> = {
  1: '#6b7280', // Newcomer - gray
  2: '#3b82f6', // Contributor - blue
  3: '#06b6d4', // Regular - cyan
  4: '#10b981', // Trusted - emerald
  5: '#f59e0b', // Expert - amber
  6: '#8b5cf6', // Legend - purple
};

const LEVEL_NAMES: Record<number, string> = {
  1: 'Newcomer',
  2: 'Contributor',
  3: 'Regular',
  4: 'Trusted',
  5: 'Expert',
  6: 'Legend',
};

export const ForumPage: React.FC = () => {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'recent' | 'popular' | 'unanswered'>('recent');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [votedPosts, setVotedPosts] = useState<Set<string>>(new Set());
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [tags, setTags] = useState<TagType[]>([]);

  const LIMIT = 20;

  // Load posts (initial or reset)
  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { sort: sortBy, limit: LIMIT, offset: 0 };
      if (categoryFilter !== 'all') params.category = categoryFilter;
      if (searchQuery) params.search = searchQuery;

      const data = await fetchPosts(params);
      const postsList = Array.isArray(data?.posts) ? data.posts : [];
      setPosts(postsList);
      setTotal(data?.total ?? 0);

      // Check which posts the user has voted on
      if (isUserLoggedIn() && postsList.length > 0) {
        const votedIds = new Set<string>();
        await Promise.all(
          postsList.map(async (post) => {
            const voted = await checkVoted(post.id);
            if (voted) votedIds.add(post.id);
          })
        );
        setVotedPosts(votedIds);
      }
    } catch (err) {
      console.error('Failed to load posts:', err);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, searchQuery, sortBy]);

  // Load more posts (infinite scroll)
  const loadMore = useCallback(async () => {
    if (loadingMore || loading || posts.length >= total) return;
    setLoadingMore(true);
    try {
      const params: Record<string, string | number> = {
        sort: sortBy,
        limit: LIMIT,
        offset: posts.length,
      };
      if (categoryFilter !== 'all') params.category = categoryFilter;
      if (searchQuery) params.search = searchQuery;

      const data = await fetchPosts(params);
      const newPosts = Array.isArray(data?.posts) ? data.posts : [];
      if (newPosts.length > 0) {
        if (isUserLoggedIn()) {
          const votedIds = new Set(votedPosts);
          await Promise.all(
            newPosts.map(async (post) => {
              const voted = await checkVoted(post.id);
              if (voted) votedIds.add(post.id);
            })
          );
          setVotedPosts(votedIds);
        }
        setPosts((prev) => [...prev, ...newPosts]);
      }
    } catch (err) {
      console.error('Failed to load more posts:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [categoryFilter, searchQuery, sortBy, posts.length, total, loadingMore, loading]);

  // Load sidebar data (defensive: ensure arrays)
  useEffect(() => {
    fetchLeaderboard(5)
      .then((data) => setLeaderboard(Array.isArray(data) ? data : []))
      .catch(() => setLeaderboard([]));
    fetchTags(8)
      .then((data) => setTags(Array.isArray(data) ? data : []))
      .catch(() => setTags([]));
  }, []);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  // Infinite scroll: load more when sentinel is visible
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { root, rootMargin: '200px', threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const handleVote = async (postId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!isUserLoggedIn()) {
      alert('Please log in to vote');
      return;
    }

    try {
      if (votedPosts.has(postId)) {
        const result = await removeVote(postId);
        setVotedPosts((prev) => {
          const next = new Set(prev);
          next.delete(postId);
          return next;
        });
        setPosts((prev) =>
          prev.map((p) => (p.id === postId ? { ...p, upvotes: result.upvotes } : p))
        );
      } else {
        const result = await votePost(postId);
        setVotedPosts((prev) => new Set(prev).add(postId));
        setPosts((prev) =>
          prev.map((p) => (p.id === postId ? { ...p, upvotes: result.upvotes } : p))
        );
      }
    } catch (err) {
      console.error('Vote failed:', err);
      alert((err as Error).message);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
  };

  const handlePostCreated = () => {
    setShowCreateModal(false);
    loadPosts();
  };

  const currentUser = getCurrentUser();

  return (
    <div className="flex gap-6 h-full min-h-0">
      {/* Main Content - flex column with sticky header and scrollable posts */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Sticky Header - filters, new post, summary stay fixed while posts scroll */}
        <div className="flex-shrink-0 space-y-6 pb-6">
          {/* Title + New Post */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-outfit font-bold text-text-primary">Community Hub</h1>
              <p className="text-text-secondary mt-1">Ask questions, share knowledge, help others</p>
            </div>
            <button
              onClick={() => {
                if (!isUserLoggedIn()) {
                  alert('Please log in to create a post');
                  return;
                }
                setShowCreateModal(true);
              }}
              className="flex items-center gap-2 px-6 py-3 bg-accent-emerald text-white rounded-xl font-bold shadow-lg shadow-accent-emerald/20 hover:bg-accent-emerald/90 transition-all"
            >
              <Plus size={18} /> New Post
            </button>
          </div>

          {/* Search and Filters */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
              <input
                type="text"
                placeholder="Search discussions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-bg-secondary border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:border-accent-blue"
              />
            </div>

            {/* Sort */}
            <div className="flex bg-bg-secondary border border-white/10 rounded-xl p-1">
              {[
                { value: 'recent', label: 'Recent', icon: <Clock size={14} /> },
                { value: 'popular', label: 'Popular', icon: <TrendingUp size={14} /> },
                { value: 'unanswered', label: 'Unanswered', icon: <HelpCircle size={14} /> },
              ].map((sort) => (
                <button
                  key={sort.value}
                  onClick={() => setSortBy(sort.value as 'recent' | 'popular' | 'unanswered')}
                  className={`flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    sortBy === sort.value
                      ? 'bg-accent-blue text-white'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {sort.icon} {sort.label}
                </button>
              ))}
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategoryFilter(cat.value)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  categoryFilter === cat.value
                    ? 'bg-accent-blue text-white'
                    : 'bg-bg-secondary text-text-secondary hover:text-text-primary border border-white/10'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Summary Card - stays with header */}
          <Card className="!p-4">
            <div className="flex items-center gap-4 text-sm">
              <span className="font-bold text-text-primary">
                {loading ? '…' : total}
              </span>
              <span className="text-text-secondary">posts</span>
              {categoryFilter !== 'all' && (
                <span className="text-text-secondary">· filtered by {CATEGORIES.find((c) => c.value === categoryFilter)?.label}</span>
              )}
            </div>
          </Card>
        </div>

        {/* Scrollable Posts Area - only this scrolls */}
        <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-accent-blue" size={32} />
          </div>
        ) : (
          <div className="space-y-4 pr-2">
            {posts.map((post) => (
              <Card
                key={post.id}
                className="hover:border-accent-blue/30 transition-all cursor-pointer"
                onClick={() => navigate(`/post/${post.id}`)}
              >
                <div className="flex items-start gap-4">
                  {/* Vote Column */}
                  <div className="flex flex-col items-center gap-1 min-w-[60px]">
                    <button
                      onClick={(e) => handleVote(post.id, e)}
                      className={`p-2 rounded-lg transition-all ${
                        votedPosts.has(post.id)
                          ? 'bg-accent-emerald/20 text-accent-emerald'
                          : 'hover:bg-accent-emerald/10 text-text-secondary hover:text-accent-emerald'
                      }`}
                    >
                      <ThumbsUp size={18} />
                    </button>
                    <span className="font-mono font-bold text-text-primary">{post.upvotes}</span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {post.isPinned && (
                        <Badge variant="amber">Pinned</Badge>
                      )}
                      <Badge variant={POST_TYPE_COLORS[post.postType] as 'blue' | 'secondary' | 'amber' | 'emerald'}>
                        <span className="flex items-center gap-1">
                          {POST_TYPE_ICONS[post.postType]}
                          {post.postType.charAt(0) + post.postType.slice(1).toLowerCase()}
                        </span>
                      </Badge>
                      {post.isSolved && (
                        <Badge variant="emerald">
                          <span className="flex items-center gap-1">
                            <CheckCircle size={12} /> Solved
                          </span>
                        </Badge>
                      )}
                      <span className="text-xs text-text-secondary flex items-center gap-1">
                        by
                        <span
                          className="font-medium"
                          style={{ color: LEVEL_COLORS[post.author.level] }}
                        >
                          {post.author.displayName || post.author.userId?.slice(0, 8)}
                        </span>
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                          style={{
                            backgroundColor: `${LEVEL_COLORS[post.author.level]}20`,
                            color: LEVEL_COLORS[post.author.level],
                          }}
                        >
                          {LEVEL_NAMES[post.author.level]}
                        </span>
                      </span>
                      <span className="text-xs text-text-secondary flex items-center gap-1">
                        <Clock size={12} />
                        {formatDate(post.createdAt)}
                      </span>
                    </div>

                    <h3 className="text-lg font-bold text-text-primary hover:text-accent-blue transition-colors mb-2 line-clamp-1">
                      {post.title}
                    </h3>

                    <p className="text-sm text-text-secondary line-clamp-2 mb-3">
                      {post.content.replace(/[#*`]/g, '').slice(0, 200)}...
                    </p>

                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1 text-text-secondary text-sm">
                        <MessageSquare size={14} /> {post.commentCount} answers
                      </div>
                      <div className="flex items-center gap-1 text-text-secondary text-sm">
                        {post.viewCount} views
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {post.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="px-2 py-0.5 rounded text-xs"
                            style={{
                              backgroundColor: `${tag.color}20`,
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            ))}

            {posts.length === 0 && (
              <Card className="text-center py-16">
                <Users size={48} className="mx-auto mb-4 text-text-secondary opacity-30" />
                <h3 className="text-lg font-bold text-text-primary mb-2">No posts found</h3>
                <p className="text-text-secondary">Start a new discussion or try a different search</p>
              </Card>
            )}

            {posts.length > 0 && total > posts.length && (
              <>
                <div ref={loadMoreRef} className="h-4" aria-hidden="true" />
                <div className="text-center py-4">
                  {loadingMore ? (
                    <Loader2 className="animate-spin text-accent-blue mx-auto" size={24} />
                  ) : (
                    <span className="text-text-secondary text-sm">
                      Showing {posts.length} of {total} posts — scroll for more
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-72 space-y-6 hidden lg:block">
        {/* Your Stats */}
        {currentUser && (
          <Card>
            <h3 className="font-bold text-text-primary mb-3 flex items-center gap-2">
              <Trophy size={16} className="text-accent-amber" /> Welcome
            </h3>
            <div className="text-sm text-text-primary">
              <p>Logged in as <span className="font-medium">{currentUser.displayName}</span></p>
            </div>
          </Card>
        )}

        {/* Leaderboard */}
        <Card>
          <h3 className="font-bold text-text-primary mb-3 flex items-center gap-2">
            <Trophy size={16} className="text-accent-amber" /> Top Contributors
          </h3>
          <div className="space-y-3">
            {leaderboard.map((user, idx) => (
              <div key={user.id} className="flex items-center gap-3">
                <span className="text-lg font-bold text-text-secondary w-5">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div
                    className="font-medium text-sm truncate"
                    style={{ color: LEVEL_COLORS[user.level] }}
                  >
                    {user.displayName || user.userId?.slice(0, 10)}
                  </div>
                  <div className="text-xs text-text-secondary">
                    {user.reputation} rep · {LEVEL_NAMES[user.level]}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Popular Tags */}
        <Card>
          <h3 className="font-bold text-text-primary mb-3 flex items-center gap-2">
            <Tag size={16} className="text-accent-blue" /> Popular Tags
          </h3>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => setSearchQuery(tag.name)}
                className="px-2 py-1 rounded text-xs transition-all hover:opacity-80"
                style={{
                  backgroundColor: `${tag.color}20`,
                  color: tag.color,
                }}
              >
                {tag.name} ({tag.usageCount})
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Create Post Modal */}
      {showCreateModal && (
        <CreatePostModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handlePostCreated}
        />
      )}
    </div>
  );
};

export default ForumPage;
